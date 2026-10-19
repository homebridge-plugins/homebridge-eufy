const shell = document.querySelector('[data-ui-shell]');
const masthead = document.querySelector('[data-masthead]');
const firstSetup = document.querySelector('[data-first-setup]');
const setupContent = document.querySelector('[data-setup-content]');
const acknowledgement = document.querySelector('[data-first-setup-ack]');
const continueButton = document.querySelector('[data-first-setup-continue]');
const authForm = document.querySelector('[data-auth-form]');
const challengeForm = document.querySelector('[data-challenge-form]');
const accountInput = document.querySelector('[data-account]');
const passwordInput = document.querySelector('[data-password]');
const countryInput = document.querySelector('[data-country]');
const trustedDeviceInput = document.querySelector('[data-trusted-device-name]');
const challengeAnswer = document.querySelector('[data-challenge-answer]');
const challengeImage = document.querySelector('[data-challenge-image]');
const challengeLabel = document.querySelector('[data-challenge-label]');
const authStatus = document.querySelector('[data-auth-status]');
const authSubmit = document.querySelector('[data-auth-submit]');
const challengeSubmit = document.querySelector('[data-challenge-submit]');
const dashboard = document.querySelector('[data-dashboard]');
const dashboardState = document.querySelector('[data-dashboard-state]');
const dashboardTitle = document.querySelector('[data-dashboard-title]');
const dashboardBadge = document.querySelector('[data-dashboard-badge]');
const dashboardSummary = document.querySelector('[data-dashboard-summary]');
const dashboardAuthenticate = document.querySelector('[data-dashboard-authenticate]');
const reauthDialog = document.querySelector('[data-reauth-dialog]');
const reauthAction = document.querySelector('[data-reauth-action]');
const attentionDialog = document.querySelector('[data-attention-dialog]');
const attentionTitle = document.querySelector('[data-attention-title]');
const attentionSummary = document.querySelector('[data-attention-summary]');
const attentionDiagnose = document.querySelector('[data-attention-diagnose]');
const attentionChoose = document.querySelector('[data-attention-choose]');
const deviceGroups = document.querySelector('[data-device-groups]');
const updatePending = document.querySelector('[data-update-pending]');
const updatePendingSummary = document.querySelector('[data-update-pending-summary]');
const updatePendingVersion = document.querySelector('[data-update-pending-version]');
const updateRestart = document.querySelector('[data-update-restart]');
const pageTitle = document.querySelector('[data-page-title]');
const legacyNotice = document.querySelector('[data-legacy-notice]');
const legacySettings = document.querySelector('[data-legacy-settings]');
const legacyAcknowledge = document.querySelector('[data-legacy-acknowledge]');
const legacyStatus = document.querySelector('[data-legacy-status]');
const menuDiagnostics = document.querySelector('[data-menu-diagnostics]');
const menuAdvanced = document.querySelector('[data-menu-advanced]');
const diagnosticsPanel = document.querySelector('[data-diagnostics]');
const mastheadDiagnostics = document.querySelector('[data-masthead-diagnostics]');
const diagnosticsClose = document.querySelector('[data-diagnostics-close]');
const diagnosticsWizardPanel = document.querySelector('[data-diagnostics-wizard]');
const diagnosticsQuestionText = document.querySelector('[data-diagnostics-question-text]');
const diagnosticsTiles = [...document.querySelectorAll('[data-diagnostics-tile]')];
const diagnosticsCancel = document.querySelector('[data-diagnostics-cancel]');
const diagnosticsReproduction = document.querySelector('[data-diagnostics-reproduction]');
const diagnosticsStatus = document.querySelector('[data-diagnostics-status]');
const diagnosticsIssue = document.querySelector('[data-diagnostics-issue]');
const diagnosticsExistingIssue = document.querySelector('[data-diagnostics-existing-issue]');
const diagnosticsResult = document.querySelector('[data-diagnostics-result]');
const diagnosticsActions = document.querySelector('[data-diagnostics-actions]');
const diagnosticsGuidance = document.querySelector('[data-diagnostics-guidance]');
const diagnosticsPhaseTitle = document.querySelector('[data-diagnostics-phase-title]');
const diagnosticsGuidanceAction = document.querySelector('[data-diagnostics-guidance-action]');
const diagnosticsCaptureNote = document.querySelector('[data-diagnostics-capture-note]');
const diagnosticsHandoff = document.querySelector('[data-diagnostics-handoff]');
const diagnosticsHandoffNote = document.querySelector('[data-diagnostics-handoff-note]');
const diagnosticsResultStatus = document.querySelector('[data-diagnostics-result-status]');
const diagnosticsExport = document.querySelector('[data-diagnostics-export]');
const diagnosticsResultHeading = document.querySelector('[data-diagnostics-result-heading]');
const diagnosticsStartAnother = document.querySelector('[data-diagnostics-start-another]');
const diagnosticsDownloadAgain = document.querySelector('[data-diagnostics-download-again]');
const advancedPanel = document.querySelector('[data-advanced-settings]');
const devicePanel = document.querySelector('[data-device-settings]');
const deviceClose = document.querySelector('[data-device-close]');
const deviceSettingsTitle = document.querySelector('[data-device-settings-title]');
const deviceSettingsEyebrow = document.querySelector('[data-device-settings-eyebrow]');
const deviceSettingsControls = document.querySelector('[data-device-settings-controls]');
const advancedClose = document.querySelector('[data-advanced-close]');
const advancedPolling = document.querySelector('[data-advanced-polling]');
const advancedConcurrentMedia = document.querySelector('[data-advanced-concurrent-media]');
const advancedFfmpeg = document.querySelector('[data-advanced-ffmpeg]');
const advancedSmallVideoPackets = document.querySelector('[data-advanced-small-video-packets]');
const advancedLiveVideoPassthrough = document.querySelector('[data-advanced-live-video-passthrough]');
const advancedHardwareVideoEncoder = document.querySelector('[data-advanced-hardware-video-encoder]');
const advancedHdLiveVideo = document.querySelector('[data-advanced-hd-live-video]');
const advancedIgnoreHomeBitRate = document.querySelector('[data-advanced-ignore-home-bit-rate]');
const warmUpAvailable = document.querySelector('[data-warm-up-available]');
const warmUpChosen = document.querySelector('[data-warm-up-chosen]');
const warmUpAdd = document.querySelector('[data-warm-up-add]');
const warmUpAddAll = document.querySelector('[data-warm-up-add-all]');
const warmUpRemove = document.querySelector('[data-warm-up-remove]');
const warmUpRemoveAll = document.querySelector('[data-warm-up-remove-all]');
const advancedStatus = document.querySelector('[data-advanced-status]');
const menuWizard = document.querySelector('[data-menu-wizard]');
const wizardPanel = document.querySelector('[data-setup-wizard]');
const wizardClose = document.querySelector('[data-wizard-close]');
const wizardProgress = document.querySelector('[data-wizard-progress]');
const wizardTitle = document.querySelector('[data-wizard-title]');
const wizardEyebrow = document.querySelector('[data-wizard-eyebrow]');
const wizardRestart = document.querySelector('[data-wizard-restart]');
const wizardLive = document.querySelector('[data-wizard-live]');
const wizardLiveImage = document.querySelector('[data-wizard-live-image]');
const wizardLiveStatus = document.querySelector('[data-wizard-live-status]');
const wizardLivePlay = document.querySelector('[data-wizard-live-play]');
const wizardLiveStop = document.querySelector('[data-wizard-live-stop]');
const wizardLiveSpinner = document.querySelector('[data-wizard-live-spinner]');
const wizardSettings = document.querySelector('[data-wizard-settings]');
const wizardControls = document.querySelector('[data-wizard-controls]');
const wizardBack = document.querySelector('[data-wizard-back]');
const wizardNext = document.querySelector('[data-wizard-next]');
const wizardFinish = document.querySelector('[data-wizard-finish]');
const wizardMap = document.querySelector('[data-wizard-map]');
const wizardStage = document.querySelector('[data-wizard-stage]');
const wizardHomeKit = document.querySelector('[data-wizard-homekit]');
const wizardEufy = document.querySelector('[data-wizard-eufy]');
const wizardEncoders = document.querySelector('[data-wizard-encoders]');
const wizardEncodersBody = document.querySelector('[data-wizard-encoders-body]');

