import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

interface WizardState {
  mode: string;
  profile?: string;
  devices?: 'all' | readonly string[];
  reproductionMode?: 'now' | 'intermittent';
}

interface DiagnosticsWizard {
  backFromFrequency(state: WizardState): WizardState;
  backgroundActive(session: { profile?: string; status: string }): boolean;
  chooseDevices(state: WizardState, devices: 'all' | readonly string[]): WizardState;
  chooseReproductionMode(state: WizardState, mode: 'now' | 'intermittent'): WizardState;
  deviceProfiles: readonly string[];
  profiles: readonly string[];
  reject(state: WizardState): WizardState;
  screen(session: { partialExportAvailable?: boolean; status: string }, startingAnother: boolean): string;
  select(state: WizardState, profile: string): WizardState;
  start(): WizardState;
}

function loadWizard(): DiagnosticsWizard {
  const script = readFileSync(new URL('../../homebridge-ui/public/js/profile-wizard.js', import.meta.url), 'utf8');
  const window = {} as { HomebridgeEufyDiagnosticsWizard?: DiagnosticsWizard };
  runInNewContext(script, { window });
  return window.HomebridgeEufyDiagnosticsWizard!;
}

describe('diagnostics profile wizard', () => {
  /**
   * The opening screen offers every area at once, in the order they are shown, and picking one is the whole
   * narrowing step. There is no sequence to walk and no position to remember.
   */
  it('offers every area at once and takes a pick as the whole choice', () => {
    const wizard = loadWizard();

    expect(wizard.profiles).toEqual([
      'startup-authentication',
      'device-representation',
      'control-state',
      'live-media',
      'hksv-recording',
      'dashboard-ui',
      'other',
    ]);
    expect(wizard.start()).toMatchObject({ mode: 'tiles', profile: undefined });
    expect(wizard.select(wizard.start(), 'live-media')).toMatchObject({ profile: 'live-media' });
  });

  /**
   * An area that belongs to a device asks which ones before anything else, so the reporter states it once
   * rather than being asked again in the issue. An area that belongs to the account or the interface does not
   * ask, because there is nothing to name.
   */
  it('asks which devices only where the area belongs to one', () => {
    const wizard = loadWizard();

    expect(wizard.deviceProfiles).toEqual(['device-representation', 'control-state', 'live-media', 'hksv-recording']);
    expect(wizard.select(wizard.start(), 'live-media')).toMatchObject({ mode: 'devices', profile: 'live-media' });
    expect(wizard.select(wizard.start(), 'startup-authentication')).toMatchObject({
      mode: 'frequency',
      profile: 'startup-authentication',
    });
    expect(wizard.select(wizard.start(), 'dashboard-ui')).toMatchObject({ mode: 'frequency' });
    expect(wizard.select(wizard.start(), 'other')).toMatchObject({ mode: 'frequency' });
  });

  /**
   * Naming the devices, or saying it is all of them, is what moves on to frequency. Both answers are recorded,
   * because "all of them" is a statement about the fault and not an absence of one.
   */
  it('records either the named devices or that it is all of them', () => {
    const wizard = loadWizard();
    const asking = wizard.select(wizard.start(), 'control-state');

    expect(wizard.chooseDevices(asking, 'all')).toMatchObject({ mode: 'frequency', devices: 'all' });
    expect(wizard.chooseDevices(asking, ['T8000P0000000000'])).toMatchObject({
      mode: 'frequency',
      devices: ['T8000P0000000000'],
    });
  });

  /**
   * Frequency follows the pick, and both ways back from it return to the same opening screen, because there
   * is only one.
   */
  it('asks for reproduction frequency after a pick, and returns to the tiles', () => {
    const wizard = loadWizard();
    const frequency = wizard.chooseDevices(wizard.select(wizard.start(), 'live-media'), 'all');
    const intermittent = wizard.chooseReproductionMode(frequency, 'intermittent');

    expect(intermittent).toMatchObject({
      mode: 'match',
      profile: 'live-media',
      reproductionMode: 'intermittent',
    });
    expect(wizard.reject(intermittent)).toMatchObject({ mode: 'tiles', profile: undefined });
    expect(
      wizard.backFromFrequency(frequency),
      'back from frequency returns to the question just asked, not past it',
    ).toMatchObject({ mode: 'devices', profile: 'live-media' });
    expect(wizard.backFromFrequency(wizard.select(wizard.start(), 'dashboard-ui'))).toMatchObject({ mode: 'tiles' });
  });

  /**
   * Every area the opening screen offers has a tile in the markup, in the module's order, and a phrase in both
   * catalogues. A profile added to one and not the other would otherwise ship a tile with no label, or a label
   * nothing reaches.
   */
  it('has a tile and a phrase in both languages for every area', () => {
    const wizard = loadWizard();
    const markup = readFileSync(new URL('../../homebridge-ui/public/index.html', import.meta.url), 'utf8');
    const english = JSON.parse(
      readFileSync(new URL('../../homebridge-ui/public/i18n/en.json', import.meta.url), 'utf8'),
    ) as Record<string, string>;
    const french = JSON.parse(
      readFileSync(new URL('../../homebridge-ui/public/i18n/fr.json', import.meta.url), 'utf8'),
    ) as Record<string, string>;
    const tiles = [...markup.matchAll(/data-diagnostics-tile="([^"]+)"\s+data-i18n="([^"]+)"/g)];

    expect(Object.keys(french).sort()).toEqual(Object.keys(english).sort());
    expect(tiles.map(([, profile]) => profile)).toEqual([...wizard.profiles]);
    for (const [, profile, key] of tiles) {
      expect(english[key], `${profile} in English`).toBeTruthy();
      expect(french[key], `${profile} in French`).toBeTruthy();
    }
    expect(english.diagnosticsTilesHeading).toBe('What is going wrong?');
    expect(english.diagnosticsProfileDevices).toBe('Missing or incorrect device');
    expect(english.diagnosticsQuestionReproduceNow).toBe('Can you reproduce the problem now?');
    expect(french.diagnosticsQuestionReproduceNow).toBe('Pouvez-vous reproduire le problème maintenant ?');

    const normalFlowKeys = [
      'diagnosticsControlAction',
      'diagnosticsControlBefore',
      'diagnosticsControlSummary',
      'diagnosticsDashboardAction',
      'diagnosticsDashboardBefore',
      'diagnosticsDashboardSummary',
      'diagnosticsDevicesAction',
      'diagnosticsDevicesBefore',
      'diagnosticsDevicesSummary',
      'diagnosticsEvidenceReady',
      'diagnosticsLiveAction',
      'diagnosticsLiveBefore',
      'diagnosticsLiveSummary',
      'diagnosticsMissingEvidence',
      'diagnosticsOtherAction',
      'diagnosticsOtherBefore',
      'diagnosticsOtherSummary',
      'diagnosticsPrivacy',
      'diagnosticsRecordingAction',
      'diagnosticsRecordingBefore',
      'diagnosticsRecordingSummary',
      'diagnosticsStartupAction',
      'diagnosticsStartupBefore',
      'diagnosticsStartupSummary',
      'diagnosticsSummary',
    ];
    expect(normalFlowKeys.map((key) => english[key]).join('\n')).not.toMatch(
      /bounded|evidence|observation|adapter|capability-admission|FFmpeg|reproduction interval|72-hour/i,
    );
    expect(normalFlowKeys.map((key) => french[key]).join('\n')).not.toMatch(
      /preuves|observation|adaptation|admission|FFmpeg|intervalle de reproduction|autorisation de 72/i,
    );
  });

  it('prioritizes completed evidence until another session is explicitly started', () => {
    const wizard = loadWizard();

    expect(wizard.screen({ status: 'complete', partialExportAvailable: true }, false)).toBe('review');
    expect(wizard.screen({ status: 'expired', partialExportAvailable: true }, false)).toBe('review');
    expect(wizard.screen({ status: 'expired', partialExportAvailable: true }, true)).toBe('choose');
    expect(wizard.screen({ status: 'expired', partialExportAvailable: false }, false)).toBe('choose');
    expect(wizard.screen({ status: 'authorized' }, false)).toBe('reproduce');
  });

  it('shows the background action only for an active dashboard reproduction', () => {
    const wizard = loadWizard();

    expect(wizard.backgroundActive({ status: 'reproducing', profile: 'dashboard-ui' })).toBe(true);
    expect(wizard.backgroundActive({ status: 'authorized', profile: 'dashboard-ui' })).toBe(false);
    expect(wizard.backgroundActive({ status: 'complete', profile: 'dashboard-ui' })).toBe(false);
    expect(wizard.backgroundActive({ status: 'reproducing', profile: 'control-state' })).toBe(false);
  });

  /**
   * Every tile has an inline icon, and no icon exists for a tile that does not. The data URI is inline because
   * a host with no route to the internet renders the panel the same as one with it.
   */
  it('gives every tile an inline icon and nothing else one', () => {
    const wizard = loadWizard();
    const stylesheet = readFileSync(new URL('../../homebridge-ui/public/app.css', import.meta.url), 'utf8');
    const masked = [
      ...stylesheet.matchAll(/data-diagnostics-tile='([^']+)'\]::before \{\s*mask-image: url\('data:image\/svg\+xml,/g),
    ].map(([, profile]) => profile);

    expect(masked.sort()).toEqual([...wizard.profiles].sort());
    expect(stylesheet, 'three to a row').toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    expect(stylesheet, 'and two where three would not read').toMatch(
      /@media \(max-width: 420px\) \{[\s\S]*?\.diagnostics-tiles \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
    );
    expect(stylesheet, 'an icon fetched at render time is an icon a local host may never see').not.toMatch(
      /mask-image: url\('https?:/,
    );
  });
});
