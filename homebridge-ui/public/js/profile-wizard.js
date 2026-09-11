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

  function start() {
    return { mode: 'tiles', profile: undefined };
  }

  function select(state, profile) {
    return { ...state, mode: 'frequency', profile };
  }

  function reject() {
    return start();
  }

  function chooseReproductionMode(state, reproductionMode) {
    return { ...state, mode: 'match', reproductionMode };
  }

  function backFromFrequency() {
    return start();
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
    chooseReproductionMode,
    profiles,
    reject,
    screen,
    select,
    start,
  };
})(window);