let messages = {};
let pluginConfig = [];
let savedConfigSignature = '';
let pendingConfig;
let challenge = '';
let legacyNames = [];
let legacyAcknowledged = false;
let diagnosticsState = { status: 'inactive', missingEvidence: [] };
/** Whether the reporter already downloaded this session's archive, which is what the report offer follows. */
let diagnosticsArchiveDownloaded = false;
/** The session whose archive is reviewed and ready to export, so the review is fetched once rather than per render. */
let diagnosticsReviewedCaseId = '';
/** The one fetch in flight, so a burst of renders does not assemble the archive several times over. */
let diagnosticsReviewRequest;
let diagnosticsReviewId = '';
let panelReturn;
/** The problem the dashboard last drew, which the dashboard's diagnostics action points at while there is one. */
let dashboardAttention;
let dashboardPanelTrigger;
const dashboardView = window.HomebridgeEufyDashboard;
const legacySettingsView = window.HomebridgeEufyLegacySettings;
const diagnosticsWizard = window.HomebridgeEufyDiagnosticsWizard;
const setupWizard = window.HomebridgeEufySetupWizard;
const dashboardElements = {
  dashboard,
  title: dashboardTitle,
  summary: dashboardSummary,
  authenticate: dashboardAuthenticate,
  groups: deviceGroups,
  deviceSettingsTitle,
  deviceSettingsEyebrow,
  deviceSettingsControls,
  preferenceContainers: [deviceSettingsControls, wizardControls],
  updatePending,
  updatePendingSummary,
  updatePendingVersion,
  updateRestart,
  setup: setupContent,
  pageTitle,
  masthead,
};

const REQUEST_TIMED_OUT = 'Request timed out';

/**
 * A request the page stops waiting for after `timeoutMs`. The timeout error carries the request as `late`, since
 * the plugin may still carry it out after the page gave up.
 */
function requestWithinDeadline(path, body, timeoutMs = 320000) {
  let timer;
  const request = homebridge.request(path, body);
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(REQUEST_TIMED_OUT), { late: request })), timeoutMs);
  });
  return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
}

function isDashboardUiReproducing(state = diagnosticsState) {
  return diagnosticsWizard.backgroundActive(state);
}

async function recordActiveUiEvent(event) {
  if (!isDashboardUiReproducing()) return;
  await requestWithinDeadline('/diagnostics/ui-event', { event }, 12000);
}

function recordActiveUiEventBestEffort(event) {
  void recordActiveUiEvent(event).catch(() => undefined);
}

/** A country code that is not two letters is refused where it is typed, in the page's own words. */
countryInput.addEventListener('input', () => {
  countryInput.setCustomValidity(countryInput.validity.patternMismatch ? (messages.countryInvalid ?? '') : '');
});

acknowledgement.addEventListener('change', () => {
  continueButton.disabled = !acknowledgement.checked;
});

continueButton.addEventListener('click', () => {
  if (!acknowledgement.checked) return;
  firstSetup.hidden = true;
  setupContent.hidden = false;
});

/**
 * Declares the resolved locale on both the document root and the shell.
 *
 * The root element is what assistive technology reads to choose pronunciation and what a translation tool
 * reads to identify the page's language; the shell attribute is what this script's own date formatting reads.
 */
function applyLocale(locale) {
  document.documentElement.lang = locale;
  shell.lang = locale;
}

async function loadMessages(locale) {
  const response = await fetch(`i18n/${locale}.json`);
  if (!response.ok) {
    throw new Error(`Unable to load ${locale} translations`);
  }
  return response.json();
}

async function applyTranslations(language) {
  let locale = language.toLowerCase().split('-')[0] === 'fr' ? 'fr' : 'en';
  try {
    messages = await loadMessages(locale);
  } catch {
    locale = 'en';
    try {
      messages = await loadMessages(locale);
    } catch {
      applyLocale(locale);
      return;
    }
  }

  applyLocale(locale);
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = messages[element.dataset.i18n] ?? element.textContent;
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
    element.setAttribute('aria-label', messages[element.dataset.i18nAriaLabel] ?? '');
  });
}

function setBusy(busy) {
  authSubmit.disabled = busy;
  challengeSubmit.disabled = busy;
}

const diagnosticsProfiles = {
  'startup-authentication': { title: 'diagnosticsProfileStartup', action: 'diagnosticsStartupAction' },
  'device-representation': { title: 'diagnosticsProfileDevices', action: 'diagnosticsDevicesAction' },
  'control-state': { title: 'diagnosticsProfileControl', action: 'diagnosticsControlAction' },
  'live-media': { title: 'diagnosticsProfileLiveMedia', action: 'diagnosticsLiveAction' },
  'hksv-recording': { title: 'diagnosticsProfileRecording', action: 'diagnosticsRecordingAction' },
  'dashboard-ui': { title: 'diagnosticsProfileDashboard', action: 'diagnosticsDashboardAction' },
  other: { title: 'diagnosticsProfileOther', action: 'diagnosticsOtherAction' },
};

function renderDiagnosticsGuidance(profile) {
  const guidance = diagnosticsProfiles[profile] ?? diagnosticsProfiles.other;
  diagnosticsPhaseTitle.textContent = messages[guidance.title] ?? '';
  diagnosticsGuidanceAction.textContent = messages[guidance.action] ?? '';
}

/**
 * The report step, reachable or not.
 *
 * Without an archive there is nothing to attach, so the anchor carries no `href` — it is not a link — and
 * `aria-disabled` states the same thing to a reader who cannot see it greyed. The hint says why, because a
 * control that cannot be used and does not explain itself reads as broken rather than as not yet.
 */
function setIssueStepReachable(url) {
  diagnosticsIssue.href = url;
  diagnosticsExistingIssue.href = url.replace(/\/issues\/new.*$/, '/issues?q=is%3Aissue+involves%3A%40me');
}

/**
 * Leaves the archive dialog once its file is handed over, which is what ends the session: the plugin keeps it until
 * then so a download that never arrived can be tried again.
 */
async function endDiagnosticsCase() {
  try {
    renderDiagnostics(await requestWithinDeadline('/diagnostics/cancel', undefined, 12000));
  } catch (error) {
    await redrawDiagnosticsAfterFailure('inactive', error);
  }
  diagnosticsQuestionText.focus?.();
}

function renderDiagnostics(state) {
  if (state.supportCaseId !== diagnosticsState.supportCaseId) diagnosticsArchiveDownloaded = false;
  diagnosticsState = state;
  const screen = diagnosticsWizard.screen(state);
  const choosing = screen === 'choose';
  const reviewing = screen === 'review';
  renderDiagnosticsEntries();
  diagnosticsWizardPanel.hidden = !choosing;
  diagnosticsGuidance.hidden = screen !== 'reproduce';
  diagnosticsActions.hidden = screen !== 'reproduce';
  diagnosticsReproduction.disabled = state.status !== 'reproducing';
  setIssueStepReachable(diagnosticsArchiveDownloaded ? (state.issueUrl ?? '') : '');
  const offering = (reviewing || diagnosticsArchiveDownloaded) && !diagnosticsPanel.hidden;
  if (offering && !diagnosticsResult.open) diagnosticsResult.showModal?.();
  if (!offering && diagnosticsResult.open) diagnosticsResult.close?.();
  diagnosticsResultHeading.textContent =
    messages[
      diagnosticsArchiveDownloaded
        ? 'diagnosticsArchiveDownloaded'
        : state.reproductionEndedAt && state.reproductionEndedAt === state.expiresAt
          ? 'diagnosticsCaptureTimedOut'
          : 'diagnosticsEvidenceReady'
    ] ?? '';
  const reviewed = reviewing && diagnosticsReviewedCaseId === (state.supportCaseId ?? '');
  diagnosticsExport.hidden = !reviewed || diagnosticsArchiveDownloaded;
  diagnosticsHandoff.hidden = !diagnosticsArchiveDownloaded;
  diagnosticsHandoffNote.hidden = !diagnosticsArchiveDownloaded;
  if (!offering) diagnosticsResultStatus.textContent = '';
  else if (!diagnosticsArchiveDownloaded && state.missingEvidence?.length) {
    diagnosticsResultStatus.textContent = messages.diagnosticsMissingEvidence ?? '';
  }
  diagnosticsStartAnother.hidden = !diagnosticsArchiveDownloaded;
  diagnosticsDownloadAgain.hidden = !diagnosticsArchiveDownloaded;
  if (!reviewed) {
    diagnosticsExport.disabled = true;
    diagnosticsReviewId = '';
    if (reviewing && !diagnosticsArchiveDownloaded) void ensureArchiveReview(state.supportCaseId ?? '');
  }
  if (screen === 'reproduce') {
    renderDiagnosticsGuidance(state.profile);
    const stopsAt = new Date(state.expiresAt).toLocaleString(shell.lang || undefined, {
      weekday: 'long',
      hour: 'numeric',
      minute: '2-digit',
    });
    diagnosticsCaptureNote.textContent = (messages.diagnosticsCaptureKeepsRunning ?? '').replace('{time}', stopsAt);
  }
  diagnosticsStatus.textContent = '';
}

