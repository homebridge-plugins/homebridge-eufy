import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

interface PackResult {
  filename: string;
  files: Array<{ path: string }>;
  entryCount: number;
  unpackedSize: number;
}

/**
 * Whether a contract that only a published SDK can satisfy is excused here.
 *
 * The SDK is developed beside the plugin, so a `file:` specifier resolves a working copy that has no published
 * version, no lockfile integrity, and no resolution from outside the repository. Continuous integration sets
 * `CI` and is never excused, so a `file:` specifier that reaches a commit fails the provenance it guards.
 */
const LINKED_SDK_EXEMPTION: boolean = (() => {
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  return (manifest.dependencies?.['@mega-yfue/eufy-sdk'] ?? '').startsWith('file:') && process.env.CI === undefined;
})();

async function renderUi(
  script: string,
  pluginConfig: Array<Record<string, unknown>>,
  catalogs: Record<string, Record<string, string>>,
  language = 'en',
  translationKeys: string[] = [],
  authenticationStart: Record<string, unknown> = {
    status: 'captcha',
    image: 'data:image/png;base64,c3ludGhldGlj',
    retry: false,
  },
  dashboardSnapshot: Record<string, unknown> = { state: 'ready', devices: [] },
  diagnosticsSnapshot: Record<string, unknown> = {
    status: 'inactive',
    selectedEvidence: [],
    missingEvidence: [],
    partialExportAvailable: false,
  },
  wizardPending = false,
) {
  function interactiveElement<T extends object>(state: T) {
    const listeners: Record<string, Array<(event?: { preventDefault(): void }) => void | Promise<void>>> = {};
    return Object.assign(state, {
      addEventListener(event: string, listener: (event?: { preventDefault(): void }) => void | Promise<void>) {
        (listeners[event] ??= []).push(listener);
      },
      async dispatch(event: string, detail: Record<string, unknown> = {}) {
        await Promise.all(listeners[event]?.map((listener) => listener({ preventDefault() {}, ...detail })) ?? []);
      },
    });
  }

  function labelledElement() {
    return interactiveElement({
      attributes: {} as Record<string, string>,
      dataset: {} as Record<string, string>,
      setAttribute(name: string, value: string) {
        this.attributes[name] = value;
      },
    });
  }

  const shell = { dataset: {} as Record<string, string>, lang: '' };
  const documentElement = { lang: '' };
  const masthead = { hidden: false };
  const firstSetup = interactiveElement({ hidden: true });
  const setupContent = { hidden: true };
  const acknowledgement = interactiveElement({ checked: false });
  const continueButton = interactiveElement({ disabled: true });
  const authForm = interactiveElement({ hidden: false });
  const challengeForm = interactiveElement({ hidden: true });
  const account = { value: '' };
  const password = { value: '' };
  /** The country field. `validity` answers the markup's two-letter pattern the way a browser does. */
  const country = interactiveElement({
    value: '',
    validityMessage: '',
    get validity() {
      return { patternMismatch: this.value !== '' && !/^[A-Za-z]{2}$/.test(this.value) };
    },
    setCustomValidity(message: string) {
      this.validityMessage = message;
    },
  });
  const trustedDeviceName = { value: '' };
  const challengeAnswer = { value: '' };
  const challengeImage = { hidden: true, src: '' };
  const challengeLabel = { textContent: '' };
  const authStatus = { textContent: '' };
  const authSubmit = { disabled: false };
  const challengeSubmit = { disabled: false };
  const dashboard = { hidden: true, dataset: {} as Record<string, string> };
  const dashboardState = { hidden: false };
  const dashboardTitle = { textContent: '' };
  const dashboardSummary = { hidden: false, textContent: '' };
  const dashboardAuthenticate = interactiveElement({ hidden: true });
  /** The blocking sign-in dialog. `showModal` and `close` flip `open` the way a browser's dialog does. */
  const reauthDialog = interactiveElement({
    open: false,
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
  });
  const reauthAction = interactiveElement({});
  /** The dialog naming the problem the dashboard shows. `showModal` and `close` flip `open` as a browser's does. */
  const attentionDialog = interactiveElement({
    open: false,
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
  });
  const attentionTitle = { textContent: '' };
  const attentionSummary = { textContent: '' };
  const attentionDiagnose = interactiveElement({});
  const attentionChoose = interactiveElement({});
  /**
   * The container the dashboard draws device tiles into.
   *
   * `querySelectorAll` answers nothing because this harness sets `innerHTML` as a string and parses no markup, so
   * there are no tiles to walk. Answering it at all is what a browser does, and a container that cannot be
   * queried would make the image pass throw instead of run.
   */
  const deviceGroups = interactiveElement({ hidden: false, innerHTML: '', querySelectorAll: () => [] });
  const pageTitle = { textContent: '' };
  const legacyNotice = { hidden: true };
  const legacySettings = { textContent: '' };
  const legacyAcknowledge = interactiveElement({});
  const legacyStatus = { textContent: '' };
  const menuDiagnostics = labelledElement();
  const mastheadDiagnostics = labelledElement();
  const menuAdvanced = interactiveElement({});
  const diagnosticsClose = interactiveElement({ focus() {} });
  const diagnosticsPanel = { hidden: true, scrollIntoView() {}, querySelector: () => diagnosticsClose };
  const diagnosticsWizardPanel = { hidden: false };
  const diagnosticsTiles = [
    'startup-authentication',
    'device-representation',
    'control-state',
    'live-media',
    'hksv-recording',
    'dashboard-ui',
    'other',
  ].map((profile) =>
    interactiveElement({
      dataset: { diagnosticsTile: profile },
      focused: false,
      focus() {
        this.focused = true;
      },
    }),
  );
  const diagnosticsQuestionText = {
    focused: false,
    textContent: '',
    focus() {
      this.focused = true;
    },
  };
  const diagnosticsCancel = interactiveElement({ disabled: false });
  const diagnosticsReproduction = interactiveElement({ disabled: true, textContent: '' });
  const diagnosticsStatus = { textContent: '' };
  const diagnosticsIssue = interactiveElement({
    hidden: true,
    href: '',
    attributes: {} as Record<string, string>,
    setAttribute(name: string, value: string) {
      this.attributes[name] = value;
    },
  });
  const diagnosticsExistingIssue = interactiveElement({ hidden: true, href: '' });
  /** The archive dialog. `showModal` and `close` flip `open` the way a browser's dialog does. */
  const diagnosticsResult = interactiveElement({
    open: false,
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
  });
  const diagnosticsActions = { hidden: true };
  const diagnosticsGuidance = { hidden: true };
  const diagnosticsPhaseTitle = {
    focused: false,
    textContent: '',
    focus() {
      this.focused = true;
    },
  };
  const diagnosticsGuidanceAction = { textContent: '' };
  const diagnosticsCaptureNote = { textContent: '' };
  const diagnosticsHandoff = { hidden: true };
  const diagnosticsHandoffNote = { hidden: true, textContent: '' };
  const diagnosticsResultStatus = { textContent: '' };
  const diagnosticsExport = interactiveElement({ disabled: true, hidden: true });
  const diagnosticsResultHeading = {
    focused: false,
    focus() {
      this.focused = true;
    },
  };
  const diagnosticsStartAnother = interactiveElement({});
  const diagnosticsDownloadAgain = interactiveElement({ hidden: true });
  const advancedClose = interactiveElement({ focus() {} });
  const advancedPanel = { hidden: true, scrollIntoView() {}, querySelector: () => advancedClose };
  const deviceClose = interactiveElement({ focus() {} });
  const devicePanel = { hidden: true, scrollIntoView() {}, querySelector: () => deviceClose };
  const deviceSettingsTitle = { textContent: '' };
  const deviceSettingsEyebrow = { textContent: '' };
  const deviceSettingsControls = interactiveElement({ innerHTML: '' });
  const menuWizard = interactiveElement({});
  const wizardClose = interactiveElement({ focus() {} });
  const wizardPanel = { hidden: true, scrollIntoView() {}, querySelector: () => wizardClose };
  const wizardProgress = { textContent: '' };
  const wizardTitle = { textContent: '' };
  const wizardEyebrow = { textContent: '' };
  const wizardRestart = { hidden: true };
  const wizardLive = { hidden: true };
  const wizardLiveImage = { hidden: true, src: '' };
  const wizardLiveStatus = { textContent: '' };
  const wizardLivePlay = interactiveElement({ hidden: false });
  const wizardLiveStop = interactiveElement({ hidden: true });
  const wizardLiveSpinner = { hidden: true };
  const wizardFinish = interactiveElement({ textContent: '' });
  const wizardMap = interactiveElement({
    hidden: false,
    children: [] as unknown[],
    replaceChildren(...children: unknown[]) {
      this.children = children;
    },
  });
  const wizardStage = { hidden: false };
  const wizardHomeKit = { hidden: false };
  const wizardEufy = { hidden: true };
  const wizardEncoders = { hidden: true };
  const wizardEncodersBody = interactiveElement({
    children: [] as Array<{ textContent: string }>,
    replaceChildren(...children: Array<{ textContent: string }>) {
      this.children = children;
    },
  });
  const wizardSettingsStatus = { textContent: '' };
  const wizardSettings = interactiveElement({
    children: [] as unknown[],
    replaceChildren(...children: unknown[]) {
      this.children = children;
    },
    querySelector: () => wizardSettingsStatus,
  });
  const wizardControls = interactiveElement({
    innerHTML: '',
    replaceChildren() {
      this.innerHTML = '';
    },
  });
  const wizardBack = interactiveElement({ disabled: false });
  const wizardNext = interactiveElement({ disabled: false });
  const pushListeners: Record<string, (event: { data: unknown }) => void> = {};
  const storage = new Map<string, string>(wizardPending ? [['homebridge-eufy.setup-wizard-pending', 'pending']] : []);
  const advancedPolling = interactiveElement({
    value: '',
    validityMessage: '',
    setCustomValidity(message: string) {
      this.validityMessage = message;
    },
    reportValidity() {},
  });
  const advancedConcurrentMedia = interactiveElement({
    value: '',
    validityMessage: '',
    setCustomValidity(message: string) {
      this.validityMessage = message;
    },
    reportValidity() {},
  });
  const advancedFfmpeg = interactiveElement({ value: '' });
  const advancedSmallVideoPackets = interactiveElement({ checked: false });
  const advancedLiveVideoPassthrough = interactiveElement({ checked: false });
  const advancedHardwareVideoEncoder = interactiveElement({ checked: false });
  const advancedHdLiveVideo = interactiveElement({ checked: false });
  const advancedIgnoreHomeBitRate = interactiveElement({ checked: false });
  /**
   * The transfer list the warm-up setting draws into.
   *
   * `textContent = ''` has to empty the children, as it does in a browser: without that the harness accumulates
   * every entry ever drawn and a redraw appears to change nothing, which would let a broken redraw pass.
   */
  const listElement = () => {
    const children: unknown[] = [];
    return interactiveElement({
      children,
      get textContent() {
        return '';
      },
      set textContent(_value: string) {
        children.length = 0;
      },
      append(...items: unknown[]) {
        children.push(...items);
      },
    });
  };
  const warmUpAvailable = listElement();
  const warmUpChosen = listElement();
  const warmUpAdd = interactiveElement({ disabled: false });
  const warmUpAddAll = interactiveElement({ disabled: false });
  const warmUpRemove = interactiveElement({ disabled: false });
  const warmUpRemoveAll = interactiveElement({ disabled: false });
  const advancedStatus = { textContent: '' };
  const browserWindow = interactiveElement({});
  const requests: Array<{ path: string; body: unknown }> = [];
  /** Every element the shell built for itself, the archive download link among them. */
  const createdElements: Array<Record<string, unknown>> = [];
  let updatedConfig: Array<Record<string, unknown>> | undefined;
  let saves = 0;
  let saveButtonDisables = 0;
  let saveButtonEnables = 0;
  let configWritesFail = false;
  let authorizeDelayMs = 0;
  let endResponseLost = false;
  let diagnosticsSelectedProfile = 'control-state';
  const translatedNodes = translationKeys.map((key) => ({ dataset: { i18n: key }, textContent: '__untranslated__' }));
  const translatedLabels = [
    'accountConnectionLabel',
    'advancedWarmUpAdd',
    'advancedWarmUpAddAll',
    'advancedWarmUpRemove',
    'advancedWarmUpRemoveAll',
    'closeAdvanced',
    'closeDiagnostics',
    'dashboardActionsLabel',
    'menuAdvanced',
    'menuDiagnostics',
    'menuRelogin',
    'setupSequenceLabel',
  ].map((key) => ({
    attributes: { 'aria-label': '__untranslated__' },
    dataset: { i18nAriaLabel: key },
    setAttribute(name: string, value: string) {
      this.attributes[name] = value;
    },
  }));
  let ready: (() => Promise<void>) | undefined;

  runInNewContext(script, {
    document: {
      documentElement,
      querySelector(selector: string) {
        return {
          '[data-first-setup]': firstSetup,
          '[data-first-setup-ack]': acknowledgement,
          '[data-first-setup-continue]': continueButton,
          '[data-setup-content]': setupContent,
          '[data-ui-shell]': shell,
          '[data-masthead]': masthead,
          '[data-auth-form]': authForm,
          '[data-challenge-form]': challengeForm,
          '[data-account]': account,
          '[data-password]': password,
          '[data-country]': country,
          '[data-trusted-device-name]': trustedDeviceName,
          '[data-challenge-answer]': challengeAnswer,
          '[data-challenge-image]': challengeImage,
          '[data-challenge-label]': challengeLabel,
          '[data-auth-status]': authStatus,
          '[data-auth-submit]': authSubmit,
          '[data-challenge-submit]': challengeSubmit,
          '[data-dashboard]': dashboard,
          '[data-dashboard-state]': dashboardState,
          '[data-dashboard-title]': dashboardTitle,
          '[data-dashboard-summary]': dashboardSummary,
          '[data-dashboard-authenticate]': dashboardAuthenticate,
          '[data-reauth-dialog]': reauthDialog,
          '[data-reauth-action]': reauthAction,
          '[data-attention-dialog]': attentionDialog,
          '[data-attention-title]': attentionTitle,
          '[data-attention-summary]': attentionSummary,
          '[data-attention-diagnose]': attentionDiagnose,
          '[data-attention-choose]': attentionChoose,
          '[data-device-groups]': deviceGroups,
          '[data-page-title]': pageTitle,
          '[data-legacy-notice]': legacyNotice,
          '[data-legacy-settings]': legacySettings,
          '[data-legacy-acknowledge]': legacyAcknowledge,
          '[data-legacy-status]': legacyStatus,
          '[data-menu-diagnostics]': menuDiagnostics,
          '[data-masthead-diagnostics]': mastheadDiagnostics,
          '[data-menu-advanced]': menuAdvanced,
          '[data-diagnostics]': diagnosticsPanel,
          '[data-diagnostics-close]': diagnosticsClose,
          '[data-diagnostics-wizard]': diagnosticsWizardPanel,
          '[data-diagnostics-question-text]': diagnosticsQuestionText,
          '[data-diagnostics-cancel]': diagnosticsCancel,
          '[data-diagnostics-reproduction]': diagnosticsReproduction,
          '[data-diagnostics-status]': diagnosticsStatus,
          '[data-diagnostics-issue]': diagnosticsIssue,
          '[data-diagnostics-existing-issue]': diagnosticsExistingIssue,
          '[data-diagnostics-result]': diagnosticsResult,
          '[data-diagnostics-actions]': diagnosticsActions,
          '[data-diagnostics-guidance]': diagnosticsGuidance,
          '[data-diagnostics-phase-title]': diagnosticsPhaseTitle,
          '[data-diagnostics-guidance-action]': diagnosticsGuidanceAction,
          '[data-diagnostics-capture-note]': diagnosticsCaptureNote,
          '[data-diagnostics-handoff]': diagnosticsHandoff,
          '[data-diagnostics-handoff-note]': diagnosticsHandoffNote,
          '[data-diagnostics-result-status]': diagnosticsResultStatus,
          '[data-diagnostics-export]': diagnosticsExport,
          '[data-diagnostics-result-heading]': diagnosticsResultHeading,
          '[data-diagnostics-start-another]': diagnosticsStartAnother,
          '[data-diagnostics-download-again]': diagnosticsDownloadAgain,
          '[data-advanced-settings]': advancedPanel,
          '[data-advanced-close]': advancedClose,
          '[data-device-settings]': devicePanel,
          '[data-device-close]': deviceClose,
          '[data-device-settings-title]': deviceSettingsTitle,
          '[data-device-settings-eyebrow]': deviceSettingsEyebrow,
          '[data-device-settings-controls]': deviceSettingsControls,
          '[data-advanced-polling]': advancedPolling,
          '[data-advanced-concurrent-media]': advancedConcurrentMedia,
          '[data-advanced-ffmpeg]': advancedFfmpeg,
          '[data-advanced-small-video-packets]': advancedSmallVideoPackets,
          '[data-advanced-live-video-passthrough]': advancedLiveVideoPassthrough,
          '[data-advanced-hardware-video-encoder]': advancedHardwareVideoEncoder,
          '[data-advanced-hd-live-video]': advancedHdLiveVideo,
          '[data-advanced-ignore-home-bit-rate]': advancedIgnoreHomeBitRate,
          '[data-advanced-status]': advancedStatus,
          '[data-warm-up-available]': warmUpAvailable,
          '[data-warm-up-chosen]': warmUpChosen,
          '[data-warm-up-add]': warmUpAdd,
          '[data-warm-up-add-all]': warmUpAddAll,
          '[data-warm-up-remove]': warmUpRemove,
          '[data-warm-up-remove-all]': warmUpRemoveAll,
          '[data-menu-wizard]': menuWizard,
          '[data-setup-wizard]': wizardPanel,
          '[data-wizard-close]': wizardClose,
          '[data-wizard-progress]': wizardProgress,
          '[data-wizard-title]': wizardTitle,
          '[data-wizard-eyebrow]': wizardEyebrow,
          '[data-wizard-restart]': wizardRestart,
          '[data-wizard-live]': wizardLive,
          '[data-wizard-live-image]': wizardLiveImage,
          '[data-wizard-live-status]': wizardLiveStatus,
          '[data-wizard-live-play]': wizardLivePlay,
          '[data-wizard-live-stop]': wizardLiveStop,
          '[data-wizard-live-spinner]': wizardLiveSpinner,
          '[data-wizard-finish]': wizardFinish,
          '[data-wizard-map]': wizardMap,
          '[data-wizard-stage]': wizardStage,
          '[data-wizard-homekit]': wizardHomeKit,
          '[data-wizard-eufy]': wizardEufy,
          '[data-wizard-encoders]': wizardEncoders,
          '[data-wizard-encoders-body]': wizardEncodersBody,
          '[data-wizard-settings]': wizardSettings,
          '[data-wizard-controls]': wizardControls,
          '[data-wizard-back]': wizardBack,
          '[data-wizard-next]': wizardNext,
        }[selector];
      },
      querySelectorAll(selector: string) {
        if (selector === '[data-diagnostics-tile]') return diagnosticsTiles;
        return selector === '[data-i18n]' ? translatedNodes : translatedLabels;
      },
      createElement() {
        const element = interactiveElement({
          children: [] as unknown[],
          attributes: {} as Record<string, string>,
          dataset: {} as Record<string, string>,
          append(...children: unknown[]) {
            this.children.push(...children);
          },
          getAttribute(name: string) {
            return this.attributes[name];
          },
          setAttribute(name: string, value: string) {
            this.attributes[name] = value;
          },
          click() {},
          hidden: false,
          textContent: '',
          type: '',
        });
        createdElements.push(element as unknown as Record<string, unknown>);
        return element;
      },
      body: { appendChild() {}, removeChild() {} },
    },
    fetch: async (path: string) => ({
      json: async () => catalogs[path],
      ok: path in catalogs,
    }),
    clearTimeout,
    homebridge: {
      addEventListener(event: string, listener: (event: { data: unknown }) => Promise<void>) {
        if (event === 'ready') {
          ready = listener as () => Promise<void>;
        } else {
          pushListeners[event] = listener;
        }
      },
      getPluginConfig: async () => pluginConfig,
      disableSaveButton: () => {
        saveButtonDisables++;
      },
      enableSaveButton: () => {
        saveButtonEnables++;
      },
      i18nCurrentLang: async () => language,
      request: async (path: string, body: unknown) => {
        if (path === '/diagnostics/status') {
          return diagnosticsSnapshot;
        }
        requests.push({ path, body });
        if (path === '/auth/start') return authenticationStart;
        if (path === '/dashboard') return dashboardSnapshot;
        if (path === '/device/image') return { image: 'c3ludGhldGlj' };
        if (path === '/device/settings') {
          return {
            available: true,
            settings: [{ setting: 'nightVision', value: 1, labels: { '0': 'Off', '1': 'Infrared' }, writable: true }],
          };
        }
        if (path === '/device/settings/write') return { ok: true };
        if (path === '/device/live/start') return { started: true };
        if (path === '/device/live/stop') return { stopped: true };
        if (path === '/diagnostics/encoders') {
          return {
            qualification: { h264_videotoolbox: { 'main@3.1': ['bytes', 442_368, 336_375], 'high@4.0': 'encode' } },
            probeable: ['h264_videotoolbox'],
          };
        }
        if (path === '/diagnostics/authorize') {
          const payload = body as { profile?: unknown };
          if (Object.keys(payload ?? {}).join(',') !== 'profile' || typeof payload.profile !== 'string') {
            throw new Error('Invalid diagnostics request');
          }
          diagnosticsSelectedProfile = payload.profile;
          const authorized = {
            status: 'authorized',
            profile: diagnosticsSelectedProfile,
            reproductionMode: 'now',
            supportCaseId: 'support-00000000-0000-4000-8000-000000000001',
            expiresAt: '2026-08-20T10:18:42.832Z',
            missingEvidence: [],
            partialExportAvailable: false,
          };
          if (authorizeDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, authorizeDelayMs));
            diagnosticsSnapshot = authorized;
          }
          return authorized;
        }
        if (path === '/diagnostics/reproduction/start') {
          return {
            status: 'reproducing',
            expiresAt: '2026-08-20T10:18:42.832Z',
            profile: diagnosticsSelectedProfile,
            reproductionMode: 'now',
            missingEvidence: [],
            partialExportAvailable: false,
          };
        }
        if (path === '/diagnostics/reproduction/end') {
          const complete = {
            status: 'complete',
            supportCaseId: 'support-00000000-0000-4000-8000-000000000001',
            profile: diagnosticsSelectedProfile,
            reproductionMode: 'now',
            missingEvidence: [],
            partialExportAvailable: true,
            issueUrl: 'https://example.invalid/issue',
          };
          if (endResponseLost) {
            diagnosticsSnapshot = complete;
            throw new Error('synthetic lost response');
          }
          return complete;
        }
        if (path === '/diagnostics/archive/review') {
          return {
            reviewId: 'review-synthetic',
            manifest: {
              archiveFormat: 'synthetic',
              version: 2,
              keyId: 'synthetic-key',
              reproductionMode: 'now',
              archiveExpiresAt: '2026-08-20T10:18:42.832Z',
              reproductionStartedAt: '2026-08-19T09:00:00.000Z',
              evidence: [
                {
                  evidence: 'plugin-log',
                  privacyClass: 'diagnostic',
                  status: 'included',
                  bytes: 42,
                  truncated: true,
                  retainedFrom: '2026-08-19T10:00:00.000Z',
                  coversReproduction: false,
                  fields: [{ field: 'event', privacyClass: 'diagnostic' }],
                },
              ],
              excludedClasses: [
                'credentials-and-authentication',
                'tokens-cookies-and-authorization',
                'session-and-push-stores',
                'private-and-symmetric-keys',
                'unconstrained-internal-objects',
                'camera-images-talkback-and-raw-media',
              ],
            },
          };
        }
        if (path === '/diagnostics/ui-event') return undefined;
        if (path === '/diagnostics/cancel') {
          diagnosticsSnapshot = { status: 'inactive', missingEvidence: [], partialExportAvailable: false };
          return diagnosticsSnapshot;
        }
        if (path === '/diagnostics/archive/export') {
          return {
            archive: 'c3ludGhldGlj',
            filename: 'homebridge-eufy-support-00000000-0000-4000-8000-000000000000.eufysupport.gz',
            mediaType: 'application/gzip',
          };
        }
        return { status: 'restart-required' };
      },
      savePluginConfig: async () => {
        if (configWritesFail) throw new Error('synthetic save failure');
        saves++;
      },
      updatePluginConfig: async (config: Array<Record<string, unknown>>) => {
        if (configWritesFail) throw new Error('synthetic update failure');
        const held = updatedConfig ?? pluginConfig;
        const merged = config.map((block, index) =>
          held[index]?.platform === block.platform ? Object.assign({ ...held[index] }, block) : block,
        );
        updatedConfig = JSON.parse(JSON.stringify(merged));
        return config;
      },
      userCurrentLightingMode: async () => 'dark',
    },
    setTimeout,
    window: browserWindow,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });

  await ready?.();
  return {
    menuWizard,
    wizardPanel,
    wizardProgress,
    wizardTitle,
    wizardRestart,
    wizardLive,
    wizardLiveImage,
    wizardLiveStatus,
    wizardLivePlay,
    wizardLiveStop,
    wizardLiveSpinner,
    wizardFinish,
    wizardMap,
    wizardEufy,
    wizardEncoders,
    wizardEncodersBody,
    wizardSettings,
    wizardSettingsStatus,
    wizardControls,
    wizardBack,
    wizardNext,
    pushListeners,
    storage,
    firstSetup,
    authForm,
    authStatus,
    account,
    acknowledgement,
    challengeAnswer,
    challengeForm,
    challengeImage,
    continueButton,
    country,
    password,
    dashboard,
    dashboardState,
    dashboardSummary,
    dashboardAuthenticate,
    reauthDialog,
    reauthAction,
    attentionDialog,
    attentionTitle,
    attentionSummary,
    attentionDiagnose,
    attentionChoose,
    dashboardTitle,
    deviceGroups,
    devicePanel,
    deviceSettingsTitle,
    deviceSettingsControls,
    menuAdvanced,
    warmUpAvailable,
    warmUpChosen,
    warmUpAdd,
    warmUpAddAll,
    warmUpRemove,
    warmUpRemoveAll,
    menuDiagnostics,
    mastheadDiagnostics,
    diagnosticsPanel,
    diagnosticsClose,
    diagnosticsWizardPanel,
    diagnosticsTiles,
    diagnosticsQuestionText,
    diagnosticsCancel,
    diagnosticsReproduction,
    diagnosticsStatus,
    diagnosticsIssue,
    diagnosticsExistingIssue,
    diagnosticsResult,
    diagnosticsActions,
    diagnosticsGuidance,
    diagnosticsPhaseTitle,
    diagnosticsGuidanceAction,
    diagnosticsCaptureNote,
    diagnosticsHandoff,
    diagnosticsHandoffNote,
    diagnosticsResultStatus,
    diagnosticsExport,
    diagnosticsResultHeading,
    diagnosticsStartAnother,
    diagnosticsDownloadAgain,
    advancedPanel,
    advancedClose,
    advancedPolling,
    advancedConcurrentMedia,
    advancedFfmpeg,
    advancedSmallVideoPackets,
    advancedLiveVideoPassthrough,
    advancedHardwareVideoEncoder,
    advancedHdLiveVideo,
    advancedIgnoreHomeBitRate,
    advancedStatus,
    legacyAcknowledge,
    legacyNotice,
    legacyStatus,
    legacySettings,
    createdElements,
    requests,
    setupContent,
    shell,
    masthead,
    get saves() {
      return saves;
    },
    get saveButtonDisables() {
      return saveButtonDisables;
    },
    get saveButtonEnables() {
      return saveButtonEnables;
    },
    get updatedConfig() {
      return updatedConfig;
    },
    /** Makes every later configuration write the page attempts fail, as a Homebridge that cannot save would. */
    set configWritesFail(fail: boolean) {
      configWritesFail = fail;
    },
    /** Makes the plugin carry out an authorization only after this many milliseconds, past the page's deadline. */
    set authorizeDelayMs(delay: number) {
      authorizeDelayMs = delay;
    },
    /** Makes the plugin finish the capture but lose its answer, as a dropped response would. */
    set endResponseLost(lost: boolean) {
      endResponseLost = lost;
    },
    trustedDeviceName,
    browserWindow,
    translatedLabels: Object.fromEntries(
      translatedLabels.map((node) => [node.dataset.i18nAriaLabel, node.attributes['aria-label']]),
    ),
    translations: Object.fromEntries(translatedNodes.map((node) => [node.dataset.i18n, node.textContent])),
  };
}

