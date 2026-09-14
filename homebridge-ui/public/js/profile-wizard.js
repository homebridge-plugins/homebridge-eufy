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

  /**
   * Whether a fault of a given area could be about a given device, per area that can tell.
   *
   * A device the fault cannot happen on is not an answer to which ones are affected: offering a HomeBase for a
   * live view fault invites a report about a stream that device never had. Missing from the list means every
   * device qualifies, which is what a device missing from HomeKit needs — the ones with no representation at
   * all are exactly the subject there.
   */
  const affected = {
    'control-state': (device) => device.controllable,
    'live-media': (device) => device.representation.includes('camera.streaming'),
    'hksv-recording': (device) => device.representation.includes('camera.streaming'),
  };

  function affectable(profile, devices) {
    return devices.filter(affected[profile] ?? (() => true));
  }

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
    affectable,
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