/**
 * Marks both diagnostics actions while a capture runs, whichever area it is on, and otherwise the dashboard's own
 * while it shows a problem.
 */
function renderDiagnosticsEntries() {
  const collecting = diagnosticsState.status === 'reproducing';
  for (const entry of [mastheadDiagnostics, menuDiagnostics]) {
    const attending = !collecting && entry === menuDiagnostics && dashboardAttention !== undefined;
    if (collecting) entry.dataset.collecting = 'true';
    else delete entry.dataset.collecting;
    if (attending) entry.dataset.attention = 'true';
    else delete entry.dataset.attention;
    entry.setAttribute(
      'aria-label',
      messages[collecting ? 'diagnosticsCollectingFinishHere' : attending ? 'diagnosticsAttention' : 'menuDiagnostics'] ??
        '',
    );
  }
}

/**
 * The reviewed archive for the session on screen, fetched once.
 *
 * A completed reproduction that the reporter is looking at is a file they came for, so the archive is
 * reviewed without being asked for. It is reviewed once per session rather than per render, because
 * assembling it reads every collected log. Exporting spends it, and ends the session with it.
 */
function ensureArchiveReview(caseId) {
  if (!caseId || diagnosticsReviewedCaseId === caseId) return Promise.resolve();
  diagnosticsReviewRequest ??= (async () => {
    try {
      const review = await requestWithinDeadline('/diagnostics/archive/review', undefined, 12000);
      diagnosticsReviewId = review.reviewId;
      diagnosticsReviewedCaseId = caseId;
      diagnosticsExport.hidden = false;
      diagnosticsExport.disabled = false;
    } catch {
      diagnosticsResultStatus.textContent = messages.diagnosticsFailed ?? '';
    } finally {
      diagnosticsReviewRequest = undefined;
    }
  })();
  return diagnosticsReviewRequest;
}

/**
 * Hands the archive of the session on screen over as a download.
 *
 * Finishing a reproduction calls this without being asked, since the file is what the reporter finished for; the
 * dialog's own button is the way to try again after a failed attempt.
 */
async function downloadDiagnosticsArchive() {
  await ensureArchiveReview(diagnosticsState.supportCaseId ?? '');
  if (!diagnosticsReviewId) return;
  diagnosticsExport.disabled = true;
  try {
    const exported = await requestWithinDeadline(
      '/diagnostics/archive/export',
      { reviewId: diagnosticsReviewId },
      12000,
    );
    const download = document.createElement('a');
    download.href = `data:${exported.mediaType};base64,${exported.archive}`;
    download.download = exported.filename;
    diagnosticsHandoffNote.textContent = (messages.diagnosticsArchiveHandoff ?? '').replace(
      '{filename}',
      exported.filename,
    );
    diagnosticsResultStatus.textContent = '';
    document.body.appendChild(download);
    download.click();
    document.body.removeChild(download);
    diagnosticsReviewId = '';
    diagnosticsReviewedCaseId = '';
    diagnosticsArchiveDownloaded = true;
    renderDiagnostics(diagnosticsState);
    diagnosticsResultHeading.focus?.();
  } catch {
    // The plugin spends a review on any attempt, so trying again asks for a fresh one.
    diagnosticsReviewId = '';
    diagnosticsReviewedCaseId = '';
    diagnosticsExport.disabled = false;
    diagnosticsResultStatus.textContent = messages.diagnosticsFailed ?? '';
  }
}

diagnosticsExport.addEventListener('click', downloadDiagnosticsArchive);
diagnosticsDownloadAgain.addEventListener('click', downloadDiagnosticsArchive);

/**
 * Draws the session as the plugin holds it after `error`, and says so unless it reached `expected`, inside the
 * download dialog while that covers the panel. A request that timed out may still land, so its late answer draws
 * the session again.
 */
async function redrawDiagnosticsAfterFailure(expected, error) {
  const refreshed = await settleDiagnostics().catch(() => undefined);
  if (refreshed?.status !== expected) {
    (diagnosticsResult.open ? diagnosticsResultStatus : diagnosticsStatus).textContent = messages.diagnosticsFailed ?? '';
  }
  error?.late?.then(settleDiagnostics).catch(() => undefined);
}

/**
 * Draws the session the plugin holds. One opened but never started is what a failed or late pick leaves behind;
 * nothing on screen stands for it and it keeps detailed logging on, so it is cancelled rather than drawn.
 */
async function settleDiagnostics() {
  let state = await requestWithinDeadline('/diagnostics/status', undefined, 12000);
  if (state.status === 'authorized') state = await requestWithinDeadline('/diagnostics/cancel', undefined, 12000);
  renderDiagnostics(state);
  return state;
}

/**
 * Captures the area picked. The area is the only answer a capture needs, so the pick opens the session and starts
 * it in one go.
 */
async function startDiagnosticsCapture(profile) {
  for (const tile of diagnosticsTiles) tile.disabled = true;
  try {
    await requestWithinDeadline('/diagnostics/authorize', { profile }, 12000);
    const state = await requestWithinDeadline('/diagnostics/reproduction/start', undefined, 12000);
    renderDiagnostics(state);
    if (isDashboardUiReproducing(state)) {
      await recordActiveUiEvent('background-started').catch(() => undefined);
      closeDashboardPanel();
      return;
    }
    diagnosticsPhaseTitle.focus?.();
  } catch (error) {
    await redrawDiagnosticsAfterFailure('reproducing', error);
  } finally {
    for (const tile of diagnosticsTiles) tile.disabled = false;
  }
}

for (const tile of diagnosticsTiles) {
  tile.addEventListener('click', () => startDiagnosticsCapture(tile.dataset.diagnosticsTile));
}

diagnosticsStartAnother.addEventListener('click', endDiagnosticsCase);
/** Escape leaves the archive dialog only once its file is downloaded, and leaving it finishes the session. */
diagnosticsResult.addEventListener('cancel', (event) => {
  event.preventDefault();
  if (diagnosticsArchiveDownloaded) endDiagnosticsCase();
});

diagnosticsReproduction.addEventListener('click', async () => {
  diagnosticsReproduction.disabled = true;
  try {
    let state = await requestWithinDeadline('/diagnostics/reproduction/end', undefined, 12000);
    if (state.status === 'complete' && state.missingEvidence?.length) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      state = await requestWithinDeadline('/diagnostics/status', undefined, 12000);
    }
    renderDiagnostics(state);
  } catch (error) {
    await redrawDiagnosticsAfterFailure('complete', error);
  } finally {
    diagnosticsReproduction.disabled = diagnosticsState.status !== 'reproducing';
  }
  if (diagnosticsState.partialExportAvailable) {
    diagnosticsResultHeading.focus?.();
    await downloadDiagnosticsArchive();
  }
});