/**
 * Coded geometry of a baseline JPEG, read from its start-of-frame marker. A controller decodes what this
 * package ships, so a presentation image that is not a decodable baseline JPEG has to fail here rather than
 * on a camera tile.
 */
function baselineJpeg(image: Buffer): { width: number; height: number } {
  let offset = 2;
  while (offset + 9 < image.length) {
    if (image[offset] !== 0xff) {
      throw new Error('not a JPEG segment');
    }
    const marker = image[offset + 1]!;
    const length = image.readUInt16BE(offset + 2);
    if (marker === 0xc0) {
      return { height: image.readUInt16BE(offset + 5), width: image.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error('no baseline start-of-frame marker');
}

describe('packed plugin', () => {
  /**
   * The install surface is exactly the runtime, its presentation assets, and the documents a registry page
   * renders, inside a declared file and byte ceiling.
   *
   * The compiled tree is required to correspond to `src/`, so a module added there must ship and nothing else
   * may. The ceiling stands above the current package, which device artwork dominates: it refuses an
   * accidental addition rather than describing the size as small.
   */
  it('ships exactly the allowlisted install surface, within a declared bound', () => {
    const directory = mkdtempSync(join(tmpdir(), 'homebridge-eufy-security-bounds-'));
    const repository = fileURLToPath(new URL('../..', import.meta.url));

    try {
      const output = execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], {
        cwd: repository,
        encoding: 'utf8',
      });
      const [result] = JSON.parse(output) as PackResult[];
      const paths = result.files.map((file) => file.path);
      const compiledModules = paths.filter((path) => path.startsWith('dist/')).sort();
      const sourceModules = readdirSync(join(repository, 'src'), { recursive: true })
        .map((entry) => entry.toString())
        .filter((path) => path.endsWith('.ts'))
        .flatMap((path) => [`dist/${path.replace(/\.ts$/, '.js')}`, `dist/${path.replace(/\.ts$/, '.js.map')}`])
        .sort();

      expect([...new Set(paths.map((path) => path.split('/')[0]))].sort(), 'nothing new appears at the root').toEqual([
        'AUTHORS',
        'CHANGELOG.md',
        'CODE_OF_CONDUCT.md',
        'CONTRIBUTING.md',
        'LICENSE',
        'README.md',
        'SECURITY.md',
        'config.schema.json',
        'dist',
        'homebridge-ui',
        'i18n',
        'media',
        'package.json',
      ]);
      expect(
        compiledModules,
        'every module compiles into the package with the map its stack traces resolve through, and nothing else does',
      ).toEqual(sourceModules);
      expect(
        paths.filter((path) => /(?:^|\/)(?:src|test|scripts|docs|prototypes?|fixtures?|captures?)\//.test(`/${path}`)),
        'no source, specification, fixture, prototype, or capture directory ships',
      ).toEqual([]);
      expect(
        paths.filter((path) =>
          /\.(?:d\.ts|ts|tsx|tsbuildinfo|xcf|log|mp4|mkv|h264|h265|opus|aac|eufysupport\.gz)$/.test(path),
        ),
        'no build byproduct, editable master, or recorded media ships',
      ).toEqual([]);
      expect(result.unpackedSize, 'the package holds a bounded number of bytes').toBeLessThanOrEqual(14_000_000);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  }, 15_000);

  /**
   * Every GitHub location the manifest publishes names one repository, over a protocol that still serves it.
   *
   * The npm name is a fixed identity and is deliberately not that repository's name. A rename therefore has
   * to move these three and leave the name alone, and moving only some of them leaves a registry page whose
   * links resolve to nothing.
   */
  it('publishes GitHub locations that name one repository over a live protocol', () => {
    const repository = fileURLToPath(new URL('../..', import.meta.url));
    const packageJson = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')) as {
      repository?: { url?: string };
      bugs?: { url?: string };
      homepage?: string;
    };
    const slug = 'homebridge-plugins/homebridge-eufy';
    const [owner, name] = slug.split('/');

    expect(packageJson.repository?.url).toBe(`git+https://github.com/${slug}.git`);
    expect(packageJson.bugs?.url).toBe(`https://github.com/${slug}/issues`);
    expect(packageJson.homepage).toBe(`https://${owner}.github.io/${name}/`);
  });

  it('keeps the runtime dependency and entry-point surface closed', () => {
    const repository = fileURLToPath(new URL('../..', import.meta.url));
    const packageJson = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')) as {
      displayName: string;
      name: string;
      version: string;
      main?: string;
      dependencies?: Record<string, string>;
    };

    expect(packageJson.displayName).toBe('Homebridge Eufy');
    expect(packageJson.name).toBe('@homebridge-plugins/homebridge-eufy-security');
    expect(packageJson.main).toBe('dist/index.js');
    expect(Object.keys(packageJson.dependencies ?? {}).sort()).toEqual([
      '@homebridge/plugin-ui-utils',
      '@mega-yfue/eufy-sdk',
      'ffmpeg-for-homebridge',
    ]);
  });

  it('contains an importable runtime and production custom UI shell', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'homebridge-eufy-security-'));
    const repository = fileURLToPath(new URL('../..', import.meta.url));

    try {
      const output = execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], {
        cwd: repository,
        encoding: 'utf8',
      });
      const [result] = JSON.parse(output) as PackResult[];
      execFileSync('tar', ['-xzf', join(directory, result.filename), '-C', directory]);

      const packageDirectory = join(directory, 'package');
      const packedPackage = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8')) as {
        name: string;
      };
      const schema = JSON.parse(readFileSync(join(packageDirectory, 'config.schema.json'), 'utf8')) as {
        customUi?: boolean;
      };
      const document = readFileSync(join(packageDirectory, 'homebridge-ui', 'public', 'index.html'), 'utf8');
      const script = ['dashboard.js', 'legacy-settings.js', 'profile-wizard.js', 'setup-wizard.js', 'app.js']
        .map((file) => readFileSync(join(packageDirectory, 'homebridge-ui', 'public', 'js', file), 'utf8'))
        .join('\n');
      const server = readFileSync(join(packageDirectory, 'homebridge-ui', 'server.js'), 'utf8');
      const stylesheet = readFileSync(join(packageDirectory, 'homebridge-ui', 'public', 'app.css'), 'utf8');
      const runtimeMessages = JSON.parse(
        readFileSync(join(packageDirectory, 'i18n', 'runtime', 'en.json'), 'utf8'),
      ) as Record<string, string>;
      const catalogs = Object.fromEntries(
        ['en', 'fr'].map((language) => [
          `i18n/${language}.json`,
          JSON.parse(
            readFileSync(join(packageDirectory, 'homebridge-ui', 'public', 'i18n', `${language}.json`), 'utf8'),
          ) as Record<string, string>,
        ]),
      );
      const logos = ['logo.svg', 'logo-dark.svg'].map((file) =>
        readFileSync(join(packageDirectory, 'homebridge-ui', 'public', 'assets', file), 'utf8'),
      );
      const darkTheme = stylesheet.match(/\.shell\[data-theme=['"]dark['"]\] \{(?<declarations>[^}]+)\}/)?.groups
        ?.declarations;
      const translationKeys = [
        ...new Set([...document.matchAll(/data-i18n="([^"]+)"/g)].map((match) => match[1])),
      ].sort();
      const translatedLabelKeys = [
        ...new Set([...document.matchAll(/data-i18n-aria-label="([^"]+)"/g)].map((match) => match[1])),
      ].sort();
      const uiFiles = result.files
        .map((file) => file.path)
        .filter((path) => path.startsWith('homebridge-ui/'))
        .sort();
      const deviceArtworkFiles = uiFiles.filter((path) => path.startsWith('homebridge-ui/public/assets/devices/'));
      const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
      const uiSourceFiles = readdirSync(join(repositoryRoot, 'homebridge-ui'), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => relative(repositoryRoot, join(entry.parentPath, entry.name)))
        .sort();

      expect(packedPackage.name).toBe('@homebridge-plugins/homebridge-eufy-security');
      expect(schema.customUi).toBe(true);
      expect(result.files.map((file) => file.path)).toContain('dist/ui/server.js');
      expect(result.files.map((file) => file.path)).toContain('i18n/runtime/en.json');
      expect(
        result.files
          .map((file) => file.path)
          .filter((path) => path.startsWith('media/'))
          .sort(),
        'exactly the presentation images ship, and no editable master',
      ).toEqual([
        'media/Snapshot-Unavailable.jpg',
        'media/Snapshot-black.jpg',
        'media/camera-disabled.jpg',
        'media/camera-offline.jpg',
      ]);
      expect(
        baselineJpeg(readFileSync(join(packageDirectory, 'media', 'Snapshot-Unavailable.jpg'))),
        'placeholder',
      ).toEqual({
        width: 1920,
        height: 1080,
      });
      expect(
        result.files.map((file) => file.path).filter((path) => path.startsWith('scripts/')),
        'no script is reachable from an installed plugin, so the directory ships nothing',
      ).toEqual([]);
      expect(Object.keys(runtimeMessages).every((key) => key.startsWith('log.'))).toBe(true);
      expect(runtimeMessages['log.condition.active']).toContain('{summary}');
      expect(uiFiles, 'every checked-in UI file ships').toEqual(uiSourceFiles);
      expect(
        deviceArtworkFiles.every((path) =>
          /^homebridge-ui\/public\/assets\/devices\/(?:clean|life|mower|security)\/[A-Za-z0-9-]+\.webp$/.test(path),
        ),
      ).toBe(true);
      expect(document).toContain('data-authentication="ready"');
      expect(document).toContain('aria-current="step"');
      expect(document).toContain('href="app.css"');
      expect(document).toContain('src="js/app.js"');
      expect(document).toContain('src="js/dashboard.js"');
      expect(document).toContain('src="js/profile-wizard.js"');
      expect(document).toContain('src="js/legacy-settings.js"');
      expect(document).toContain('src="assets/logo.svg"');
      expect(document).toContain('src="assets/logo-dark.svg"');
      expect(document).toContain('src="assets/icons/inventory.svg"');
      expect(document).toContain('src="assets/icons/bug-report.svg"');
      expect(document).toContain('src="assets/icons/settings.svg"');
      expect(document).toContain('src="assets/icons/warning.svg"');
      // Three panels now: diagnostics, advanced, and one device's settings, each with the same way back.
      expect(document.match(/class="dashboard-page-back"/g)).toHaveLength(4);
      expect(document.match(/aria-hidden="true">←<\/span>/g)).toHaveLength(4);
      expect(document).toContain('data-diagnostics-handoff');
      expect(
        document.match(
          /(?:data-i18n="diagnosticsTilesHeading"\s*><\/h3>|data-attention-summary><\/p>)\s*<p class="diagnostics-note" data-i18n="diagnosticsPrivacy">/g,
        ),
        'the privacy note sits above the areas, and above the attention dialog action that starts a capture',
      ).toHaveLength(2);
      expect(document).toContain('data-diagnostics-export');
      expect(document).not.toContain('diagnostics-steps');
      expect(document).not.toContain('data-diagnostics-case');
      expect(document).not.toMatch(/\/issues\/1010\b/);
      expect(script).toContain("'/diagnostics/archive/review'");
      expect(script).toContain("'/diagnostics/archive/export'");
      expect(script).toContain('data:${exported.mediaType};base64,${exported.archive}');
      expect(script).not.toContain('URL.createObjectURL');
      expect(document).toContain('data-first-setup hidden');
      expect(document).toContain('data-first-setup-ack');
      expect(document).toContain('data-first-setup-continue');
      expect(document).toContain('data-auth-form');
      expect(document).toContain('data-challenge-form');
      expect(document).toMatch(/data-setup-content\s+hidden/);
      expect(document).toContain('support.eufylife.com/s/article/Share-Your-eufySecurity-Devices-With-Your-Family');
      expect(document).not.toContain('Connect your Eufy account');
      expect(document).not.toContain('First-time setup');
      expect(translationKeys).toEqual(
        [
          'accountLabel',
          'acknowledge',
          'advancedConcurrentMediaHelp',
          'advancedConcurrentMediaLabel',
          'advancedDeviceHelp',
          'advancedEyebrow',
          'advancedFfmpegHelp',
          'advancedFfmpegLabel',
          'advancedPollingHelp',
          'advancedLiveVideoPassthroughHelp',
          'advancedLiveVideoPassthroughLabel',
          'advancedHardwareVideoEncoderHelp',
          'advancedHardwareVideoEncoderLabel',
          'advancedHdLiveVideoHelp',
          'advancedHdLiveVideoLabel',
          'advancedIgnoreHomeBitRateHelp',
          'advancedIgnoreHomeBitRateLabel',
          'advancedPollingLabel',
          'advancedSmallVideoPacketsHelp',
          'advancedSmallVideoPacketsLabel',
          'advancedSummary',
          'advancedTitle',
          'advancedWarmUpAvailable',
          'advancedWarmUpChosen',
          'advancedWarmUpHelp',
          'advancedWarmUpLabel',
          'authenticate',
          'authReady',
          'authSummary',
          'available',
          'brand',
          'firstSetupEyebrow',
          'firstSetupIntro',
          'firstSetupAcknowledgement',
          'firstSetupContinue',
          'firstSetupReasonBody',
          'firstSetupReasonLabel',
          'firstSetupTitle',
          'footnote',
          'continueAuthentication',
          'countryLabel',
          'devicesEyebrow',
          'diagnosticsActionLabel',
          'diagnosticsArchiveExport',
          'diagnosticsEvidenceReady',
          'diagnosticsExistingIssue',
          'diagnosticsEyebrow',
          'diagnosticsOpenIssue',
          'diagnosticsProfileControl',
          'diagnosticsProfileDashboard',
          'diagnosticsProfileDevices',
          'diagnosticsProfileLiveMedia',
          'diagnosticsProfileOther',
          'diagnosticsProfileRecording',
          'diagnosticsTilesHeading',
          'diagnosticsProfileStartup',
          'diagnosticsPrivacy',
          'diagnosticsNowFinish',
          'diagnosticsCancel',
          'diagnosticsCapturing',
          'diagnosticsStartupSummary',
          'diagnosticsDevicesSummary',
          'diagnosticsControlSummary',
          'diagnosticsLiveSummary',
          'diagnosticsRecordingSummary',
          'diagnosticsDashboardSummary',
          'diagnosticsOtherSummary',
          'diagnosticsStartAnother',
          'diagnosticsDownloadAgain',
          'diagnosticsTitle',
          'oneAccountSession',
          'pageTitle',
          'passwordLabel',
          'reauthAction',
          'reauthSummary',
          'reauthTitle',
          'legacyEyebrow',
          'legacySummary',
          'legacyTitle',
          'sessionDetails',
          'setupStatusEyebrow',
          'shareLink',
          'stepAuthenticate',
          'stepDevices',
          'stepDiscover',
          'attentionChooseAnother',
          'attentionDiagnose',
          'menuDiagnostics',
          'trustedDeviceLabel',
          'updatePendingAction',
          'updatePendingTitle',
          'wizardEncodersHelp',
          'wizardEncodersTitle',
          'wizardEufyHelp',
          'wizardEufySettings',
          'wizardHomeKitHelp',
          'wizardHomeKitTitle',
          'wizardRestartSummary',
        ].sort(),
      );
      expect(translatedLabelKeys).toEqual([
        'accountConnectionLabel',
        'advancedWarmUpAdd',
        'advancedWarmUpAddAll',
        'advancedWarmUpRemove',
        'advancedWarmUpRemoveAll',
        'closeAdvanced',
        'closeDetails',
        'closeDiagnostics',
        'closeWizard',
        'dashboardActionsLabel',
        'menuAdvanced',
        'menuDiagnostics',
        'menuRelogin',
        'menuWizard',
        'setupSequenceLabel',
        'wizardBack',
        'wizardLivePlay',
        'wizardLiveStop',
        'wizardMapLabel',
        'wizardNext',
      ]);
      /**
       * A condition the dashboard names is worded under the log keys it is reported with, and the ones the page
       * answers on its own (a sign-in, another owner, a stopped plugin) or no action resolves are left unworded.
       */
      const conditionKeys = Object.keys(catalogs['i18n/en.json']).filter((key) => key.startsWith('log.'));
      expect(conditionKeys.filter((key) => !(key in runtimeMessages))).toEqual([]);
      expect(
        conditionKeys.filter((key) =>
          [
            'log.runtime.authenticationRequired',
            'log.runtime.ownerConflict',
            'log.runtime.failed',
            'log.homekit.recognizedNotRepresented',
          ].includes(key),
        ),
      ).toEqual([]);
      const expectedCatalogKeys = [
        ...translationKeys,
        ...translatedLabelKeys.filter((key) => !translationKeys.includes(key)),
        'authCommitFailed',
        'authFailed',
        'authPluginRunning',
        'authSaveFailed',
        'authSuccess',
        'authTimedOut',
        'attentionUnreachableSummary',
        'attentionUnreachableTitle',
        'countryInvalid',
        'advancedSaveFailed',
        'advancedPollingInvalid',
        'advancedConcurrentMediaInvalid',
        // Read from JS, keyed by the SDK's own event name; an event without one falls back to a derived label.
        'advancedWarmUpEvent_doorbellPress',
        'advancedWarmUpEvent_motion',
        'advancedWarmUpEvent_packageDelivered',
        'advancedWarmUpEvent_personDetected',
        'advancedWarmUpEvent_petDetection',
        'captchaLabel',
        'captchaRetry',
        'twoFactorLabel',
        'twoFactorSent',
        'wizardClose',
        'wizardEncoderBytes',
        'wizardEncoderFailed',
        'wizardEncoderFormat',
        'wizardEncoderTurnedDown',
        'wizardEncoderWorks',
        'wizardEncodersUnavailable',
        'wizardEncodersUsed',
        'wizardProbeNothing',
        'wizardProbeRun',
        'wizardProbeRunning',
        'wizardProbe_10s',
        'wizardProbe_as-is',
        'wizardProbe_constant-bit-rate',
        'wizardProbe_qmax-51',
        'wizardProbe_smptebars',
        'wizardFinish',
        'wizardLiveFailed',
        'wizardLiveStarting',
        'wizardMotionDetection',
        'wizardMapBase',
        'wizardMapStandalone',
        'wizardNightVision',
        'wizardNotificationStyle',
        'wizardProgress',
        'wizardSettingFailed',
        'wizardSettingSending',
        'wizardSettingSent',
        'wizardTitle',
        'cameraOwnArming',
        'categoryClean',
        'categoryLife',
        'categorySecurity',
        'dashboardAuthenticationRequiredSummary',
        'dashboardAuthenticationRequiredTitle',
        'dashboardDegradedSummary',
        'dashboardDegradedTitle',
        'dashboardFailedSummary',
        'dashboardFailedTitle',
        'dashboardIncompleteSummary',
        'dashboardIncompleteTitle',
        'dashboardMissingSummary',
        'dashboardMissingTitle',
        'dashboardOwnerConflictSummary',
        'dashboardOwnerConflictTitle',
        'dashboardPageTitle',
        'dashboardReadySummary',
        'dashboardReadyTitle',
        'dashboardRestartRequiredSummary',
        'dashboardRestartRequiredTitle',
        'dashboardStaleSummary',
        'dashboardStaleTitle',
        'dashboardUnreachableSummary',
        'dashboardUnreachableTitle',
        'diagnosticDescription',
        'diagnosticNoAction',
        'diagnosticOnly',
        'diagnosticsArchiveDownloaded',
        'diagnosticsArchiveHandoff',
        'diagnosticsAttention',
        'diagnosticsCaptureKeepsRunning',
        'diagnosticsCaptureTimedOut',
        'diagnosticsCollectingFinishHere',
        'diagnosticsControlAction',
        'diagnosticsDashboardAction',
        'diagnosticsDevicesAction',
        'diagnosticsFailed',
        'diagnosticsLiveAction',
        'diagnosticsMissingEvidence',
        'diagnosticsOtherAction',
        'diagnosticsRecordingAction',
        'diagnosticsStartupAction',
        'deviceBattery',
        'deviceStatusHidden',
        'deviceStatusOnline',
        'deviceStatusSwitchedOff',
        'deviceStatusUnreachable',
        'armingModesHelp',
        'armingSlotAway',
        'armingSlotHome',
        'armingSlotNight',
        'armingSlotOff',
        'preferenceArmingModes',
        'preferenceAudio',
        'preferenceRepresented',
        'preferenceSaveFailed',
        'preferenceSecuritySystem',
        'preferenceSnapshotMode',
        'snapshotModeCloudDescription',
        'snapshotModeLiveDescription',
        'snapshotModeHelp',
        'snapshotModeRefreshDescription',
        'representationLabel',
        'serviceCamera',
        'serviceCameraSwitches',
        'serviceContact',
        'serviceDoorbell',
        'serviceLight',
        'serviceLock',
        'serviceMotion',
        'serviceSecuritySystem',
        'serviceSiren',
        'updatePendingBusy',
        'updatePendingFailed',
        'updatePendingManual',
        'updatePendingSummary',
        'updatePendingVersionLabel',
        ...conditionKeys,
      ].sort();
      expect(Object.keys(catalogs['i18n/en.json']).sort()).toEqual(expectedCatalogKeys);
      expect(Object.keys(catalogs['i18n/fr.json']).sort()).toEqual(expectedCatalogKeys);
      expect([document, script, JSON.stringify(Object.values(catalogs).map(Object.values))].join('\n')).not.toMatch(
        /\b(?:SDK|runtime|IPC)\b/i,
      );
      expect(logos.join('\n')).not.toMatch(/\bSDK\b/i);
      expect(document).not.toMatch(/<!doctype|<(?:html|head|body)(?:\s|>)/i);
      expect(script).toContain('homebridge.userCurrentLightingMode()');
      expect(server).toContain("from '../dist/ui/server.js'");
      expect(stylesheet).toContain('--accent: #00bfc4');
      expect(stylesheet).toContain('.device-tile-changed');
      expect(stylesheet).toContain('.preference-changed');
      expect(stylesheet).toContain('.device-panel .preference-grid');
      expect(
        stylesheet,
        'the flip apparatus is deleted rather than left unreachable, transforms and away-facing rules included',
      ).not.toMatch(/device-card|device-tile-flipped|device-mobile-close|device-flip-control|perspective|backface/);
      expect(stylesheet, 'a finger gets a 44px row wherever the pointer is coarse').toContain(
        '@media (pointer: coarse)',
      );
      expect(darkTheme).toContain('--ink: #edf1f7');
      expect(darkTheme).not.toContain('var(--bs-');

      const firstSetupUi = await renderUi(script, [], catalogs);
      expect(firstSetupUi).toMatchObject({
        continueButton: { disabled: true },
        firstSetup: { hidden: false },
        setupContent: { hidden: true },
        saveButtonDisables: 1,
        saveButtonEnables: 0,
      });
      await firstSetupUi.continueButton.dispatch('click');
      expect(firstSetupUi).toMatchObject({ firstSetup: { hidden: false }, setupContent: { hidden: true } });
      firstSetupUi.acknowledgement.checked = true;
      await firstSetupUi.acknowledgement.dispatch('change');
      expect(firstSetupUi.continueButton.disabled).toBe(false);
      await firstSetupUi.continueButton.dispatch('click');
      expect(firstSetupUi).toMatchObject({ firstSetup: { hidden: true }, setupContent: { hidden: false } });

      await expect(renderUi(script, [{ platform: 'HomebridgeEufy' }], catalogs)).resolves.toMatchObject({
        firstSetup: { hidden: false },
        setupContent: { hidden: true },
      });
      await expect(
        renderUi(script, [{ platform: 'HomebridgeEufy', username: 'guest@example.invalid' }], catalogs),
      ).resolves.toMatchObject({
        firstSetup: { hidden: true },
        setupContent: { hidden: true },
        dashboard: { hidden: false, dataset: { state: 'ready' } },
        masthead: { hidden: true },
        shell: { dataset: { theme: 'dark' } },
      });

      const frenchUi = await renderUi(script, [], catalogs, 'fr-FR', translationKeys);
      expect(frenchUi).toMatchObject({
        shell: { lang: 'fr' },
        translations: {
          firstSetupTitle: 'Utilisez un compte invité Eufy dédié',
          footnote:
            'Indépendant et non officiel. Non affilié, approuvé ou sponsorisé par Anker Innovations ou eufy. « eufy » et « Anker » sont des marques de leurs propriétaires respectifs. Utilisez ce logiciel de manière responsable : des connexions rapides ou échouées peuvent déclencher un captcha ou une limitation temporaire.',
          pageTitle: 'Connectez votre compte Eufy',
        },
      });
      expect(Object.values(frenchUi.translations)).not.toContain('__untranslated__');
      expect(Object.values(frenchUi.translations)).not.toContain(undefined);
      expect(frenchUi.translatedLabels).toEqual({
        accountConnectionLabel: 'Informations sur la connexion du compte',
        advancedWarmUpAdd: 'Préchauffer les événements sélectionnés',
        advancedWarmUpAddAll: 'Préchauffer tous les événements',
        advancedWarmUpRemove: 'Ne plus préchauffer les événements sélectionnés',
        advancedWarmUpRemoveAll: 'Ne plus préchauffer aucun événement',
        closeAdvanced: 'Retour aux appareils',
        closeDiagnostics: 'Retour aux appareils',
        dashboardActionsLabel: 'Actions du tableau de bord',
        menuAdvanced: 'Réglages avancés',
        menuDiagnostics: 'Diagnostic',
        menuRelogin: 'Se reconnecter ou remplacer le compte',
        setupSequenceLabel: 'Étapes de configuration',
      });
      const englishUi = await renderUi(script, [], catalogs, 'es', translationKeys);
      expect(englishUi).toMatchObject({
        shell: { lang: 'en' },
        translations: {
          footnote:
            'Independent and unofficial. Not affiliated with, endorsed by, or sponsored by Anker Innovations or eufy. "eufy" and "Anker" are trademarks of their respective owners. Use responsibly — rapid or failed logins can trigger captcha or temporary cooldowns.',
          pageTitle: 'Connect your Eufy account',
        },
      });
      expect(Object.values(englishUi.translations)).not.toContain('__untranslated__');
      expect(Object.values(englishUi.translations)).not.toContain(undefined);

      const menuUi = await renderUi(
        script,
        [
          {
            platform: 'HomebridgeEufy',
            username: 'guest@example.invalid',
            pollingIntervalMinutes: 15,
            ffmpegPath: '/synthetic/ffmpeg',
          },
        ],
        catalogs,
      );
      const warmUpUi = await renderUi(
        script,
        [
          {
            platform: 'HomebridgeEufy',
            username: 'guest@example.invalid',
            warmUpEvents: ['doorbellPress', 'motion'],
          },
        ],
        catalogs,
        'en',
        [],
        undefined,
        { state: 'ready', devices: [], warmUpCandidates: ['doorbellPress', 'motion', 'personDetected'] },
      );
      await warmUpUi.menuAdvanced.dispatch('click');

      /** Both columns are drawn from the chosen list, and every entry is reachable as a button. */
      const entries = (column: { children: unknown[] }) =>
        column.children.map((item) => (item as { children: [{ textContent: string }] }).children[0].textContent);
      expect(entries(warmUpUi.warmUpChosen as never)).toEqual(['Doorbell press', 'Motion']);
      expect(
        entries(warmUpUi.warmUpAvailable as never),
        'the panel asks for its own candidates, so it works without the devices view being opened first',
      ).toEqual(['Person seen']);
      expect(warmUpUi.warmUpRemove.disabled, 'nothing is marked yet, so the single arrow moves nothing').toBe(true);
      expect(warmUpUi.warmUpRemoveAll.disabled, 'there is something to clear, so the double arrow acts').toBe(false);

      await warmUpUi.warmUpRemoveAll.dispatch('click');

      expect(warmUpUi.updatedConfig?.[0]!.warmUpEvents, 'the double arrow empties the column in one move').toEqual([]);
      expect(entries(warmUpUi.warmUpChosen as never)).toEqual([]);
      expect(warmUpUi.warmUpRemoveAll.disabled, 'and disables itself once there is nothing left').toBe(true);

      await warmUpUi.warmUpAddAll.dispatch('click');

      expect(
        warmUpUi.updatedConfig?.[0]!.warmUpEvents,
        'and back again in one move, every candidate the devices report',
      ).toEqual(['doorbellPress', 'motion', 'personDetected']);

      await menuUi.menuDiagnostics.dispatch('click');
      expect(menuUi).toMatchObject({
        dashboard: { hidden: true },
        diagnosticsPanel: { hidden: false },
        diagnosticsIssue: { hidden: true },
        diagnosticsResult: { open: false },
        diagnosticsWizardPanel: { hidden: false },
        diagnosticsActions: { hidden: true },
      });
      const controlTile = menuUi.diagnosticsTiles.find(
        (tile) => (tile as { dataset: { diagnosticsTile: string } }).dataset.diagnosticsTile === 'control-state',
      )!;
      await controlTile.dispatch('click');
      expect(
        menuUi.requests.filter(({ path }) => path.startsWith('/diagnostics/') && path !== '/diagnostics/ui-event'),
        'one pick opens the session and starts the capture, asking nothing else',
      ).toEqual([
        { path: '/diagnostics/authorize', body: { profile: 'control-state' } },
        { path: '/diagnostics/reproduction/start', body: undefined },
      ]);
      expect(menuUi, 'the capture screen follows the pick').toMatchObject({
        diagnosticsWizardPanel: { hidden: true },
        diagnosticsGuidance: { hidden: false },
        diagnosticsPhaseTitle: { focused: true, textContent: catalogs['i18n/en.json'].diagnosticsProfileControl },
        diagnosticsStatus: { textContent: '' },
        diagnosticsGuidanceAction: { textContent: catalogs['i18n/en.json'].diagnosticsControlAction },
        diagnosticsActions: { hidden: false },
        diagnosticsReproduction: { disabled: false },
      });
      expect(menuUi.diagnosticsCaptureNote.textContent, 'the capture screen says when it stops on its own').toBe(
        catalogs['i18n/en.json'].diagnosticsCaptureKeepsRunning.replace(
          '{time}',
          new Date('2026-08-20T10:18:42.832Z').toLocaleString('en', {
            weekday: 'long',
            hour: 'numeric',
            minute: '2-digit',
          }),
        ),
      );
      expect(
        [menuUi.menuDiagnostics, menuUi.mastheadDiagnostics],
        'a capture on any area marks both diagnostics actions, in words as well as colour',
      ).toMatchObject([
        {
          dataset: { collecting: 'true' },
          attributes: { 'aria-label': catalogs['i18n/en.json'].diagnosticsCollectingFinishHere },
        },
        { dataset: { collecting: 'true' } },
      ]);
      expect(document.match(/class="diagnostics-capturing" data-i18n="diagnosticsCapturing"/g)).toHaveLength(2);
      expect(document, 'the dashboard action names itself in words at rest, not only to a screen reader').toMatch(
        /data-menu-diagnostics[^>]*>\s*<img[^>]*>\s*<span class="diagnostics-name" data-i18n="menuDiagnostics">/,
      );
      await menuUi.diagnosticsCancel.dispatch('click');
      expect(menuUi.requests.at(-1), 'cancel asks the plugin to delete the session').toEqual({
        path: '/diagnostics/cancel',
        body: undefined,
      });
      expect(menuUi, 'and puts the areas back').toMatchObject({
        diagnosticsWizardPanel: { hidden: false },
        diagnosticsQuestionText: { focused: true },
        diagnosticsGuidance: { hidden: true },
        diagnosticsResult: { open: false },
        menuDiagnostics: { dataset: {} },
      });
      await controlTile.dispatch('click');
      await menuUi.diagnosticsReproduction.dispatch('click');
      expect(menuUi.requests).toContainEqual({ path: '/diagnostics/reproduction/end', body: undefined });
      expect(menuUi).toMatchObject({
        diagnosticsResult: { open: true },
        diagnosticsWizardPanel: { hidden: true },
        diagnosticsResultHeading: { focused: true },
      });
      await menuUi.diagnosticsClose.dispatch('click');
      expect(menuUi.diagnosticsPanel.hidden).toBe(true);
      expect(menuUi).toMatchObject({
        dashboardState: { hidden: false },
        dashboardSummary: { hidden: false },
        deviceGroups: { hidden: false },
      });
      await menuUi.menuAdvanced.dispatch('click');
      expect(menuUi).toMatchObject({
        advancedPanel: { hidden: false },
        advancedPolling: { value: '15' },
        advancedFfmpeg: { value: '/synthetic/ffmpeg' },
        advancedHardwareVideoEncoder: { checked: true },
      });
      menuUi.advancedPolling.value = '5';
      await menuUi.advancedPolling.dispatch('change');
      expect(menuUi.updatedConfig?.[0]).toMatchObject({ pollingIntervalMinutes: 5, ffmpegPath: '/synthetic/ffmpeg' });
      menuUi.advancedPolling.value = '';
      await menuUi.advancedPolling.dispatch('change');
      expect(menuUi.updatedConfig?.[0]).not.toHaveProperty('pollingIntervalMinutes');
      menuUi.advancedPolling.value = '2.5';
      await menuUi.advancedPolling.dispatch('change');
      expect(menuUi.advancedPolling.validityMessage).toBe(catalogs['i18n/en.json'].advancedPollingInvalid);
      expect(menuUi.updatedConfig?.[0]).not.toHaveProperty('pollingIntervalMinutes');
      menuUi.advancedPolling.value = '';
      menuUi.advancedConcurrentMedia.value = '3';
      await menuUi.advancedConcurrentMedia.dispatch('change');
      expect(menuUi.updatedConfig?.[0]).toMatchObject({ maxConcurrentMediaSessions: 3 });
      menuUi.advancedConcurrentMedia.value = '0';
      await menuUi.advancedConcurrentMedia.dispatch('change');
      expect(
        menuUi.updatedConfig?.[0],
        'unlimited is what an absent key already means, so storing a zero would only pin today default',
      ).not.toHaveProperty('maxConcurrentMediaSessions');
      menuUi.advancedSmallVideoPackets.checked = true;
      await menuUi.advancedSmallVideoPackets.dispatch('change');
      expect(menuUi.updatedConfig?.[0]).toMatchObject({ smallVideoPackets: true });
      menuUi.advancedSmallVideoPackets.checked = false;
      await menuUi.advancedSmallVideoPackets.dispatch('change');
      expect(menuUi.updatedConfig?.[0]).not.toHaveProperty('smallVideoPackets');
      menuUi.advancedLiveVideoPassthrough.checked = true;
      await menuUi.advancedLiveVideoPassthrough.dispatch('change');
      expect(menuUi.updatedConfig?.[0]).toMatchObject({ liveVideoPassthrough: true });
      menuUi.advancedLiveVideoPassthrough.checked = false;
      await menuUi.advancedLiveVideoPassthrough.dispatch('change');
      expect(menuUi.updatedConfig?.[0]).not.toHaveProperty('liveVideoPassthrough');
      menuUi.advancedHardwareVideoEncoder.checked = false;
      await menuUi.advancedHardwareVideoEncoder.dispatch('change');
      expect(menuUi.updatedConfig?.[0]).toMatchObject({ hardwareVideoEncoder: false });
      menuUi.advancedHardwareVideoEncoder.checked = true;
      await menuUi.advancedHardwareVideoEncoder.dispatch('change');
      expect(
        menuUi.updatedConfig?.[0],
        'on is what an absent key already means, so it is not stored',
      ).not.toHaveProperty('hardwareVideoEncoder');
      menuUi.advancedHdLiveVideo.checked = true;
      await menuUi.advancedHdLiveVideo.dispatch('change');
      expect(menuUi.updatedConfig?.[0]).toMatchObject({ hdLiveVideo: true });
      menuUi.advancedHdLiveVideo.checked = false;
      await menuUi.advancedHdLiveVideo.dispatch('change');
      expect(menuUi.updatedConfig?.[0]).not.toHaveProperty('hdLiveVideo');
      menuUi.advancedIgnoreHomeBitRate.checked = true;
      await menuUi.advancedIgnoreHomeBitRate.dispatch('change');
      expect(menuUi.updatedConfig?.[0]).toMatchObject({ ignoreHomeBitRate: true });
      menuUi.advancedIgnoreHomeBitRate.checked = false;
      await menuUi.advancedIgnoreHomeBitRate.dispatch('change');
      expect(menuUi.updatedConfig?.[0]).not.toHaveProperty('ignoreHomeBitRate');
      menuUi.advancedConcurrentMedia.value = '1.5';
      await menuUi.advancedConcurrentMedia.dispatch('change');
      expect(menuUi.advancedConcurrentMedia.validityMessage).toBe(
        catalogs['i18n/en.json'].advancedConcurrentMediaInvalid,
      );
      expect(menuUi.updatedConfig?.[0]).not.toHaveProperty('maxConcurrentMediaSessions');
      await menuUi.advancedClose.dispatch('click');
      expect(menuUi.advancedPanel.hidden).toBe(true);

      const nowDiagnosticsUi = await renderUi(
        script,
        [{ platform: 'HomebridgeEufy', username: 'guest@example.invalid' }],
        catalogs,
        'en',
        [],
        undefined,
        undefined,
        {
          status: 'authorized',
          profile: 'control-state',
          reproductionMode: 'now',
          missingEvidence: [],
          partialExportAvailable: false,
        },
      );
      expect(nowDiagnosticsUi, 'a session opened and never started is still a question to answer').toMatchObject({
        diagnosticsWizardPanel: { hidden: false },
        diagnosticsGuidance: { hidden: true },
        diagnosticsStatus: { textContent: '' },
      });

      const waitingDiagnosticsUi = await renderUi(
        script,
        [{ platform: 'HomebridgeEufy', username: 'guest@example.invalid' }],
        catalogs,
        'en',
        [],
        undefined,
        undefined,
        {
          status: 'reproducing',
          profile: 'live-media',
          reproductionMode: 'intermittent',
          missingEvidence: [],
          partialExportAvailable: false,
        },
      );
      expect(waitingDiagnosticsUi, 'a capture persisted as intermittent is finished like any other').toMatchObject({
        diagnosticsGuidance: { hidden: false },
        diagnosticsGuidanceAction: { textContent: catalogs['i18n/en.json'].diagnosticsLiveAction },
        diagnosticsReproduction: { disabled: false },
      });

      /**
       * Opened while the sign-in screen is up, the panel still asks, beside the privacy note, and puts focus on the
       * startup area. Nothing is captured until the reporter picks it.
       */
      const signingInUi = await renderUi(
        script,
        [{ platform: 'HomebridgeEufy', username: 'guest@example.invalid' }],
        catalogs,
        'en',
        [],
        undefined,
        { state: 'authentication-required', devices: [] },
      );
      expect(signingInUi.setupContent.hidden, 'a dashboard that needs a sign-in shows the sign-in').toBe(false);
      expect(signingInUi.reauthDialog.open, 'the sign-in is already the page, so nothing blocks it').toBe(false);

      /**
       * A runtime that stopped on a session it can no longer use still knows the account's devices, so the page
       * would otherwise show them as if nothing were wrong. A dialog in front of everything says what happened and
       * leads to the sign-in; Escape does not dismiss it.
       */
      const sessionLostUi = await renderUi(
        script,
        [{ platform: 'HomebridgeEufy', username: 'guest@example.invalid' }],
        catalogs,
        'en',
        [],
        undefined,
        {
          state: 'authentication-required',
          devices: [
            {
              serial: 'synthetic-camera',
              name: 'Entry camera',
              modelName: 'Synthetic camera',
              category: 'security',
              deviceClass: 'camera',
              recognized: true,
              represented: true,
              controllable: false,
              diagnosticOnly: false,
              preferences: ['represented'],
            },
          ],
        },
      );
      expect(sessionLostUi.reauthDialog.open, 'a lost session with known devices blocks the page').toBe(true);

      let dismissed = true;
      await sessionLostUi.reauthDialog.dispatch('cancel', {
        preventDefault() {
          dismissed = false;
        },
      });
      expect(dismissed, 'Escape does not dismiss the dialog').toBe(false);

      await sessionLostUi.reauthAction.dispatch('click');
      expect(sessionLostUi).toMatchObject({
        reauthDialog: { open: false },
        dashboard: { hidden: true },
        setupContent: { hidden: false },
      });

      await signingInUi.mastheadDiagnostics.dispatch('click');

      expect(signingInUi.requests.map(({ path }) => path)).not.toContain('/diagnostics/authorize');
      expect(signingInUi.diagnosticsWizardPanel.hidden, 'the question and its privacy note are on screen').toBe(false);
      const startupTile = signingInUi.diagnosticsTiles.find(
        (tile) => tile.dataset.diagnosticsTile === 'startup-authentication',
      )!;
      expect(startupTile.focused, 'the startup area is the one offered first').toBe(true);
      await startupTile.dispatch('click');
      expect(signingInUi.requests).toContainEqual({
        path: '/diagnostics/authorize',
        body: { profile: 'startup-authentication' },
      });

      const dashboardBackgroundUi = await renderUi(
        script,
        [{ platform: 'HomebridgeEufy', username: 'guest@example.invalid' }],
        catalogs,
      );
      await dashboardBackgroundUi.menuDiagnostics.dispatch('click');
      await dashboardBackgroundUi.diagnosticsTiles
        .find((tile) => (tile as { dataset: { diagnosticsTile: string } }).dataset.diagnosticsTile === 'dashboard-ui')!
        .dispatch('click');
      expect(dashboardBackgroundUi).toMatchObject({
        diagnosticsPanel: { hidden: true },
        diagnosticsGuidance: { hidden: false },
        diagnosticsActions: { hidden: false },
        diagnosticsReproduction: { disabled: false },
        dashboardState: { hidden: false },
        menuDiagnostics: {
          dataset: { collecting: 'true' },
          attributes: { 'aria-label': catalogs['i18n/en.json'].diagnosticsCollectingFinishHere },
        },
        mastheadDiagnostics: {
          dataset: { collecting: 'true' },
          attributes: { 'aria-label': catalogs['i18n/en.json'].diagnosticsCollectingFinishHere },
        },
      });
      expect(dashboardBackgroundUi.requests).toContainEqual({
        path: '/diagnostics/ui-event',
        body: { event: 'background-started' },
      });
      expect(dashboardBackgroundUi.requests).toContainEqual({
        path: '/diagnostics/ui-event',
        body: { event: 'dashboard-opened' },
      });
      await dashboardBackgroundUi.dashboardAuthenticate.dispatch('click');
      expect(dashboardBackgroundUi).toMatchObject({
        dashboard: { hidden: true },
        masthead: { hidden: false },
        setupContent: { hidden: false },
      });
      expect(dashboardBackgroundUi.requests).toContainEqual({
        path: '/diagnostics/ui-event',
        body: { event: 'authentication-opened' },
      });

      const reloadedDashboardBackgroundUi = await renderUi(
        script,
        [{ platform: 'HomebridgeEufy', username: 'guest@example.invalid' }],
        catalogs,
        'en',
        [],
        undefined,
        undefined,
        {
          status: 'reproducing',
          profile: 'dashboard-ui',
          reproductionMode: 'intermittent',
          missingEvidence: [],
          partialExportAvailable: false,
        },
      );
      expect(reloadedDashboardBackgroundUi).toMatchObject({
        diagnosticsPanel: { hidden: true },
        diagnosticsGuidance: { hidden: false },
        diagnosticsActions: { hidden: false },
        menuDiagnostics: { dataset: { collecting: 'true' } },
      });
      await reloadedDashboardBackgroundUi.menuDiagnostics.dispatch('click');
      expect(reloadedDashboardBackgroundUi).toMatchObject({
        diagnosticsPanel: { hidden: false },
        diagnosticsActions: { hidden: false },
        diagnosticsReproduction: { disabled: false },
      });
      await reloadedDashboardBackgroundUi.diagnosticsReproduction.dispatch('click');
      expect(reloadedDashboardBackgroundUi).toMatchObject({
        diagnosticsPanel: { hidden: false },
        diagnosticsResult: { open: true },
        diagnosticsResultHeading: { focused: true },
        menuDiagnostics: {
          dataset: {},
          attributes: { 'aria-label': catalogs['i18n/en.json'].menuDiagnostics },
        },
      });
      expect(reloadedDashboardBackgroundUi.requests).toContainEqual({
        path: '/diagnostics/reproduction/end',
        body: undefined,
      });
      expect(reloadedDashboardBackgroundUi.requests, 'finishing downloads the archive unasked').toContainEqual({
        path: '/diagnostics/archive/export',
        body: { reviewId: 'review-synthetic' },
      });

      const completedDiagnosticsUi = await renderUi(
        script,
        [{ platform: 'HomebridgeEufy', username: 'guest@example.invalid' }],
        catalogs,
        'en',
        [],
        undefined,
        undefined,
        {
          status: 'complete',
          supportCaseId: 'support-00000000-0000-4000-8000-000000000000',
          profile: 'startup-authentication',
          reproductionMode: 'now',
          expiresAt: '2026-08-19T10:18:42.832Z',
          selectedEvidence: ['plugin-log', 'sdk-log'],
          missingEvidence: [],
          partialExportAvailable: true,
          issueUrl: 'https://example.invalid/owner/repo/issues/new?template=bug',
        },
      );
      expect(
        completedDiagnosticsUi.diagnosticsResult.open,
        'a completed session waits for the reporter to open diagnostics rather than blocking the page on load',
      ).toBe(false);
      await completedDiagnosticsUi.menuDiagnostics.dispatch('click');
      expect(completedDiagnosticsUi, 'an archive not yet downloaded offers only its download').toMatchObject({
        diagnosticsExport: { disabled: false, hidden: false },
        diagnosticsHandoff: { hidden: true },
        diagnosticsStartAnother: { hidden: true },
        diagnosticsResult: { open: true },
        diagnosticsWizardPanel: { hidden: true },
      });
      expect(completedDiagnosticsUi.requests, 'the archive is reviewed once, unasked').toContainEqual({
        path: '/diagnostics/archive/review',
        body: undefined,
      });

      await completedDiagnosticsUi.diagnosticsExport.dispatch('click');
      expect(completedDiagnosticsUi.requests).toContainEqual({
        path: '/diagnostics/archive/export',
        body: { reviewId: 'review-synthetic' },
      });
      expect(completedDiagnosticsUi.createdElements.filter((element) => typeof element.download === 'string')).toEqual([
        expect.objectContaining({
          download: 'homebridge-eufy-support-00000000-0000-4000-8000-000000000000.eufysupport.gz',
          href: 'data:application/gzip;base64,c3ludGhldGlj',
        }),
      ]);
      expect(
        completedDiagnosticsUi,
        'the archive in hand offers a new issue, or the reporter own open issues to attach it to',
      ).toMatchObject({
        diagnosticsResult: { open: true },
        diagnosticsResultHeading: { textContent: catalogs['i18n/en.json'].diagnosticsArchiveDownloaded },
        diagnosticsExport: { hidden: true },
        diagnosticsStartAnother: { hidden: false },
        diagnosticsDownloadAgain: { hidden: false },
        diagnosticsHandoff: { hidden: false },
        diagnosticsHandoffNote: {
          hidden: false,
          textContent: expect.stringContaining(
            'homebridge-eufy-support-00000000-0000-4000-8000-000000000000.eufysupport.gz',
          ),
        },
        diagnosticsIssue: { href: 'https://example.invalid/owner/repo/issues/new?template=bug' },
        diagnosticsExistingIssue: {
          href: 'https://example.invalid/owner/repo/issues?q=is%3Aissue+involves%3A%40me',
        },
      });
      await completedDiagnosticsUi.diagnosticsExistingIssue.dispatch('click');
      expect(
        completedDiagnosticsUi.diagnosticsResult.open,
        'following a link keeps the dialog, so a GitHub tab that went wrong can be opened again',
      ).toBe(true);
      expect(
        completedDiagnosticsUi.requests.map(({ path }) => path),
        'the download alone ends nothing, since nothing proves the file arrived',
      ).not.toContain('/diagnostics/cancel');
      await completedDiagnosticsUi.diagnosticsDownloadAgain.dispatch('click');
      expect(
        completedDiagnosticsUi.requests
          .filter(({ path }) => path.startsWith('/diagnostics/archive/'))
          .map(({ path }) => path),
        'downloading again reviews the capture afresh and exports it once more',
      ).toEqual([
        '/diagnostics/archive/review',
        '/diagnostics/archive/export',
        '/diagnostics/archive/review',
        '/diagnostics/archive/export',
      ]);
      await completedDiagnosticsUi.diagnosticsStartAnother.dispatch('click');
      expect(completedDiagnosticsUi.requests.at(-1), 'leaving the dialog ends the session').toEqual({
        path: '/diagnostics/cancel',
        body: undefined,
      });
      expect(completedDiagnosticsUi, 'and puts the first question back').toMatchObject({
        diagnosticsResult: { open: false },
        diagnosticsWizardPanel: { hidden: false },
        diagnosticsQuestionText: { focused: true },
      });
      await completedDiagnosticsUi.diagnosticsClose.dispatch('click');
      await completedDiagnosticsUi.menuDiagnostics.dispatch('click');
      expect(completedDiagnosticsUi, 'a finished session is not offered again on return').toMatchObject({
        diagnosticsResult: { open: false },
        diagnosticsWizardPanel: { hidden: false },
      });

      /** A capture that ran out its 72 hours is finished at their end, and the page says so over its download. */
      const timedOutUi = await renderUi(
        script,
        [{ platform: 'HomebridgeEufy', username: 'guest@example.invalid' }],
        catalogs,
        'en',
        [],
        undefined,
        undefined,
        {
          status: 'complete',
          supportCaseId: 'support-00000000-0000-4000-8000-000000000000',
          profile: 'live-media',
          reproductionMode: 'now',
          expiresAt: '2026-08-19T10:18:42.832Z',
          reproductionEndedAt: '2026-08-19T10:18:42.832Z',
          missingEvidence: ['sdk-log'],
          partialExportAvailable: true,
        },
      );
      await timedOutUi.mastheadDiagnostics.dispatch('click');
      expect(timedOutUi, 'and a file missing details says so inside the dialog').toMatchObject({
        diagnosticsResult: { open: true },
        diagnosticsResultHeading: { textContent: catalogs['i18n/en.json'].diagnosticsCaptureTimedOut },
        diagnosticsResultStatus: { textContent: catalogs['i18n/en.json'].diagnosticsMissingEvidence },
        diagnosticsExport: { hidden: false },
      });

      const expiredCompletedDiagnosticsUi = await renderUi(
        script,
        [{ platform: 'HomebridgeEufy', username: 'guest@example.invalid' }],
        catalogs,
        'en',
        [],
        undefined,
        undefined,
        {
          status: 'expired',
          profile: 'live-media',
          missingEvidence: [],
          partialExportAvailable: false,
          issueUrl: 'https://example.invalid/expired-issue',
        },
      );
      await expiredCompletedDiagnosticsUi.menuDiagnostics.dispatch('click');
      expect(expiredCompletedDiagnosticsUi, 'an expired session starts over at the first question').toMatchObject({
        diagnosticsResult: { open: false },
        diagnosticsWizardPanel: { hidden: false },
      });

      englishUi.account.value = 'guest@example.invalid';
      englishUi.password.value = 'synthetic-password';
      englishUi.country.value = 'US';
      englishUi.trustedDeviceName.value = 'Synthetic Homebridge';
      await englishUi.authForm.dispatch('submit');
      expect(englishUi.requests).toEqual([
        {
          path: '/auth/start',
          body: {
            configuration: {
              platform: 'HomebridgeEufy',
              username: 'guest@example.invalid',
              password: 'synthetic-password',
              country: 'US',
              trustedDeviceName: 'Synthetic Homebridge',
            },
          },
        },
      ]);
      expect(englishUi.challengeForm.hidden).toBe(false);
      expect(englishUi.authForm.hidden).toBe(true);
      expect(englishUi.challengeImage).toMatchObject({
        hidden: false,
        src: 'data:image/png;base64,c3ludGhldGlj',
      });
      englishUi.challengeAnswer.value = '1234';
      await englishUi.challengeForm.dispatch('submit');
      expect(englishUi.requests[1]).toEqual({ path: '/auth/captcha', body: { answer: '1234' } });
      expect(englishUi.updatedConfig).toEqual([
        {
          platform: 'HomebridgeEufy',
          username: 'guest@example.invalid',
          password: 'synthetic-password',
          country: 'US',
          trustedDeviceName: 'Synthetic Homebridge',
        },
      ]);
      expect(englishUi).toMatchObject({
        authForm: { hidden: true },
        authStatus: { textContent: catalogs['i18n/en.json'].authSuccess },
        challengeForm: { hidden: true },
      });
      expect(englishUi.saves).toBe(1);
      expect(englishUi.saveButtonEnables).toBe(2);
      expect(englishUi.saveButtonDisables).toBe(1);

      const migrationFixture = JSON.parse(
        readFileSync(join(repository, 'test', 'fixtures', 'v4-migration.json'), 'utf8'),
      ) as {
        cachedAccessory: { plugin: string };
        configuration: Record<string, unknown>;
      };
      expect(migrationFixture.cachedAccessory.plugin).toBe(packedPackage.name);
      const migratedUi = await renderUi(script, [migrationFixture.configuration], catalogs, 'en', [], {
        status: 'restart-required',
      });
      expect(migratedUi).toMatchObject({
        account: { value: '' },
        country: { value: 'US' },
        firstSetup: { hidden: false },
        trustedDeviceName: { value: 'Homebridge Eufy' },
      });
      migratedUi.account.value = 'replacement@example.invalid';
      migratedUi.password.value = 'replacement-password';
      migratedUi.country.value = 'GB';
      migratedUi.trustedDeviceName.value = 'Replacement bridge';
      await migratedUi.authForm.dispatch('submit');
      const expectedMigratedConfig = {
        platform: 'HomebridgeEufy',
        username: 'replacement@example.invalid',
        password: 'replacement-password',
        country: 'GB',
        trustedDeviceName: 'Replacement bridge',
        discardedV4Settings: [
          'cameras',
          'cleanCache',
          'enableDetailedLogging',
          'experimentalMode',
          'ignoreDevices',
          'ignoreStations',
          'stations',
          'syncStationModes',
          'useEmbeddedPKCS1Support',
        ],
      };
      expect(
        migratedUi.requests,
        'a sign-in that succeeded ends on the devices it discovered, so it reads them rather than stopping on a notice',
      ).toEqual([
        { path: '/auth/start', body: { configuration: expectedMigratedConfig } },
        { path: '/dashboard', body: { representationPreferences: {} } },
      ]);
      expect(migratedUi.updatedConfig).toEqual([expectedMigratedConfig]);
      expect(migratedUi.legacyNotice.hidden).toBe(false);
      await migratedUi.legacyAcknowledge.dispatch('click');
      expect(migratedUi.legacyNotice.hidden).toBe(true);
      expect(migratedUi.updatedConfig?.[0]).toMatchObject({ discardedV4Acknowledged: true });

      const signedInBlock = {
        platform: 'HomebridgeEufy',
        username: 'guest@example.invalid',
        password: 'old-password',
        country: 'US',
        trustedDeviceName: 'Synthetic Homebridge',
        _bridge: { username: '0E:00:00:00:00:00', port: 51000 },
        warmUpEvents: ['motion'],
        maxConcurrentMediaSessions: 2,
        smallVideoPackets: true,
        entityPreferences: { 'synthetic-camera': { audio: false } },
      };
      const reauthUi = await renderUi(script, [signedInBlock], catalogs, 'en', [], { status: 'restart-required' });
      reauthUi.password.value = 'new-password';
      await reauthUi.authForm.dispatch('submit');
      expect(
        reauthUi.updatedConfig,
        'signing in again replaces the account and keeps every other setting, the child bridge included',
      ).toEqual([{ ...signedInBlock, password: 'new-password' }]);

      const dashboardUi = await renderUi(
        script,
        [
          {
            platform: 'HomebridgeEufy',
            username: 'guest@example.invalid',
            entityPreferences: {
              'synthetic-absent': { audio: false },
              'synthetic-working-camera': { securitySystem: false },
              'synthetic-contact': { represented: false },
            },
          },
        ],
        catalogs,
        'en',
        [],
        undefined,
        {
          state: 'degraded',
          devices: [
            {
              serial: 'synthetic-diagnostic',
              name: 'Unsupported sensor',
              modelName: 'Synthetic diagnostic sensor',
              category: 'security',
              deviceClass: 'sensor',
              recognized: true,
              represented: false,
              controllable: false,
              diagnosticOnly: true,
              preferences: [],
            },
            {
              serial: 'synthetic-contact',
              name: 'Front contact',
              modelName: 'Synthetic contact sensor',
              artwork: 'assets/devices/security/security-T8910.webp',
              category: 'security',
              deviceClass: 'sensor',
              recognized: true,
              represented: true,
              controllable: false,
              diagnosticOnly: false,
              preferences: ['represented', 'audio', 'snapshotMode'],
            },
            {
              serial: 'synthetic-back-contact',
              name: 'Back contact',
              modelName: 'Synthetic contact sensor',
              category: 'security',
              deviceClass: 'sensor',
              recognized: true,
              represented: true,
              controllable: false,
              diagnosticOnly: false,
              preferences: ['represented'],
              availability: 'unavailable',
            },
            {
              serial: 'synthetic-camera',
              name: 'Entry camera',
              modelName: 'Synthetic camera',
              category: 'security',
              deviceClass: 'camera',
              recognized: true,
              represented: true,
              controllable: false,
              diagnosticOnly: false,
              preferences: ['represented'],
              enabled: false,
              battery: 29,
            },
            {
              serial: 'synthetic-working-camera',
              name: 'Drive camera',
              modelName: 'Synthetic working camera',
              category: 'security',
              deviceClass: 'camera',
              recognized: true,
              represented: true,
              controllable: false,
              diagnosticOnly: false,
              preferences: ['represented', 'securitySystem', 'armingModes'],
              enabled: true,
            },
            {
              serial: 'synthetic-vacuum',
              name: 'Floor cleaner',
              modelName: 'Synthetic vacuum',
              category: 'clean',
              deviceClass: 'vacuum',
              recognized: true,
              represented: false,
              controllable: false,
              diagnosticOnly: true,
              preferences: [],
            },
          ],
        },
      );
      expect(dashboardUi).toMatchObject({
        dashboard: { hidden: false, dataset: { state: 'degraded' } },
        setupContent: { hidden: true },
      });
      expect(dashboardUi.deviceGroups.innerHTML).toContain('Front contact');
      expect(dashboardUi.deviceGroups.innerHTML).toContain('device-tile-disabled');
      // Opening a device is the only way to its settings now, so the settings are asserted through that path.
      await dashboardUi.deviceGroups.dispatch('click', {
        target: {
          closest: (selector: string) =>
            selector === '.device-open-control'
              ? { closest: () => ({ dataset: { serial: 'synthetic-contact' } }) }
              : undefined,
        },
      });
      expect(
        dashboardUi.deviceSettingsTitle.textContent,
        'the settings that open belong to the device whose tile was pressed',
      ).toBe('Front contact');
      expect(
        dashboardUi.deviceSettingsControls.innerHTML,
        'a setting that only means something for a represented device is withheld while it is not',
      ).toContain('data-requires-representation hidden');
      expect(dashboardUi.devicePanel.hidden).toBe(false);
      await dashboardUi.deviceGroups.dispatch('click', {
        target: {
          closest: (selector: string) =>
            selector === '.device-open-control'
              ? { closest: () => ({ dataset: { serial: 'synthetic-working-camera' } }) }
              : undefined,
        },
      });
      expect(
        dashboardUi.deviceSettingsControls.innerHTML,
        'the guard-mode map is withheld while the security system it maps is turned off',
      ).toMatch(
        /<details class="arming-setting" data-setting hidden data-requires-representation data-requires-security-system>/,
      );
      expect(dashboardUi.deviceGroups.innerHTML).toContain('assets/devices/security/security-T8910.webp');
      expect(dashboardUi.deviceGroups.innerHTML.indexOf('Back contact')).toBeLessThan(
        dashboardUi.deviceGroups.innerHTML.indexOf('Front contact'),
      );
      expect(dashboardUi.deviceGroups.innerHTML.indexOf('Entry camera')).toBeLessThan(
        dashboardUi.deviceGroups.innerHTML.indexOf('Back contact'),
      );
      expect(dashboardUi.deviceGroups.innerHTML.indexOf('Front contact')).toBeLessThan(
        dashboardUi.deviceGroups.innerHTML.indexOf('Unsupported sensor'),
      );
      expect(dashboardUi.deviceGroups.innerHTML).toContain('Floor cleaner');
      expect(dashboardUi.deviceGroups.innerHTML.indexOf('Front contact')).toBeLessThan(
        dashboardUi.deviceGroups.innerHTML.indexOf('Floor cleaner'),
      );
      expect(dashboardUi.deviceGroups.innerHTML).toContain(catalogs['i18n/en.json'].diagnosticOnly);
      expect(dashboardUi.deviceGroups.innerHTML).toContain(
        `device-status device-status-fault"><span class="device-status-dot" aria-hidden="true"></span><span class="device-status-label">${catalogs['i18n/en.json'].deviceStatusUnreachable}`,
      );
      expect(dashboardUi.deviceGroups.innerHTML).toContain(catalogs['i18n/en.json'].deviceStatusSwitchedOff);
      expect(dashboardUi.deviceGroups.innerHTML).toContain(catalogs['i18n/en.json'].deviceStatusHidden);
      expect(
        dashboardUi.deviceGroups.innerHTML.match(/class="device-status device-status-(?:alert|quiet|live|fault)"/g),
        'every camera states its switch, and any device states being unreachable or withheld',
      ).toHaveLength(4);
      expect(
        dashboardUi.deviceGroups.innerHTML.match(/device-status-fault/g),
        'a device nothing can reach is the one fault among these, so it is the only red',
      ).toHaveLength(1);
      expect(
        dashboardUi.deviceGroups.innerHTML.match(/device-status-alert/g),
        'a camera switched off is a state the user chose, not a fault, so it is amber',
      ).toHaveLength(1);
      expect(
        dashboardUi.deviceGroups.innerHTML,
        'a camera that reports itself on says so, in the accent rather than an alert',
      ).toContain(
        `device-status device-status-live"><span class="device-status-dot" aria-hidden="true"></span><span class="device-status-label">${catalogs['i18n/en.json'].deviceStatusOnline}`,
      );
      expect(dashboardUi.deviceGroups.innerHTML, 'a camera with a status shows it instead of its model').not.toContain(
        'Synthetic working camera',
      );
      expect(
        dashboardUi.deviceGroups.innerHTML,
        'a device with nothing to report keeps the model that identifies it',
      ).toContain('Synthetic diagnostic sensor');
      expect(
        dashboardUi.deviceGroups.innerHTML,
        'a device with a status shows it instead of its model, not beside it',
      ).not.toContain('Synthetic camera');
      expect(
        dashboardUi.deviceGroups.innerHTML,
        'a reported level picks its icon by position in the shipped set and states the percentage in the label',
      ).toContain(
        '<span class="device-badge device-badge-battery" role="img" tabindex="0" aria-label="Battery 29%" data-tooltip="Battery 29%"><img src="assets/icons/battery_2.svg" alt="">',
      );
      expect(
        dashboardUi.deviceGroups.innerHTML.match(/device-badge-battery/g),
        'only a device that reports a level gets a badge, never one running on mains power',
      ).toHaveLength(1);
      expect(
        dashboardUi.deviceGroups.innerHTML.match(/device-open-control/g),
        'every tile is one face that opens its settings, with nothing behind it to turn over to',
      ).toHaveLength(6);
      expect(
        dashboardUi.deviceGroups.innerHTML,
        'the flip apparatus is gone rather than hidden: no second face, no away-facing controls, no close button',
      ).not.toMatch(/device-card|device-tile-flippable|device-mobile-close|device-flip-control|preference-panel/);
      expect(
        dashboardUi.deviceGroups.innerHTML,
        'a tile carries no control a finger could reach by accident, only the one that opens the device',
      ).not.toMatch(/<input|role="radiogroup"/);
      await dashboardUi.deviceSettingsControls.dispatch('change', {
        target: {
          checked: true,
          dataset: { preference: 'represented', serial: 'synthetic-contact' },
        },
      });
      expect(dashboardUi.updatedConfig?.[0].entityPreferences).toEqual({
        'synthetic-absent': { audio: false },
        'synthetic-working-camera': { securitySystem: false },
      });
      expect(dashboardUi.saveButtonEnables).toBe(1);
      expect(dashboardUi.saveButtonDisables).toBe(1);
      expect(dashboardUi.saves).toBe(0);
      await dashboardUi.deviceSettingsControls.dispatch('change', {
        target: {
          checked: false,
          dataset: { preference: 'represented', serial: 'synthetic-contact' },
        },
      });
      expect(dashboardUi.updatedConfig?.[0].entityPreferences).toEqual({
        'synthetic-absent': { audio: false },
        'synthetic-working-camera': { securitySystem: false },
        'synthetic-contact': { represented: false },
      });
      expect(dashboardUi.saveButtonEnables).toBe(1);
      expect(dashboardUi.saveButtonDisables).toBe(2);
      await dashboardUi.deviceSettingsControls.dispatch('change', {
        target: {
          value: 'schedule',
          dataset: { preference: 'armingModes', slot: 'night', serial: 'synthetic-contact' },
        },
      });
      expect(
        dashboardUi.updatedConfig?.[0].entityPreferences,
        'a HomeKit state a household assigned is written under the station it was assigned on',
      ).toEqual({
        'synthetic-absent': { audio: false },
        'synthetic-working-camera': { securitySystem: false },
        'synthetic-contact': { represented: false, armingModes: { night: 'schedule' } },
      });
      await dashboardUi.deviceSettingsControls.dispatch('change', {
        target: {
          value: '',
          dataset: { preference: 'armingModes', slot: 'night', serial: 'synthetic-contact' },
        },
      });
      expect(
        dashboardUi.updatedConfig?.[0].entityPreferences,
        'unassigning a state removes it rather than pinning an empty map, so a later default still reaches it',
      ).toEqual({
        'synthetic-absent': { audio: false },
        'synthetic-working-camera': { securitySystem: false },
        'synthetic-contact': { represented: false },
      });
      expect(script).not.toContain('appendChild(entry)');

      const captchaRetryUi = await renderUi(script, [], catalogs, 'en', [], {
        status: 'captcha',
        image: 'data:image/png;base64,c3ludGhldGlj',
        retry: true,
      });
      await captchaRetryUi.authForm.dispatch('submit');
      expect(
        captchaRetryUi.authStatus.textContent,
        'a refused answer is said to be refused, not replaced by a new image in silence',
      ).toBe(catalogs['i18n/en.json'].captchaRetry);

      const twoFactorUi = await renderUi(script, [], catalogs, 'en', [], {
        status: 'two-factor',
        method: 'Synthetic verification',
      });
      await twoFactorUi.authForm.dispatch('submit');
      expect(twoFactorUi).toMatchObject({
        authForm: { hidden: true },
        authStatus: { textContent: catalogs['i18n/en.json'].twoFactorSent },
        challengeForm: { hidden: false },
        challengeImage: { hidden: true },
      });
      expect(twoFactorUi.authStatus.textContent, 'the SDK describes its wire, not the user').not.toContain('Synthetic');

      /**
       * A plugin that stopped on an error, and a page whose own request for the devices went unanswered, each state
       * their cause and remedy rather than reading as a first run or offering a diagnostic run.
       */
      for (const [state, snapshot] of [
        [
          'failed',
          {
            state: 'failed',
            devices: [],
            conditions: [
              { code: 'runtime-failed', summaryKey: 'log.runtime.failed', actionKey: 'log.action.reviewRuntime' },
            ],
          },
        ],
        [
          'unreachable',
          {
            then: (_: unknown, reject: (error: Error) => void) => reject(new Error('synthetic unanswered request')),
          },
        ],
      ] as const) {
        const stateUi = await renderUi(
          script,
          [{ platform: 'HomebridgeEufy', username: 'guest@example.invalid' }],
          catalogs,
          'en',
          [],
          undefined,
          snapshot as unknown as Record<string, unknown>,
        );
        const suffix = state[0].toUpperCase() + state.slice(1);
        expect(stateUi, `${state} names its own cause and remedy`).toMatchObject({
          dashboard: { dataset: { state } },
          dashboardTitle: { textContent: catalogs['i18n/en.json'][`dashboard${suffix}Title`] },
          dashboardSummary: { textContent: catalogs['i18n/en.json'][`dashboard${suffix}Summary`] },
        });
        expect(stateUi.menuDiagnostics.dataset.attention, `${state} does not point at diagnostics`).toBeUndefined();
      }

      /**
       * A state a run explains, an active condition the page has words for, and a device nothing can reach light the
       * dashboard's diagnostics action, in that order. Pressing it names the problem and its remedy, and diagnosing it
       * captures the area the problem belongs to.
       */
      const unreachableDevice = {
        serial: 'synthetic-unreachable',
        name: 'Porch camera',
        modelName: 'Synthetic camera',
        category: 'security',
        deviceClass: 'camera',
        recognized: true,
        represented: true,
        controllable: false,
        diagnosticOnly: false,
        preferences: [],
        availability: 'unavailable',
      };
      for (const [snapshot, title, summary, profile] of [
        [
          { state: 'stale', devices: [] },
          catalogs['i18n/en.json'].dashboardStaleTitle,
          catalogs['i18n/en.json'].dashboardStaleSummary,
          'startup-authentication',
        ],
        [
          { state: 'missing', devices: [] },
          catalogs['i18n/en.json'].dashboardMissingTitle,
          catalogs['i18n/en.json'].dashboardMissingSummary,
          'startup-authentication',
        ],
        [
          { state: 'ready', devices: [unreachableDevice] },
          catalogs['i18n/en.json'].attentionUnreachableTitle.replace('{device}', 'Porch camera'),
          catalogs['i18n/en.json'].attentionUnreachableSummary,
          'device-representation',
        ],
        [
          {
            state: 'ready',
            devices: [unreachableDevice],
            conditions: [
              {
                code: 'runtime-owner-conflict',
                summaryKey: 'log.runtime.ownerConflict',
                actionKey: 'log.action.stopOtherOwner',
              },
              {
                code: 'camera-live-session-failed',
                summaryKey: 'log.homekit.cameraLiveSessionFailed',
                actionKey: 'log.action.retryLiveView',
                serials: ['synthetic-unreachable'],
              },
            ],
          },
          catalogs['i18n/en.json']['log.homekit.cameraLiveSessionFailed'],
          catalogs['i18n/en.json']['log.action.retryLiveView'],
          'live-media',
        ],
        [
          {
            state: 'ready',
            devices: [],
            conditions: [
              {
                code: 'camera-recording-unavailable',
                summaryKey: 'log.homekit.cameraRecordingUnavailable',
                actionKey: 'log.action.setFfmpegPath',
              },
            ],
          },
          catalogs['i18n/en.json']['log.homekit.cameraRecordingUnavailable'],
          catalogs['i18n/en.json']['log.action.setFfmpegPath'],
          'hksv-recording',
        ],
        [
          {
            state: 'ready',
            devices: [],
            conditions: [
              {
                code: 'lock-operation-failed',
                summaryKey: 'log.homekit.lockOperationFailed',
                actionKey: 'log.action.retryLock',
              },
            ],
          },
          catalogs['i18n/en.json']['log.homekit.lockOperationFailed'],
          catalogs['i18n/en.json']['log.action.retryLock'],
          'control-state',
        ],
      ] as const) {
        const attentionUi = await renderUi(
          script,
          [{ platform: 'HomebridgeEufy', username: 'guest@example.invalid' }],
          catalogs,
          'en',
          [],
          undefined,
          snapshot,
        );
        expect(attentionUi.menuDiagnostics).toMatchObject({
          dataset: { attention: 'true' },
          attributes: { 'aria-label': catalogs['i18n/en.json'].diagnosticsAttention },
        });
        expect(attentionUi.mastheadDiagnostics.dataset.attention, 'the masthead action is unchanged').toBeUndefined();
        await attentionUi.menuDiagnostics.dispatch('click');
        expect(
          attentionUi.requests.map(({ path }) => path),
          'naming the problem captures nothing yet',
        ).not.toContain('/diagnostics/authorize');
        expect(attentionUi).toMatchObject({
          attentionDialog: { open: true },
          attentionTitle: { textContent: title },
          attentionSummary: { textContent: summary },
          diagnosticsPanel: { hidden: true },
        });
        await attentionUi.attentionDiagnose.dispatch('click');
        expect(attentionUi, 'diagnosing the problem shown captures its area at once').toMatchObject({
          attentionDialog: { open: false },
          diagnosticsPanel: { hidden: false },
          diagnosticsWizardPanel: { hidden: true },
          diagnosticsActions: { hidden: false },
        });
        expect(attentionUi.requests).toContainEqual({ path: '/diagnostics/authorize', body: { profile } });
        expect(attentionUi.requests).toContainEqual({ path: '/diagnostics/reproduction/start', body: undefined });
      }

      const chooseAnotherUi = await renderUi(
        script,
        [{ platform: 'HomebridgeEufy', username: 'guest@example.invalid' }],
        catalogs,
        'en',
        [],
        undefined,
        { state: 'stale', devices: [] },
      );
      await chooseAnotherUi.menuDiagnostics.dispatch('click');
      await chooseAnotherUi.attentionChoose.dispatch('click');
      expect(chooseAnotherUi, 'another problem starts at the first question').toMatchObject({
        attentionDialog: { open: false },
        diagnosticsPanel: { hidden: false },
        diagnosticsWizardPanel: { hidden: false },
      });
      expect(chooseAnotherUi.requests.map(({ path }) => path)).not.toContain('/diagnostics/authorize');

      /**
       * An unsuccessful sign-in names its own cause and the action for it, rather than one message for every cause.
       */
      for (const [status, key] of [
        ['blocked', 'dashboardOwnerConflictSummary'],
        ['plugin-running', 'authPluginRunning'],
        ['commit-failed', 'authCommitFailed'],
      ] as const) {
        const outcomeUi = await renderUi(script, [], catalogs, 'en', [], { status });
        await outcomeUi.authForm.dispatch('submit');
        expect(outcomeUi.authStatus.textContent, `${status} is stated as its own cause`).toBe(
          catalogs['i18n/en.json'][key],
        );
      }

      /** The page's own deadline elapsing is a timeout, and is said to be one. */
      vi.useFakeTimers();
      try {
        const unansweredUi = await renderUi(
          script,
          [],
          catalogs,
          'en',
          [],
          new Promise(() => undefined) as unknown as Record<string, unknown>,
        );
        const submitted = unansweredUi.authForm.dispatch('submit');
        await vi.advanceTimersByTimeAsync(320_000);
        await submitted;
        expect(unansweredUi.authStatus.textContent, 'an unanswered sign-in timed out').toBe(
          catalogs['i18n/en.json'].authTimedOut,
        );
      } finally {
        vi.useRealTimers();
      }

      /**
       * A finish whose answer was lost still downloads the file the plugin now holds, rather than stopping at the
       * dialog with a failure under its backdrop.
       */
      const lostEndUi = await renderUi(
        script,
        [{ platform: 'HomebridgeEufy', username: 'guest@example.invalid' }],
        catalogs,
        'en',
        [],
        undefined,
        undefined,
        {
          status: 'reproducing',
          profile: 'live-media',
          reproductionMode: 'now',
          expiresAt: '2026-08-20T10:18:42.832Z',
          missingEvidence: [],
          partialExportAvailable: false,
        },
      );
      lostEndUi.endResponseLost = true;
      await lostEndUi.mastheadDiagnostics.dispatch('click');
      await lostEndUi.diagnosticsReproduction.dispatch('click');
      expect(lostEndUi.requests).toContainEqual({
        path: '/diagnostics/archive/export',
        body: { reviewId: 'review-synthetic' },
      });
      expect(lostEndUi).toMatchObject({
        diagnosticsResult: { open: true },
        diagnosticsResultHeading: { textContent: catalogs['i18n/en.json'].diagnosticsArchiveDownloaded },
        diagnosticsStatus: { textContent: '' },
      });

      /**
       * An authorization that outlives the page's deadline is reported as failed, and its late landing redraws the
       * session the plugin then holds rather than leaving the failure standing.
       */
      vi.useFakeTimers();
      try {
        const lateUi = await renderUi(
          script,
          [{ platform: 'HomebridgeEufy', username: 'guest@example.invalid' }],
          catalogs,
        );
        lateUi.authorizeDelayMs = 20_000;
        await lateUi.mastheadDiagnostics.dispatch('click');
        const picked = lateUi.diagnosticsTiles[0]!.dispatch('click');
        await vi.advanceTimersByTimeAsync(12_000);
        await picked;
        expect(lateUi.diagnosticsStatus.textContent).toBe(catalogs['i18n/en.json'].diagnosticsFailed);
        await vi.advanceTimersByTimeAsync(8_000);
        expect(lateUi.diagnosticsStatus.textContent, 'the late session is drawn, and the failure goes').toBe('');
        expect(
          lateUi.requests,
          'a capture the page never started is cancelled rather than left logging',
        ).toContainEqual({ path: '/diagnostics/cancel', body: undefined });
        expect(lateUi.diagnosticsWizardPanel.hidden, 'and the reporter is back at the question').toBe(false);
      } finally {
        vi.useRealTimers();
      }

      /** A country code that is not two letters is refused where it is typed, in the page's words. */
      expect(document).toContain('pattern="[A-Za-z]{2}"');
      const countryUi = await renderUi(script, [], catalogs);
      countryUi.country.value = 'U1';
      await countryUi.country.dispatch('input');
      expect(countryUi.country.validityMessage, 'a malformed code is refused').toBe(
        catalogs['i18n/en.json'].countryInvalid,
      );
      countryUi.country.value = 'fr';
      await countryUi.country.dispatch('input');
      expect(countryUi.country.validityMessage, 'a two-letter code is accepted').toBe('');

      /**
       * A sign-in whose settings could not be written says so and stays on the page, with Save left enabled, rather
       * than moving on as if the account were saved.
       */
      const unsavedUi = await renderUi(script, [], catalogs, 'en', [], { status: 'restart-required' });
      unsavedUi.configWritesFail = true;
      await unsavedUi.authForm.dispatch('submit');
      expect(unsavedUi).toMatchObject({
        authStatus: { textContent: catalogs['i18n/en.json'].authSaveFailed },
        dashboard: { hidden: true },
        saveButtonDisables: 1,
        saveButtonEnables: 1,
      });
      expect(unsavedUi.requests.map(({ path }) => path)).not.toContain('/dashboard');

      /** An acknowledgement that could not be saved says so in the notice, which stays up to be acknowledged again. */
      const unacknowledgedUi = await renderUi(
        script,
        [{ platform: 'HomebridgeEufy', username: 'guest@example.invalid', discardedV4Settings: ['cameras'] }],
        catalogs,
      );
      unacknowledgedUi.configWritesFail = true;
      await unacknowledgedUi.legacyAcknowledge.dispatch('click');
      expect(unacknowledgedUi).toMatchObject({
        legacyNotice: { hidden: false },
        legacyStatus: { textContent: catalogs['i18n/en.json'].preferenceSaveFailed },
      });
      await englishUi.browserWindow.dispatch('pagehide');
      expect(englishUi.requests.at(-1), 'leaving the page closes the authentication, whatever ran before it').toEqual({
        path: '/auth/close',
        body: undefined,
      });
      await expect(renderUi(script, [], {}, 'fr', translationKeys)).resolves.toMatchObject({
        firstSetup: { hidden: false },
        shell: { lang: 'en' },
      });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  }, 15_000);

  /**
   * The packed entry point loads and registers a platform, resolving its dependencies from outside this
   * repository as an installed plugin does.
   */
  it.skipIf(LINKED_SDK_EXEMPTION)(
    'exposes a registrable platform from the packed entry point',
    async () => {
      const directory = mkdtempSync(join(tmpdir(), 'homebridge-eufy-security-entry-'));
      const repository = fileURLToPath(new URL('../..', import.meta.url));

      try {
        const output = execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], {
          cwd: repository,
          encoding: 'utf8',
        });
        const [result] = JSON.parse(output) as PackResult[];
        execFileSync('tar', ['-xzf', join(directory, result.filename), '-C', directory]);
        const plugin = (await import(pathToFileURL(join(directory, 'package', 'dist', 'index.js')).href)) as {
          default: unknown;
        };

        expect(plugin.default).toBeTypeOf('function');
      } finally {
        rmSync(directory, { force: true, recursive: true });
      }
    },
    15_000,
  );
});

