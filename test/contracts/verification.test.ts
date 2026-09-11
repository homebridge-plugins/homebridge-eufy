import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const contracts = join(repository, 'test', 'contracts');
const npmScripts = (
  JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
).scripts;
const specifications = readdirSync(contracts).filter((file) => file.endsWith('.test.ts'));
const workflow = (name: string): string =>
  readFileSync(join(repository, '.github', 'workflows', `${name}.yml`), 'utf8');

describe('verification gate', () => {
  /**
   * `npm run verify` is the whole gate: formatting, the dependency guard, the build, and the specification
   * suite with no path filter, so where a specification is written does not decide whether it is executed.
   */
  it('runs formatting, the dependency guard, the build, and every specification', () => {
    expect(npmScripts.verify).toBe('npm run lint && npm run guard:no-ecs && npm run build && npm test');
    expect(npmScripts.test).toBe('vitest run');
  });

  /**
   * Every area the gate covers resolves to at least one specification in the suite it executes.
   */
  it('executes a specification for each area it covers', () => {
    const areas: Record<string, RegExp> = {
      'coverage matrix': /^coverage-matrix\.test\.ts$/,
      adapters: /-adapter\.test\.ts$/,
      migration: /^(?:configuration|storage-root)\.test\.ts$/,
      ownership: /^(?:account-ownership|runtime-owner)\.test\.ts$/,
      'runtime channel': /^runtime-channel\.test\.ts$/,
      media: /^(?:live|recording)-media\.test\.ts$/,
      dashboard: /^dashboard\.test\.ts$/,
      'device image': /^device-image\.test\.ts$/,
      diagnostics: /^(?:guided-diagnostics|diagnostic-conditions)\.test\.ts$/,
      'package contents': /^package\.test\.ts$/,
    };

    for (const [area, pattern] of Object.entries(areas)) {
      expect(
        specifications.filter((file) => pattern.test(file)),
        area,
      ).not.toEqual([]);
    }
  });

  /**
   * An unhandled rejection fails the specification it escaped from.
   *
   * The runner reports one and exits zero on its own, so a promise nothing observed can carry a fault out of the
   * code under test and into no assertion at all, leaving a specification passing while the behaviour it names is
   * broken. The setup file the suite installs is what turns that into a failure.
   */
  it('refuses an unhandled rejection rather than reporting one and passing', () => {
    expect(readFileSync(join(repository, 'vitest.config.ts'), 'utf8')).toMatch(
      /setupFiles:\s*\['\.\/test\/unhandled-rejections\.ts'\]/,
    );
    expect(readFileSync(join(repository, 'test', 'unhandled-rejections.ts'), 'utf8')).toMatch(
      /process\.on\('unhandledRejection',\s*\(reason\) => \{\s*throw reason;/,
    );
  });

  /**
   * A specification that moves time installs a fake clock to move, so the gate's result does not depend on
   * how fast the host ran it.
   */
  it('installs a fake clock wherever a specification moves time', () => {
    for (const file of specifications) {
      const source = readFileSync(join(contracts, file), 'utf8');
      if (/vi\.(?:advanceTimersByTime|advanceTimersToNextTimer|runAllTimers|setSystemTime)\(/.test(source)) {
        expect(source, file).toMatch(/vi\.useFakeTimers\(/);
      }
    }
  });

  /**
   * No specification is narrowed to one case or switched off, and the only contracts an environment condition
   * excuses are the packed-provenance ones a working copy linked to an unpublished SDK cannot satisfy.
   */
  it('leaves no specification narrowed or switched off outside the linked-SDK exemption', () => {
    for (const file of specifications.filter((name) => name !== 'verification.test.ts')) {
      const source = readFileSync(join(contracts, file), 'utf8');

      expect(source, file).not.toMatch(/\b(?:describe|it|test)\.only\b/);
      expect(source, file).not.toMatch(/\b(?:describe|it|test)\.skip\(/);
      if (/\.skipIf\(/.test(source)) {
        expect(file).toBe('package.test.ts');
      }
    }
  });

  /**
   * Continuous integration installs from the lockfile alone and runs the whole gate on every pull request and
   * every push to the one active beta branch, with the bundled FFmpeg binary the media contracts read.
   */
  it('installs cleanly and runs the gate on pull requests and active-beta pushes', () => {
    const ci = workflow('ci');
    const branches = [...ci.matchAll(/branches:\n\s+- (?<branch>\S+)/g)].map((match) => match.groups!.branch);

    expect(branches, 'both triggers name one branch').toHaveLength(2);
    expect(new Set(branches).size, 'and it is the same branch').toBe(1);
    expect(branches[0]).toMatch(/^beta-\d+\.\d+\.\d+$/);
    expect(ci).toContain('run: npm ci --ignore-scripts');
    expect(ci).toContain('run: npm rebuild ffmpeg-for-homebridge');
    expect(ci).toContain('run: npm run verify');
  });

  /**
   * Publication happens through a published GitHub Release and nothing else, and the tag it carries is what
   * names the version and the channel. A branch push that published would ship a version with no release
   * page behind it, which is what the Homebridge UI shows a reader when it offers an update.
   */
  it('publishes only from a published release, on a channel the tag names', () => {
    const release = workflow('release');

    expect(release).toMatch(/^on:\n {2}release:\n {4}types: \[published]\n\npermissions:/m);
    expect(release, 'a branch push must not reach the registry').not.toMatch(/^ {2}push:/m);
    expect(release).toContain('TAG: ${{ github.event.release.tag_name }}');
    expect(release).toContain('FLAGGED_PRERELEASE: ${{ github.event.release.prerelease }}');
    expect(release).toContain('npm publish --tag ${{ steps.release.outputs.channel }}');
  });

  /**
   * The publish job runs no code fetched at run time. An unpinned remote script executed with publish rights
   * in scope is an update nobody reviewed, on the one workflow that can reach the registry.
   */
  it('fetches no script at run time in the job that can publish', () => {
    const release = workflow('release');

    expect(release).not.toMatch(/\b(wget|curl)\b/);
    expect(release).not.toContain('raw.githubusercontent.com');
  });

  /**
   * Exactly one guard binds the publish job to the repository allowed to publish, and it names that
   * repository exactly. A guard that cannot match skips the job while the run still reports success, so the
   * name is a contract here rather than a discovery at the registry.
   */
  it('binds publication to this repository by name', () => {
    const guards = [...workflow('release').matchAll(/github\.repository == '(?<repository>[^']+)'/g)].map(
      (match) => match.groups!.repository,
    );

    expect(guards).toEqual(['homebridge-plugins/homebridge-eufy']);
  });

  /**
   * Publication installs cleanly, runs the gate at the exact commit it publishes before reaching the
   * registry, and runs it again with release qualification through `prepublishOnly`, which is the only thing
   * a publication made outside the workflow passes through. Qualification is preceded by the build it scans
   * and followed by the suite, so the packed artifact exists when its provenance is read and a linked working
   * copy is refused before it reaches the contracts that excuse themselves for it. The publish command
   * attaches provenance, which is a property of the artifact consumers verify and not of this run.
   */
  it('verifies at the publication commit and qualifies provenance during publication', () => {
    const release = workflow('release');

    expect(npmScripts.prepublishOnly).toBe('npm run build && npm run qualify:release && npm run verify');
    expect(release).toContain('run: npm ci --ignore-scripts');
    expect(release).toContain('run: npm rebuild ffmpeg-for-homebridge');
    expect(release).toContain('run: npm run verify');
    expect(release).toMatch(/run: npm publish --tag .+ --provenance --access public$/m);
    expect(release).not.toMatch(/npm publish.*--ignore-scripts/);
  });
});