/** Cancelling a capture deletes its session without a file, and puts the areas back on the panel. */
diagnosticsCancel.addEventListener('click', async () => {
  diagnosticsCancel.disabled = true;
  try {
    renderDiagnostics(await requestWithinDeadline('/diagnostics/cancel', undefined, 12000));
    diagnosticsQuestionText.focus?.();
  } catch (error) {
    await redrawDiagnosticsAfterFailure('inactive', error);
  } finally {
    diagnosticsCancel.disabled = false;
  }
});

/**
 * Opens one dashboard panel over whichever screen is currently showing.
 *
 * The diagnostics panel is a sibling of the dashboard rather than a child of it, so it can open before an
 * account exists — a startup or sign-in failure is visible on the setup and authentication screens, which is
 * exactly where the dashboard is hidden. The advanced panel still lives inside the dashboard, because every
 * setting it holds needs an account to mean anything.
 */
function openDashboardPanel(panel, trigger) {
  dashboardPanelTrigger = trigger;
  panelReturn = {
    masthead: masthead.hidden,
    firstSetup: firstSetup.hidden,
    setupContent: setupContent.hidden,
    dashboard: dashboard.hidden,
  };
  masthead.hidden = true;
  firstSetup.hidden = true;
  setupContent.hidden = true;
  const insideDashboard = panel !== diagnosticsPanel;
  dashboard.hidden = !insideDashboard;
  dashboardState.hidden = insideDashboard;
  dashboardSummary.hidden = insideDashboard;
  deviceGroups.hidden = insideDashboard;
  for (const other of [diagnosticsPanel, advancedPanel, devicePanel, wizardPanel]) {
    other.hidden = other !== panel;
  }
  panel.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  panel.querySelector('.dashboard-page-back')?.focus?.();
}

/** Restores the screen a panel was opened over, rather than assuming it was the dashboard. */
function closeDashboardPanel() {
  diagnosticsPanel.hidden = true;
  advancedPanel.hidden = true;
  devicePanel.hidden = true;
  wizardPanel.hidden = true;
  stopWizardLive();
  dashboardState.hidden = false;
  dashboardSummary.hidden = false;
  deviceGroups.hidden = false;
  const restored = panelReturn;
  if (restored) {
    masthead.hidden = restored.masthead;
    firstSetup.hidden = restored.firstSetup;
    setupContent.hidden = restored.setupContent;
    dashboard.hidden = restored.dashboard;
    panelReturn = undefined;
  }
  dashboardPanelTrigger?.focus?.();
  if (!restored || restored.dashboard === false) {
    recordActiveUiEventBestEffort('dashboard-opened');
  }
}

/**
 * Opens the diagnostics panel. A preset is an area the reporter already chose to diagnose from a problem the
 * dashboard named beside the privacy note, so a panel with nothing under way captures it at once. Opened over the
 * sign-in screen, the panel asks like any other and puts focus on the startup area.
 */
async function openDiagnostics(preset) {
  const signingIn = !setupContent.hidden;
  openDashboardPanel(diagnosticsPanel, menuDiagnostics);
  try {
    renderDiagnostics(await requestWithinDeadline('/diagnostics/status', undefined, 12000));
  } catch {
    diagnosticsStatus.textContent = messages.diagnosticsFailed ?? '';
    recordActiveUiEventBestEffort('request-failed');
    return;
  }
  if (diagnosticsWizard.screen(diagnosticsState) !== 'choose') return;
  if (preset) await startDiagnosticsCapture(preset.profile);
  else if (signingIn) {
    diagnosticsTiles.find((tile) => tile.dataset.diagnosticsTile === 'startup-authentication')?.focus?.();
  }
}

mastheadDiagnostics.addEventListener('click', () => openDiagnostics());

/** While the dashboard shows a problem and no session is under way, the action names it before opening the wizard. */
menuDiagnostics.addEventListener('click', () => {
  if (!menuDiagnostics.dataset.attention || diagnosticsWizard.screen(diagnosticsState) !== 'choose') {
    return openDiagnostics();
  }
  attentionTitle.textContent = dashboardAttention.title;
  attentionSummary.textContent = dashboardAttention.summary;
  attentionDialog.showModal?.();
});
attentionDiagnose.addEventListener('click', () => {
  attentionDialog.close?.();
  return openDiagnostics(dashboardAttention);
});
attentionChoose.addEventListener('click', () => {
  attentionDialog.close?.();
  return openDiagnostics();
});
menuAdvanced.addEventListener('click', async () => {
  const config = configuredBlock() ?? {};
  advancedPolling.value = String(config.pollingIntervalMinutes ?? 10);
  advancedConcurrentMedia.value = String(config.maxConcurrentMediaSessions ?? 0);
  warmUpSelection = [...new Set(Array.isArray(config.warmUpEvents) ? config.warmUpEvents : ['doorbellPress'])].sort();
  warmUpMarked = new Set();
  renderWarmUp();
  advancedFfmpeg.value = config.ffmpegPath ?? '';
  advancedSmallVideoPackets.checked = config.smallVideoPackets === true;
  advancedLiveVideoPassthrough.checked = config.liveVideoPassthrough === true;
  advancedHardwareVideoEncoder.checked = config.hardwareVideoEncoder !== false;
  advancedHdLiveVideo.checked = config.hdLiveVideo === true;
  advancedIgnoreHomeBitRate.checked = config.ignoreHomeBitRate === true;
  openDashboardPanel(advancedPanel, menuAdvanced);
  /**
   * The panel asks for its own candidates rather than relying on the devices view having been opened first.
   * Without this a user who came straight here sees an empty left column, and clearing the right one would leave
   * the setting with no way back. Best effort: an unanswered request leaves whatever is already chosen.
   */
  if (warmUpCandidates.length === 0) {
    try {
      const snapshot = await requestWithinDeadline('/dashboard', { representationPreferences: {} }, 12000);
      warmUpCandidates = Array.isArray(snapshot.warmUpCandidates) ? snapshot.warmUpCandidates : [];
      renderWarmUp();
    } catch {
      recordActiveUiEventBestEffort('request-failed');
    }
  }
});
diagnosticsClose.addEventListener('click', () => {
  closeDashboardPanel();
  renderDiagnostics(diagnosticsState);
});
advancedClose.addEventListener('click', () => {
  closeDashboardPanel();
});

deviceClose.addEventListener('click', () => {
  closeDashboardPanel();
});

async function updateAdvancedSettings() {
  const existing = configuredBlock();
  if (!existing) return;
  const rawPolling = advancedPolling.value.trim();
  const pollingIntervalMinutes = rawPolling === '' ? 10 : Number(rawPolling);
  if (!Number.isInteger(pollingIntervalMinutes) || pollingIntervalMinutes < 0) {
    advancedPolling.setCustomValidity?.(messages.advancedPollingInvalid ?? '');
    advancedPolling.reportValidity?.();
    return;
  }
  advancedPolling.setCustomValidity?.('');
  const rawConcurrentMedia = advancedConcurrentMedia.value.trim();
  const maxConcurrentMediaSessions = rawConcurrentMedia === '' ? 0 : Number(rawConcurrentMedia);
  if (!Number.isInteger(maxConcurrentMediaSessions) || maxConcurrentMediaSessions < 0) {
    advancedConcurrentMedia.setCustomValidity?.(messages.advancedConcurrentMediaInvalid ?? '');
    advancedConcurrentMedia.reportValidity?.();
    return;
  }
  advancedConcurrentMedia.setCustomValidity?.('');
  const ffmpegPath = advancedFfmpeg.value.trim();
  const next = { ...existing };
  if (pollingIntervalMinutes === 10) delete next.pollingIntervalMinutes;
  else next.pollingIntervalMinutes = pollingIntervalMinutes;
  if (maxConcurrentMediaSessions === 0) delete next.maxConcurrentMediaSessions;
  else next.maxConcurrentMediaSessions = maxConcurrentMediaSessions;
  if (ffmpegPath) next.ffmpegPath = ffmpegPath;
  else delete next.ffmpegPath;
  if (advancedSmallVideoPackets.checked) next.smallVideoPackets = true;
  else delete next.smallVideoPackets;
  if (advancedLiveVideoPassthrough.checked) next.liveVideoPassthrough = true;
  else delete next.liveVideoPassthrough;
  if (advancedHardwareVideoEncoder.checked) delete next.hardwareVideoEncoder;
  else next.hardwareVideoEncoder = false;
  if (advancedHdLiveVideo.checked) next.hdLiveVideo = true;
  else delete next.hdLiveVideo;
  if (advancedIgnoreHomeBitRate.checked) next.ignoreHomeBitRate = true;
  else delete next.ignoreHomeBitRate;
  // The default is what the plugin applies when the key is absent, so storing it would only pin today's default.
  if (warmUpSelection.length === 1 && warmUpSelection[0] === 'doorbellPress') delete next.warmUpEvents;
  else next.warmUpEvents = [...warmUpSelection];
  try {
    await updateConfig(next);
    advancedStatus.textContent = '';
  } catch {
    advancedStatus.textContent = messages.advancedSaveFailed ?? '';
    recordActiveUiEventBestEffort('request-failed');
  }
}