describe('setup wizard', () => {
  const repository = fileURLToPath(new URL('../..', import.meta.url));
  const publicDirectory = join(repository, 'homebridge-ui', 'public');
  const script = ['dashboard.js', 'legacy-settings.js', 'profile-wizard.js', 'setup-wizard.js', 'app.js']
    .map((file) => readFileSync(join(publicDirectory, 'js', file), 'utf8'))
    .join('\n');
  const catalogs = Object.fromEntries(
    ['en', 'fr'].map((language) => [
      `i18n/${language}.json`,
      JSON.parse(readFileSync(join(publicDirectory, 'i18n', `${language}.json`), 'utf8')) as Record<string, string>,
    ]),
  );
  const en = catalogs['i18n/en.json'];
  const block = { platform: 'HomebridgeEufy', username: 'guest@example.invalid', password: 'synthetic-password' };
  const base = {
    serial: 'T8010P0000000000',
    name: 'Synthetic Base',
    modelName: 'Synthetic HomeBase',
    deviceClass: 'homebase',
    category: 'security',
    preferences: ['represented', 'armingModes'],
    representation: ['arming.security-system'],
    represented: true,
  };
  const camera = {
    serial: 'T8000P0000000000',
    name: 'Synthetic Camera',
    modelName: 'Synthetic Cam',
    deviceClass: 'camera',
    category: 'security',
    preferences: ['represented', 'snapshotMode'],
    representation: ['camera.streaming'],
    represented: true,
    station: base.serial,
  };
  const standalone = { ...camera, serial: 'T8170P0000000000', name: 'Synthetic Solo', station: undefined };
  const sensor = {
    ...camera,
    serial: 'T8900P0000000000',
    name: 'Synthetic Sensor',
    deviceClass: 'sensor',
    artwork: 'assets/devices/T8900.png',
  };
  const diagnosed = { ...camera, serial: 'T8000P0000000009', diagnosticOnly: true };
  type MapNode = { textContent?: string; children?: MapNode[]; attributes?: Record<string, string> };
  const names = (nodes: MapNode[]): unknown =>
    nodes.map((node) => ({
      title: node.children?.[0]?.textContent,
      members: node.children?.[1]?.children?.map((member) => member.textContent),
    }));

  /**
   * A sign-in always leaves Homebridge to restart, so the wizard says so and remembers it is due rather than
   * walking devices no running plugin can show.
   */
  it('asks for a restart after a sign-in and remembers it is due', async () => {
    const ui = await renderUi(
      script,
      [],
      catalogs,
      'en',
      [],
      { status: 'restart-required' },
      { state: 'restart-required', devices: [camera] },
    );
    ui.acknowledgement.checked = true;
    await ui.acknowledgement.dispatch('change');
    await ui.continueButton.dispatch('click');
    ui.account.value = 'guest@example.invalid';
    ui.password.value = 'synthetic-password';
    await ui.authForm.dispatch('submit');

    expect(ui.wizardPanel.hidden).toBe(false);
    expect(ui.wizardRestart.hidden).toBe(false);
    expect(ui.wizardMap.hidden).toBe(true);
    expect(ui.wizardFinish.textContent).toBe(en.wizardClose);
    expect(ui.storage.get('homebridge-eufy.setup-wizard-pending')).toBe('pending');
    await ui.wizardFinish.dispatch('click');
    expect(ui.wizardPanel.hidden, 'closing the restart notice keeps the wizard due').toBe(true);
    expect(ui.storage.get('homebridge-eufy.setup-wizard-pending')).toBe('pending');
  });

  /**
   * Once the plugin runs, a due wizard opens by itself on a map of the household: each HomeBase with what hangs
   * off it, and the standalone cameras apart. A camera shows its last picture behind the play button, streams
   * only when asked and stops on demand, and offers its eufy settings in their own card.
   */
  it('opens on its own once the plugin runs and walks each device from the map', async () => {
    const ui = await renderUi(
      script,
      [block],
      catalogs,
      'en',
      [],
      undefined,
      { state: 'ready', devices: [base, camera, diagnosed, standalone, sensor] },
      undefined,
      true,
    );

    expect(ui.wizardPanel.hidden).toBe(false);
    expect(ui.wizardRestart.hidden).toBe(true);
    expect(ui.wizardProgress.textContent).toBe('Device 1 of 4');
    expect(names(ui.wizardMap.children as MapNode[])).toEqual([
      { title: 'Synthetic Base', members: ['Synthetic Camera', 'Synthetic Sensor'] },
      { title: en.wizardMapStandalone, members: ['Synthetic Solo'] },
    ]);
    expect(ui.wizardBack.disabled).toBe(true);
    expect(ui.wizardTitle.textContent).toBe('Synthetic Base');
    expect(ui.wizardLivePlay.hidden, 'a HomeBase has nothing to play').toBe(true);

    await ui.wizardNext.dispatch('click');
    await vi.waitFor(() => expect(ui.wizardLiveImage.src).toBe('data:image/jpeg;base64,c3ludGhldGlj'));
    expect(ui.wizardTitle.textContent).toBe('Synthetic Camera');
    expect(ui.wizardLivePlay.hidden).toBe(false);
    expect(
      ui.requests.map(({ path }) => path),
      'nothing streams until play is pressed',
    ).not.toContain('/device/live/start');
    expect(ui.wizardControls.innerHTML).toContain('data-preference="represented"');
    await vi.waitFor(() => expect(ui.wizardEufy.hidden).toBe(false));

    await ui.wizardLivePlay.dispatch('click');
    expect(ui.requests).toContainEqual({ path: '/device/live/start', body: { serial: camera.serial } });
    expect(ui.wizardLiveSpinner.hidden, 'a stream on its way spins').toBe(false);
    expect(ui.wizardLiveStop.hidden, 'and has nothing to stop yet').toBe(true);
    ui.pushListeners['device-live']?.({ data: { serial: camera.serial, image: 'bGl2ZQ==' } });
    expect(ui.wizardLiveSpinner.hidden).toBe(true);
    expect(ui.wizardLiveStop.hidden, 'video offers its stop').toBe(false);
    expect(ui.wizardLiveImage.src).toBe('data:image/jpeg;base64,bGl2ZQ==');
    await ui.wizardLiveStop.dispatch('click');
    expect(ui.requests.filter(({ path }) => path === '/device/live/stop')).toHaveLength(1);
    expect(ui.wizardLivePlay.hidden).toBe(false);
    expect(ui.wizardLiveStop.hidden).toBe(true);

    await ui.wizardLivePlay.dispatch('click');
    ui.pushListeners['device-live-end']?.({ data: { serial: camera.serial } });
    expect(ui.wizardLiveStatus.textContent, 'a stream that sent nothing says so').toBe(en.wizardLiveFailed);
    expect(ui.wizardLivePlay.hidden, 'and can be played again').toBe(false);

    const select = (ui.wizardSettings.children[0] as { children: Array<Record<string, unknown>> }).children[1];
    select.value = '0';
    await ui.wizardSettings.dispatch('change', { target: select } as never);
    expect(ui.requests).toContainEqual({
      path: '/device/settings/write',
      body: { serial: camera.serial, setting: 'nightVision', value: 0 },
    });
    expect(ui.wizardSettingsStatus.textContent).toBe(en.wizardSettingSent);

    await ui.wizardLivePlay.dispatch('click');
    await ui.wizardMap.dispatch('click', {
      target: { closest: () => ({ dataset: { serial: standalone.serial } }) },
    } as never);
    expect(
      ui.requests.filter(({ path }) => path === '/device/live/stop'),
      'leaving a camera stops its stream',
    ).toHaveLength(2);
    expect(ui.wizardTitle.textContent).toBe('Synthetic Solo');

    await ui.wizardNext.dispatch('click');
    expect(ui.wizardTitle.textContent, 'the last step shows which encoder codes live video').toBe(
      en.wizardEncodersTitle,
    );
    expect(ui.wizardNext.disabled).toBe(true);
    expect(ui.wizardEncoders.hidden).toBe(false);
    await vi.waitFor(() => expect(ui.wizardEncodersBody.children).toHaveLength(3));
    expect(ui.wizardEncodersBody.children.map(({ textContent }) => textContent)).toEqual([
      'Live video is coded by: libx264.',
      'h264_videotoolbox is not used: it made 442 KB of video where 336 KB fits the bit rate the Home app asks for.',
      en.wizardProbeRun,
    ]);
    await ui.wizardBack.dispatch('click');

    await ui.wizardBack.dispatch('click');
    expect(ui.wizardTitle.textContent).toBe('Synthetic Sensor');
    expect(ui.wizardLivePlay.hidden).toBe(true);
    expect(ui.wizardLiveImage.src, 'a device that is not a camera shows its product picture').toBe(sensor.artwork);

    await ui.wizardFinish.dispatch('click');
    expect(ui.wizardPanel.hidden).toBe(true);
    expect(ui.storage.has('homebridge-eufy.setup-wizard-pending'), 'finishing clears the marker').toBe(false);
  });

  /** The wizard's button reopens it at any time, without a sign-in. */
  it('reopens from its button', async () => {
    const ui = await renderUi(script, [block], catalogs, 'en', [], undefined, { state: 'ready', devices: [sensor] });
    expect(ui.wizardPanel.hidden).toBe(true);

    await ui.menuWizard.dispatch('click');

    expect(ui.wizardPanel.hidden).toBe(false);
    expect(ui.wizardProgress.textContent).toBe('Device 1 of 1');
  });
});
