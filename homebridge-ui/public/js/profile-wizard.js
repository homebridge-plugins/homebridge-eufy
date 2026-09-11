(function attachDiagnosticsWizard(global) {
  const profiles = [
    'startup-authentication',
    'device-representation',
    'control-state',
    'live-media',
    'hksv-recording',
    'dashboard-ui',
    'other',
  ];

  const deviceProfiles = ['device-representation', 'control-state', 'live-media', 'hksv-recording'];

  function start() {
    return { mode: 'tiles', profile: undefined };
  }

  function select(state, profile) {
    return { ...state, mode: deviceProfiles.includes(profile) ? 'devices' : 'frequency', profile };
  }

  function chooseDevices(state, devices) {
    return { ...state, mode: 'frequency', devices };
  }

  function reject() {
    return start();
  }

  function chooseReproductionMode(state, reproductionMode) {
    return { ...state, mode: 'match', reproductionMode };
  }

  function backFromFrequency(state) {
    return deviceProfiles.includes(state.profile) ? { ...state, mode: 'devices' } : start();
  }

  function screen(session, startingAnother) {
    if (session.partialExportAvailable && !startingAnother) return 'review';
    if (startingAnother || session.status === 'inactive' || session.status === 'expired') return 'choose';
    if (session.status === 'authorized' || session.status === 'reproducing') return 'reproduce';
    return 'status';
  }

  function backgroundActive(session) {
    return session.status === 'reproducing' && session.profile === 'dashboard-ui';
  }

  global.HomebridgeEufyDiagnosticsWizard = {
    backFromFrequency,
    backgroundActive,
    chooseDevices,
    chooseReproductionMode,
    deviceProfiles,
    profiles,
    reject,
    screen,
    select,
    start,
  };
})(window);