advancedPolling.addEventListener('change', updateAdvancedSettings);
advancedConcurrentMedia.addEventListener('change', updateAdvancedSettings);
advancedFfmpeg.addEventListener('change', updateAdvancedSettings);
advancedSmallVideoPackets.addEventListener('change', updateAdvancedSettings);
advancedLiveVideoPassthrough.addEventListener('change', updateAdvancedSettings);
advancedHardwareVideoEncoder.addEventListener('change', updateAdvancedSettings);
advancedHdLiveVideo.addEventListener('change', updateAdvancedSettings);
advancedIgnoreHomeBitRate.addEventListener('change', updateAdvancedSettings);
warmUpAdd.addEventListener('click', () => moveWarmUp('available'));
warmUpAddAll.addEventListener('click', () => moveWarmUp('available', true));
warmUpRemove.addEventListener('click', () => moveWarmUp('chosen'));
warmUpRemoveAll.addEventListener('click', () => moveWarmUp('chosen', true));

let warmUpSelection = ['doorbellPress'];
let warmUpCandidates = [];
// The devices the dashboard last drew, so opening a tile can find the one it speaks for.
let dashboardDevices = [];
/**
 * The entries the user has marked, in whichever column they sit.
 *
 * One set is enough because an event is in exactly one column: the column follows from whether the selection
 * holds it. Marking is what makes the single arrows act on a choice rather than on whatever came first.
 */
let warmUpMarked = new Set();

/**
 * The events this interface may offer: whatever the discovered devices report, plus anything already chosen.
 *
 * Keeping a chosen event that no device currently reports is deliberate — a camera may be offline, and dropping
 * the entry would silently rewrite the user's setting on the next save.
 */
function warmUpOffered() {
  return [...new Set([...warmUpCandidates, ...warmUpSelection])].sort();
}

/**
 * A readable name for one event: the translation where this build has one, and otherwise a label derived from
 * the reported name. Deriving it is what lets a newly reported event appear without a release here.
 */
function warmUpLabel(event) {
  const translated = messages[`advancedWarmUpEvent_${event}`];
  if (translated) return translated;
  const spaced = event.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Draws both columns from the selection.
 *
 * Each entry is a button rather than an option, so a keyboard reaches it and a screen reader announces the
 * column it belongs to. The move buttons are disabled while there is nothing to move, because a control that
 * looks available and does nothing is worse than one that says it cannot.
 */
function renderWarmUp() {
  if (!warmUpAvailable || !warmUpChosen) return;
  const offered = warmUpOffered();
  const columns = [
    { list: warmUpAvailable, column: 'available', events: offered.filter((e) => !warmUpSelection.includes(e)) },
    { list: warmUpChosen, column: 'chosen', events: offered.filter((e) => warmUpSelection.includes(e)) },
  ];
  for (const { list, column, events } of columns) {
    list.textContent = '';
    for (const event of events) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = warmUpLabel(event);
      button.setAttribute('aria-pressed', String(warmUpMarked.has(event)));
      button.addEventListener('click', () => {
        if (warmUpMarked.has(event)) warmUpMarked.delete(event);
        else warmUpMarked.add(event);
        renderWarmUp();
      });
      item.append(button);
      list.append(item);
    }
  }
  const availableEvents = offered.filter((event) => !warmUpSelection.includes(event));
  // A control that looks available and moves nothing is worse than one that says it cannot.
  if (warmUpAdd) warmUpAdd.disabled = !availableEvents.some((event) => warmUpMarked.has(event));
  if (warmUpAddAll) warmUpAddAll.disabled = availableEvents.length === 0;
  if (warmUpRemove) warmUpRemove.disabled = !warmUpSelection.some((event) => warmUpMarked.has(event));
  if (warmUpRemoveAll) warmUpRemoveAll.disabled = warmUpSelection.length === 0;
}

/**
 * Moves every marked entry of one column across, or every entry of it when asked for all.
 *
 * The marks are cleared afterwards rather than carried over: the entry has visibly changed column, which is the
 * feedback, and leaving it marked would arm the opposite arrow with what was just moved.
 */
function moveWarmUp(from, all = false) {
  const offered = warmUpOffered();
  const source = from === 'available' ? offered.filter((event) => !warmUpSelection.includes(event)) : warmUpSelection;
  const moving = all ? source : source.filter((event) => warmUpMarked.has(event));
  if (moving.length === 0) return;
  warmUpSelection =
    from === 'available'
      ? [...new Set([...warmUpSelection, ...moving])].sort()
      : warmUpSelection.filter((event) => !moving.includes(event));
  warmUpMarked = new Set();
  renderWarmUp();
  void updateAdvancedSettings();
}

function configuredBlock() {
  return pluginConfig.find((block) => block.platform === 'HomebridgeEufy');
}

function stableConfigValue(value) {
  if (Array.isArray(value)) return value.map(stableConfigValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableConfigValue(value[key])]),
  );
}

function configSignature(config) {
  return JSON.stringify(stableConfigValue(config));
}

async function updateConfig(block) {
  const nextConfig = pluginConfig.map((candidate) => (candidate.platform === 'HomebridgeEufy' ? block : candidate));
  if (!nextConfig.includes(block)) nextConfig.push(block);
  // Homebridge UI merges each block into the one it holds, so a key the block dropped is sent as undefined to clear it.
  const cleared = Object.keys(configuredBlock() ?? {}).filter((key) => !(key in block));
  const sent = { ...Object.fromEntries(cleared.map((key) => [key, undefined])), ...block };
  await homebridge.updatePluginConfig(nextConfig.map((candidate) => (candidate === block ? sent : candidate)));
  pluginConfig = nextConfig;
  if (configSignature(nextConfig) === savedConfigSignature) homebridge.disableSaveButton();
  else homebridge.enableSaveButton();
}

dashboardView.bindPreferences(dashboardElements, configuredBlock, updateConfig, () => messages, (serial, trigger) => {
  const device = dashboardDevices.find((candidate) => candidate.serial === serial);
  if (!device) return;
  dashboardView.renderDeviceSettings(device, configuredBlock() ?? {}, messages, dashboardElements);
  openDashboardPanel(devicePanel, trigger);
});

/*
 * The setup wizard walks every device once a sign-in has a running plugin to show it: each camera live, the eufy
 * settings the plugin can change, and the HomeKit choices. A sign-in always leaves Homebridge to restart, so it
 * marks the wizard pending in this browser and the next page opened on a ready plugin starts it.
 */
let dashboardPluginState;
let wizardSteps = [];
let wizardIndex = 0;
let wizardLiveSerial;
let wizardLivePictures = 0;
/** The wizard's last step, after every device: which encoder codes live video, and a test of those turned down. */
const ENCODER_STEP = {};
let wizardEncoderReport;
const wizardElements = {
  deviceSettingsTitle: wizardTitle,
  deviceSettingsEyebrow: wizardEyebrow,
  deviceSettingsControls: wizardControls,
};
/** The eufy settings the wizard offers, each with the label its control is named by. */
const EUFY_SETTING_LABELS = {
  motionDetection: 'wizardMotionDetection',
  nightVision: 'wizardNightVision',
  notificationStyle: 'wizardNotificationStyle',
};

