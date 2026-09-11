import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('custom UI downloads', () => {
  it('exposes the three dashboard actions directly without a popover menu', () => {
    const document = readFileSync(new URL('../../homebridge-ui/public/index.html', import.meta.url), 'utf8');
    const script = readFileSync(new URL('../../homebridge-ui/public/js/app.js', import.meta.url), 'utf8');
    const stylesheet = readFileSync(new URL('../../homebridge-ui/public/app.css', import.meta.url), 'utf8');

    expect(document).toContain('class="dashboard-actions"');
    expect(document.match(/class="dashboard-action"/g)).toHaveLength(3);
    expect(document).not.toContain('data-dashboard-menu-trigger');
    expect(document).not.toContain('dashboard-menu-popover');
    expect(script).not.toContain('dashboardMenuTrigger');
    expect(script).not.toContain('dashboardMenu');
    expect(script).toMatch(
      /menuDiagnostics\.addEventListener\('click',[\s\S]*requestWithinDeadline\('\/diagnostics\/status'/,
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

  it('renders the archive review confirmation as a bounded checkbox', () => {
    const stylesheet = readFileSync(new URL('../../homebridge-ui/public/app.css', import.meta.url), 'utf8');

    expect(stylesheet).toContain('.first-setup-confirmation input,\n.diagnostics-review-confirm input');
    expect(stylesheet).toContain('width: 18px;\n  min-height: 18px;\n  height: 18px;\n  flex: 0 0 auto;');
  });

  it('opens on the areas, then discloses one screen at a time', () => {
    const document = readFileSync(new URL('../../homebridge-ui/public/index.html', import.meta.url), 'utf8');

    expect(document).toContain('data-diagnostics-question');
    expect(document).toContain('class="diagnostics-tiles"');
    expect(document, 'a pick replaces a sequence of yes and no').not.toContain('data-diagnostics-answer="yes"');
    expect(document).not.toContain('data-diagnostics-direct-panel');
    expect(document).toMatch(/data-diagnostics-frequency hidden/);
    expect(document).toContain('data-diagnostics-frequency-answer="intermittent"');
    expect(document).toContain('data-diagnostics-frequency-answer="now"');
    expect(document).toMatch(/data-diagnostics-match hidden/);
    expect(document).toMatch(/data-diagnostics-actions hidden/);
    expect(document).toMatch(/data-diagnostics-result hidden/);
    expect(document).toMatch(/data-diagnostics-guidance[^>]+hidden/);
    expect(document).toContain('data-diagnostics-start-another');
    expect(document, 'the heading takes focus and is the one the group is named by').toMatch(
      /id="diagnostics-question-heading"\s+tabindex="-1"\s+data-diagnostics-question-text/,
    );
    expect(document).toContain('tabindex="-1" data-diagnostics-guidance-title');
    expect(document).toContain('aria-labelledby="diagnostics-question-heading"');
    expect(document).toContain('aria-labelledby="diagnostics-match-heading"');
    expect(document).toContain('aria-labelledby="diagnostics-frequency-heading"');
    expect(document).not.toContain('diagnostics-steps');
    expect(document).not.toContain('data-diagnostics-case');
    expect(document.indexOf('data-diagnostics-frequency-answer="intermittent"')).toBeLessThan(
      document.indexOf('data-diagnostics-frequency-answer="now"'),
    );
    expect(document).toContain('src="js/profile-wizard.js"');
  });
});
