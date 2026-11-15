import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('custom UI downloads', () => {
  it('exposes the four dashboard actions directly without a popover menu', () => {
    const document = readFileSync(new URL('../../homebridge-ui/public/index.html', import.meta.url), 'utf8');
    const script = readFileSync(new URL('../../homebridge-ui/public/js/app.js', import.meta.url), 'utf8');
    const stylesheet = readFileSync(new URL('../../homebridge-ui/public/app.css', import.meta.url), 'utf8');

    expect(document).toContain('class="dashboard-actions"');
    expect(document.match(/class="dashboard-action"/g)).toHaveLength(4);
    expect(document).not.toContain('data-dashboard-menu-trigger');
    expect(document).not.toContain('dashboard-menu-popover');
    expect(script).not.toContain('dashboardMenuTrigger');
    expect(script).not.toContain('dashboardMenu');
    expect(script).toMatch(
      /menuDiagnostics\.addEventListener\('click',[\s\S]*requestWithinDeadline\('\/diagnostics\/status'/,
    );
    expect(
      document,
      'a detected problem lights the diagnostics action rather than adding a fourth control',
    ).not.toContain('data-dashboard-diagnose');
    expect(document).toMatch(/<dialog\s+class="blocking-dialog"[^>]+data-attention-dialog/);
    expect(stylesheet, 'the attention state carries a shape, not colour alone').toContain(
      '.dashboard-action[data-attention]::before',
    );
    expect(stylesheet).toContain('.dashboard-actions');
    expect(stylesheet).toMatch(/\.shell\[data-theme=['"]dark['"]\] \.dashboard-action img/);
    expect(stylesheet).toMatch(/\.shell\[data-theme=['"]dark['"]\] \.dashboard-page-icon/);
  });

  /** Every control is anchored in the shell's own flow, and no length resolves against a viewport the iframe does not own. */
  it('anchors every control in flow rather than to a viewport the iframe does not own', () => {
    const document = readFileSync(new URL('../../homebridge-ui/public/index.html', import.meta.url), 'utf8');
    const stylesheet = readFileSync(new URL('../../homebridge-ui/public/app.css', import.meta.url), 'utf8');

    expect(stylesheet).not.toMatch(/position:\s*(fixed|sticky)/);
    expect(stylesheet).not.toContain('100vw');
    expect(stylesheet).not.toContain('100vh');
    expect(document).not.toContain('data-diagnostics-background-action');
    expect(document).not.toContain('diagnosticsBackgroundIssueVisible');
  });

  it('uses a CSP-compatible data link for encrypted support archives', () => {
    const script = readFileSync(new URL('../../homebridge-ui/public/js/app.js', import.meta.url), 'utf8');

    expect(script).not.toContain('URL.createObjectURL');
    expect(script).not.toContain('blob:');
    expect(script).toContain('data:${exported.mediaType};base64,${exported.archive}');
    expect(script).toContain('document.body.appendChild(download)');
    expect(script).toContain('document.body.removeChild(download)');
  });

  /** A finished capture that recorded none of its selected logs says so and offers another capture instead of downloading. */
  it('warns when a finished capture recorded nothing, rather than handing over an empty file', () => {
    const script = readFileSync(new URL('../../homebridge-ui/public/js/app.js', import.meta.url), 'utf8');
    for (const language of ['en', 'fr']) {
      const catalog = JSON.parse(
        readFileSync(new URL(`../../homebridge-ui/public/i18n/${language}.json`, import.meta.url), 'utf8'),
      );
      expect(catalog.diagnosticsNothingRecorded, language).toBeTruthy();
    }
    expect(script).toContain('state.missingEvidence?.length === state.selectedEvidence.length');
    expect(script).toContain("nothingRecorded ? 'diagnosticsNothingRecorded'");
    expect(script).toContain('diagnosticsState.partialExportAvailable && !isNothingRecorded(diagnosticsState)');
  });

  it('downloads the archive without a confirmation to tick first', () => {
    const document = readFileSync(new URL('../../homebridge-ui/public/index.html', import.meta.url), 'utf8');
    const stylesheet = readFileSync(new URL('../../homebridge-ui/public/app.css', import.meta.url), 'utf8');

    expect(document).not.toContain('data-diagnostics-review-confirm');
    expect(stylesheet).not.toContain('diagnostics-review-confirm');
  });

  it('opens on the areas, and a pick is the only question', () => {
    const document = readFileSync(new URL('../../homebridge-ui/public/index.html', import.meta.url), 'utf8');

    expect(document).toContain('data-diagnostics-question');
    expect(document).toContain('class="diagnostics-tiles"');
    expect(document, 'a pick replaces a sequence of yes and no').not.toContain('data-diagnostics-answer="yes"');
    expect(document).not.toContain('data-diagnostics-direct-panel');
    expect(document, 'no device or frequency question follows the pick').not.toMatch(
      /data-diagnostics-(?:devices|frequency)/,
    );
    expect(document, 'the pick starts the capture, with no summary to confirm').not.toContain('data-diagnostics-match');
    expect(document, 'a capture can be cancelled').toContain('data-diagnostics-cancel');
    expect(document).toMatch(/data-diagnostics-actions hidden/);
    expect(document, 'the archive is a dialog of its own, closed until a session completes').toMatch(
      /<dialog[^>]+data-diagnostics-result/,
    );
    expect(document).toMatch(/data-diagnostics-guidance[^>]+hidden/);
    expect(document, 'the archive dialog always offers a way out').toMatch(
      /data-diagnostics-start-another\s+data-i18n/,
    );
    expect(document, 'the heading takes focus and is the one the group is named by').toMatch(
      /id="diagnostics-question-heading"\s+tabindex="-1"\s+data-diagnostics-question-text/,
    );
    expect(document).toContain('aria-labelledby="diagnostics-question-heading"');
    expect(document).not.toContain('diagnostics-steps');
    expect(document).not.toContain('data-diagnostics-case');
  });
});