/** Whether a plugin is running to stream and change settings: a degraded one still holds its devices. */
function wizardPluginUp() {
  return dashboardPluginState === 'ready' || dashboardPluginState === 'degraded';
}

function wizardPending(pending) {
  try {
    if (pending === undefined) return localStorage.getItem(setupWizard.PENDING_KEY) === 'pending';
    if (pending) localStorage.setItem(setupWizard.PENDING_KEY, 'pending');
    else localStorage.removeItem(setupWizard.PENDING_KEY);
  } catch {
    return false;
  }
  return pending;
}

async function openSetupWizard(trigger) {
  const devices = setupWizard.steps(dashboardDevices);
  wizardSteps = devices.length > 0 ? [...devices, ENCODER_STEP] : [];
  wizardIndex = 0;
  openDashboardPanel(wizardPanel, trigger);
  await renderWizardStep();
}

function stopWizardLive() {
  if (!wizardLiveSerial) return;
  wizardLiveSerial = undefined;
  wizardLivePictures = 0;
  wizardLivePlay.hidden = false;
  wizardLiveStop.hidden = true;
  wizardLiveSpinner.hidden = true;
  wizardLiveStatus.textContent = '';
  void requestWithinDeadline('/device/live/stop', {}, 12000).catch(() => undefined);
}

/**
 * Shows a camera's box with its last picture behind the play button, so the step costs nothing until asked.
 * A camera with no picture yet shows the empty box.
 */
async function showWizardCamera(serial) {
  wizardLive.hidden = false;
  wizardLiveImage.hidden = true;
  wizardLivePlay.hidden = false;
  wizardLiveStatus.textContent = '';
  let answer;
  try {
    answer = await requestWithinDeadline('/device/image', { serial }, 12000);
  } catch {
    answer = undefined;
  }
  if (!answer?.image || wizardSteps[wizardIndex]?.serial !== serial || wizardLiveSerial) return;
  wizardLiveImage.src = `data:image/jpeg;base64,${answer.image}`;
  wizardLiveImage.hidden = false;
}

function startWizardLive(serial) {
  stopWizardLive();
  wizardLiveSerial = serial;
  wizardLivePlay.hidden = true;
  wizardLiveSpinner.hidden = false;
  wizardLiveStatus.textContent = messages.wizardLiveStarting ?? '';
  void requestWithinDeadline('/device/live/start', { serial }, 12000).catch(() => endWizardLive(serial));
}

function endWizardLive(serial) {
  if (serial !== wizardLiveSerial) return;
  const watched = wizardLivePictures > 0;
  wizardLiveSerial = undefined;
  wizardLivePictures = 0;
  wizardLiveStatus.textContent = watched ? '' : (messages.wizardLiveFailed ?? '');
  wizardLivePlay.hidden = false;
  wizardLiveStop.hidden = true;
  wizardLiveSpinner.hidden = true;
}

homebridge.addEventListener('device-live', (event) => {
  if (!event.data || event.data.serial !== wizardLiveSerial) return;
  wizardLivePictures += 1;
  // The stop is offered once there is video to stop; until then the spinner says it is on its way.
  wizardLiveSpinner.hidden = true;
  wizardLiveStop.hidden = false;
  wizardLiveImage.src = `data:image/jpeg;base64,${event.data.image}`;
  wizardLiveImage.hidden = false;
  wizardLiveStatus.textContent = '';
});
homebridge.addEventListener('device-live-end', (event) => endWizardLive(event.data?.serial));

/** One control per eufy setting the device states and can change, named and valued the way the camera describes it. */
function eufySettingControl(setting) {
  const label = messages[EUFY_SETTING_LABELS[setting.setting]] ?? setting.setting;
  const wrapper = document.createElement('label');
  wrapper.className = typeof setting.value === 'boolean' ? 'toggle' : 'wizard-setting';
  wrapper.dataset.setting = '';
  const name = document.createElement('span');
  name.className = 'setting-label';
  name.textContent = label;
  let control;
  if (typeof setting.value === 'boolean') {
    control = document.createElement('input');
    control.type = 'checkbox';
    control.checked = setting.value;
    wrapper.append(control, name);
  } else {
    control = document.createElement('select');
    for (const [value, text] of Object.entries(setting.labels ?? { [setting.value]: String(setting.value) })) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      option.selected = Number(value) === setting.value;
      control.append(option);
    }
    wrapper.append(name, control);
  }
  control.dataset.eufySetting = setting.setting;
  return wrapper;
}

async function renderWizardSettings(serial) {
  let answer;
  try {
    answer = await requestWithinDeadline('/device/settings', { serial }, 12000);
  } catch {
    answer = undefined;
  }
  if (wizardSteps[wizardIndex]?.serial !== serial) return;
  const writable = (answer?.settings ?? []).filter((setting) => setting.writable);
  if (writable.length === 0) return;
  const status = document.createElement('p');
  status.className = 'preference-note';
  status.setAttribute('role', 'status');
  status.dataset.wizardSettingsStatus = '';
  wizardSettings.replaceChildren(...writable.map(eufySettingControl), status);
  wizardEufy.hidden = false;
}

/** One device on the map: a button that opens its step, marked as the current one where it is. */
function wizardMapEntry(device, current) {
  const entry = document.createElement('button');
  entry.type = 'button';
  entry.className = 'wizard-map-device';
  entry.textContent = device.name;
  entry.dataset.serial = device.serial;
  if (device.serial === current) entry.setAttribute('aria-current', 'step');
  return entry;
}

/**
 * Draws the household: each HomeBase with the devices that hang off it, then the cameras that stand alone. A base
 * is a step too where it has HomeKit choices, so its name opens it like any other device.
 */
function renderWizardMap(current) {
  const { bases, standalone } = setupWizard.topology(
    wizardSteps.filter((step) => step !== ENCODER_STEP),
    dashboardDevices,
  );
  const group = (title, members, base) => {
    const section = document.createElement('div');
    section.className = 'wizard-map-group';
    const heading = base && wizardSteps.includes(base) ? wizardMapEntry(base, current) : document.createElement('p');
    heading.classList?.add('wizard-map-base');
    heading.textContent = title;
    const list = document.createElement('div');
    list.className = 'wizard-map-members';
    list.append(...members.map((device) => wizardMapEntry(device, current)));
    section.append(heading, list);
    return section;
  };
  wizardMap.replaceChildren(
    ...bases.map(({ base, members }) => group(base?.name ?? messages.wizardMapBase ?? '', members, base)),
    ...(standalone.length > 0 ? [group(messages.wizardMapStandalone ?? '', standalone)] : []),
  );
}

wizardSettings.addEventListener('change', async (event) => {
  const control = event.target;
  const setting = control?.dataset?.eufySetting;
  const device = wizardSteps[wizardIndex];
  if (!setting || !device) return;
  const value = control.type === 'checkbox' ? control.checked : Number(control.value);
  const status = wizardSettings.querySelector('[data-wizard-settings-status]');
  control.disabled = true;
  status.textContent = messages.wizardSettingSending ?? '';
  try {
    const answer = await requestWithinDeadline('/device/settings/write', { serial: device.serial, setting, value }, 30000);
    // A write that reached the camera is not yet a camera that changed, so the step says sent rather than done.
    status.textContent = answer?.ok ? (messages.wizardSettingSent ?? '') : (messages.wizardSettingFailed ?? '');
  } catch {
    status.textContent = messages.wizardSettingFailed ?? '';
  } finally {
    control.disabled = false;
  }
});

/** One encoder outcome in plain words: it works, the sizes it coded against what fits, or what went wrong. */
function encoderOutcome(outcome) {
  if (outcome === 'qualified') return messages.wizardEncoderWorks ?? '';
  if (Array.isArray(outcome)) {
    return (messages.wizardEncoderBytes ?? '')
      .replace('{coded}', String(Math.round(outcome[1] / 1000)))
      .replace('{bound}', String(Math.round(outcome[2] / 1000)));
  }
  return messages[['budget', 'encode', 'trace'].includes(outcome) ? 'wizardEncoderFailed' : 'wizardEncoderFormat'] ?? '';
}

/**
 * Draws which encoders code live video, why each hardware encoder with no working selection is turned down, the
 * last test of the ones turned down for size, and the button that runs it, which says when there is none to test.
 */
function renderWizardEncoders(report, running = false) {
  const qualification = report?.qualification ?? {};
  const outcomes = (name) => Object.values(qualification[name]);
  const used = Object.keys(qualification).filter((name) => outcomes(name).includes('qualified'));
  const line = (text) => {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    return paragraph;
  };
  const test = document.createElement('button');
  test.type = 'button';
  test.dataset.wizardProbe = '';
  test.disabled = running || (report !== undefined && report.probeable.length === 0);
  test.textContent = messages[running ? 'wizardProbeRunning' : test.disabled ? 'wizardProbeNothing' : 'wizardProbeRun'] ?? '';
  wizardEncodersBody.replaceChildren(
    ...(report === undefined && !running
      ? [line(messages.wizardEncodersUnavailable ?? '')]
      : [
          line((messages.wizardEncodersUsed ?? '').replace('{encoders}', [...used, 'libx264'].join(', '))),
          ...Object.keys(qualification)
            .filter((name) => !used.includes(name) && outcomes(name).length > 0)
            .map((name) =>
              line(
                (messages.wizardEncoderTurnedDown ?? '')
                  .replace('{encoder}', name)
                  .replace('{reason}', encoderOutcome(outcomes(name).find(Array.isArray) ?? outcomes(name)[0])),
              ),
            ),
          ...Object.entries(report?.probe ?? {}).flatMap(([name, variants]) =>
            Object.entries(variants).map(([variant, outcome]) =>
              line(`${name} · ${messages[`wizardProbe_${variant}`] ?? variant}: ${encoderOutcome(outcome)}`),
            ),
          ),
        ]),
    test,
  );
}

wizardEncodersBody.addEventListener('click', async (event) => {
  if (event.target?.dataset?.wizardProbe === undefined) return;
  renderWizardEncoders(wizardEncoderReport, true);
  wizardEncoderReport = await requestWithinDeadline('/diagnostics/encoders/probe', undefined, 120000).catch(
    () => undefined,
  );
  if (wizardSteps[wizardIndex] === ENCODER_STEP) renderWizardEncoders(wizardEncoderReport);
});

/** A device that is not a camera shows its product picture in the box, with nothing to play. */
function showWizardArtwork(device) {
  wizardLivePlay.hidden = true;
  wizardLiveStop.hidden = true;
  wizardLiveStatus.textContent = '';
  wizardLiveImage.hidden = !device.artwork;
  if (device.artwork) wizardLiveImage.src = device.artwork;
}

async function renderWizardStep() {
  stopWizardLive();
  wizardSettings.replaceChildren();
  wizardControls.replaceChildren();
  wizardEufy.hidden = true;
  wizardEncoders.hidden = true;
  const restart = !wizardPluginUp();
  const empty = restart || wizardSteps.length === 0;
  wizardRestart.hidden = !restart;
  wizardMap.hidden = empty;
  wizardStage.hidden = empty;
  wizardHomeKit.hidden = empty;
  wizardFinish.textContent = restart ? (messages.wizardClose ?? '') : (messages.wizardFinish ?? '');
  if (empty) {
    wizardProgress.textContent = '';
    wizardTitle.textContent = messages.wizardTitle ?? '';
    wizardEyebrow.textContent = '';
    return;
  }
  const device = wizardSteps[wizardIndex];
  renderWizardMap(device.serial);
  wizardBack.disabled = wizardIndex === 0;
  wizardNext.disabled = wizardIndex === wizardSteps.length - 1;
  wizardLive.hidden = device === ENCODER_STEP;
  if (device === ENCODER_STEP) {
    wizardEncoders.hidden = false;
    wizardHomeKit.hidden = true;
    wizardProgress.textContent = '';
    wizardTitle.textContent = messages.wizardEncodersTitle ?? '';
    wizardEyebrow.textContent = '';
    wizardEncoderReport = await requestWithinDeadline('/diagnostics/encoders', undefined, 12000).catch(() => undefined);
    if (wizardSteps[wizardIndex] === ENCODER_STEP) renderWizardEncoders(wizardEncoderReport);
    return;
  }
  dashboardView.renderDeviceSettings(device, configuredBlock() ?? {}, messages, wizardElements);
  wizardHomeKit.hidden = !(device.preferences?.length > 0);
  wizardProgress.textContent = setupWizard.progress(messages.wizardProgress, wizardIndex, wizardSteps.length - 1);
  if (device.deviceClass === 'camera') void showWizardCamera(device.serial);
  else showWizardArtwork(device);
  await renderWizardSettings(device.serial);
}

function goToWizardStep(index) {
  if (index < 0 || index >= wizardSteps.length || index === wizardIndex) return;
  wizardIndex = index;
  void renderWizardStep();
}

menuWizard.addEventListener('click', () => openSetupWizard(menuWizard));
wizardClose.addEventListener('click', () => closeDashboardPanel());
wizardLiveStop.addEventListener('click', () => stopWizardLive());
wizardLivePlay.addEventListener('click', () => {
  const device = wizardSteps[wizardIndex];
  if (device) startWizardLive(device.serial);
});
wizardBack.addEventListener('click', () => goToWizardStep(wizardIndex - 1));
wizardNext.addEventListener('click', () => goToWizardStep(wizardIndex + 1));
wizardMap.addEventListener('click', (event) => {
  const serial = event.target?.closest?.('[data-serial]')?.dataset?.serial;
  goToWizardStep(wizardSteps.findIndex((device) => device.serial === serial));
});
// Closing a wizard that waits for a restart keeps it due; finishing one that walked the devices does not.
wizardFinish.addEventListener('click', () => {
  if (wizardPluginUp()) wizardPending(false);
  closeDashboardPanel();
});
window.addEventListener?.('pagehide', () => stopWizardLive());

function openAuthentication() {
  diagnosticsPanel.hidden = true;
  advancedPanel.hidden = true;
  devicePanel.hidden = true;
  wizardPanel.hidden = true;
  stopWizardLive();
  dashboard.hidden = true;
  setupContent.hidden = false;
  masthead.hidden = false;
  pageTitle.textContent = messages.pageTitle;
  accountInput.focus?.();
  recordActiveUiEventBestEffort('authentication-opened');
}

dashboardAuthenticate.addEventListener('click', openAuthentication);

// A saved session the plugin can no longer use stops every device, so nothing on the page works until the user
// signs in again. The dialog says so in front of everything else, and Escape does not dismiss it.
reauthDialog.addEventListener('cancel', (event) => event.preventDefault());
reauthAction.addEventListener('click', () => {
  reauthDialog.close?.();
  openAuthentication();
});

legacyAcknowledge.addEventListener('click', async () => {
  legacyAcknowledged = true;
  const existing = configuredBlock();
  if (existing) {
    try {
      await updateConfig({ ...existing, discardedV4Settings: legacyNames, discardedV4Acknowledged: true });
    } catch {
      legacyStatus.textContent = messages.preferenceSaveFailed ?? '';
      return;
    }
  }
  legacyNotice.hidden = true;
});

/**
 * Writes the signed-in account into the Homebridge configuration, reporting whether it was saved.
 *
 * The Save button is enabled before the attempt and never disabled by it, so a write that fails leaves the user
 * the one control that retries it.
 */
async function saveAuthenticatedConfig() {
  homebridge.enableSaveButton();
  try {
    await homebridge.updatePluginConfig([pendingConfig]);
    await homebridge.savePluginConfig();
    pluginConfig = [pendingConfig];
    savedConfigSignature = configSignature(pluginConfig);
    homebridge.enableSaveButton();
    return true;
  } catch {
    return false;
  } finally {
    passwordInput.value = '';
    pendingConfig = undefined;
  }
}

// Draws the device list from the plugin's own record of it, and shows it in place of the setup flow.
async function showDashboard() {
  const representationPreferences = Object.fromEntries(
    Object.entries(configuredBlock()?.entityPreferences ?? {})
      .filter(([, preference]) => typeof preference.represented === 'boolean')
      .map(([serial, preference]) => [serial, preference.represented]),
  );
  try {
    const snapshot = await requestWithinDeadline('/dashboard', { representationPreferences }, 12000);
    // What the warm-up setting may offer comes from the devices themselves, so it is learnt here.
    warmUpCandidates = Array.isArray(snapshot.warmUpCandidates) ? snapshot.warmUpCandidates : [];
    // Kept beside the render that drew them, so opening a tile finds the device that tile stands for.
    dashboardDevices = snapshot.devices ?? [];
    dashboardPluginState = snapshot.state;
    dashboardAttention = dashboardView.render(snapshot, configuredBlock() ?? {}, messages, dashboardElements);
    if (snapshot.state === 'authentication-required' && snapshot.devices?.length > 0 && !reauthDialog.open) {
      reauthDialog.showModal?.();
    }
    // The image pass runs beside the rendered dashboard, so its failure is dropped here rather than escaping.
    void dashboardView
      .applyDeviceImages(dashboardElements, (serial) => requestWithinDeadline('/device/image', { serial }, 12000))
      .catch(() => undefined);
  } catch {
    dashboardAttention = dashboardView.render(
      { state: 'unreachable', devices: [] },
      configuredBlock() ?? {},
      messages,
      dashboardElements,
    );
    recordActiveUiEventBestEffort('request-failed');
  }
  renderDiagnosticsEntries();
  recordActiveUiEventBestEffort('dashboard-opened');
}

/** The message each unsuccessful sign-in outcome is stated with; any other outcome is a failed sign-in. */
const AUTH_OUTCOMES = {
  blocked: 'dashboardOwnerConflictSummary',
  'plugin-running': 'authPluginRunning',
  'commit-failed': 'authCommitFailed',
  'timed-out': 'authTimedOut',
};

async function handleResult(result) {
  if (result.status === 'captcha') {
    challenge = 'captcha';
    authForm.hidden = true;
    challengeImage.src = result.image;
    challengeImage.hidden = false;
    challengeLabel.textContent = messages.captchaLabel ?? '';
    challengeForm.hidden = false;
    authStatus.textContent = result.retry ? (messages.captchaRetry ?? '') : '';
    return;
  }
  if (result.status === 'two-factor') {
    challenge = 'two-factor';
    authForm.hidden = true;
    challengeImage.hidden = true;
    challengeLabel.textContent = messages.twoFactorLabel ?? '';
    challengeForm.hidden = false;
    authStatus.textContent = messages.twoFactorSent ?? '';
    return;
  }

  challengeForm.hidden = true;
  if (result.status === 'restart-required') {
    authForm.hidden = true;
    authStatus.textContent = messages.authSuccess ?? '';
    // The devices this sign-in discovered are already recorded, so the flow ends on them rather than on a notice.
    if (await saveAuthenticatedConfig()) {
      await showDashboard();
      wizardPending(true);
      await openSetupWizard();
    } else authStatus.textContent = messages.authSaveFailed ?? '';
  } else {
    authForm.hidden = false;
    authStatus.textContent = messages[AUTH_OUTCOMES[result.status] ?? 'authFailed'] ?? '';
  }
}

/** A sign-in request that did not come back: the page's own deadline elapsing is said to be a timeout. */
function reportAuthRequestFailure(error) {
  authStatus.textContent = messages[error?.message === REQUEST_TIMED_OUT ? 'authTimedOut' : 'authFailed'] ?? '';
  recordActiveUiEventBestEffort('request-failed');
}

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  // A sign-in replaces the account and nothing else: every other key of the block, the child bridge included, is kept.
  const existing = pluginConfig.find((block) => block.platform === 'HomebridgeEufy') ?? {};
  pendingConfig = {
    ...existing,
    platform: 'HomebridgeEufy',
    username: accountInput.value.trim(),
    password: passwordInput.value,
    country: countryInput.value.trim().toUpperCase(),
    trustedDeviceName: trustedDeviceInput.value.trim(),
    ...(legacyNames.length > 0 ? { discardedV4Settings: legacyNames } : {}),
    ...(legacyAcknowledged ? { discardedV4Acknowledged: true } : {}),
  };
  setBusy(true);
  try {
    await handleResult(await requestWithinDeadline('/auth/start', { configuration: pendingConfig }));
  } catch (error) {
    reportAuthRequestFailure(error);
  } finally {
    setBusy(false);
  }
});

challengeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const path = challenge === 'captcha' ? '/auth/captcha' : '/auth/two-factor';
  const body = challenge === 'captcha' ? { answer: challengeAnswer.value } : { code: challengeAnswer.value };
  challengeAnswer.value = '';
  setBusy(true);
  try {
    await handleResult(await requestWithinDeadline(path, body));
  } catch (error) {
    reportAuthRequestFailure(error);
  } finally {
    setBusy(false);
  }
});

window.addEventListener('pagehide', () => {
  void requestWithinDeadline('/auth/close', undefined, 12000).catch(() => undefined);
});

if (updateRestart) {
  /**
   * Asks the older build to end so Homebridge brings up the installed one, then reloads what this page knows.
   *
   * The button is disabled for the whole attempt, because a second press would land on a process that is already
   * going away. A refusal restores it and leaves the notice standing, which is the honest outcome: the older
   * build is still the one answering.
   */
  updateRestart.addEventListener('click', async () => {
    updateRestart.disabled = true;
    updateRestart.textContent = messages.updatePendingBusy;
    try {
      await requestWithinDeadline('/update/restart', {}, 20000);
      await new Promise((resolve) => setTimeout(resolve, 6000));
      await showDashboard();
    } catch {
      updatePendingSummary.textContent = messages.updatePendingFailed;
    } finally {
      updateRestart.disabled = false;
      updateRestart.textContent = messages.updatePendingAction;
    }
  });
}

homebridge.addEventListener('ready', async () => {
  homebridge.disableSaveButton();
  shell.dataset.theme = await homebridge.userCurrentLightingMode();
  const language = await homebridge.i18nCurrentLang();
  pluginConfig = await homebridge.getPluginConfig();
  savedConfigSignature = configSignature(pluginConfig);
  await applyTranslations(language);
  try {
    renderDiagnostics(await requestWithinDeadline('/diagnostics/status', undefined, 12000));
  } catch {
    diagnosticsStatus.textContent = messages.diagnosticsFailed ?? '';
  }
  const configured = pluginConfig.find(
    (block) =>
      block.platform === 'HomebridgeEufy' && typeof block.username === 'string' && block.username.trim().length > 0,
  );
  const v5Block = configuredBlock();
  if (v5Block?.discardedV4Settings?.length) {
    legacyNames = v5Block.discardedV4Settings;
    legacyAcknowledged = v5Block.discardedV4Acknowledged === true;
  } else {
    const legacyBlock = pluginConfig.find((block) => block.platform === 'EufySecurity');
    if (legacyBlock) {
      legacyNames = legacySettingsView.names(legacyBlock);
    }
  }
  legacyNotice.hidden = legacyNames.length === 0 || legacyAcknowledged;
  legacySettings.textContent = legacyNames.join(', ');

  firstSetup.hidden = Boolean(configured);
  setupContent.hidden = !configured;
  acknowledgement.checked = false;
  continueButton.disabled = true;
  accountInput.value = configured?.username ?? '';
  passwordInput.value = configured?.password ?? '';
  countryInput.value = configured?.country ?? 'US';
  trustedDeviceInput.value = configured?.trustedDeviceName ?? 'Homebridge Eufy';
  if (configured) {
    await showDashboard();
    if (wizardPending() && wizardPluginUp()) await openSetupWizard();
  }
});
