import { describe, expect, it } from 'vitest';

import { deviceSnapshotLabel } from '../../src/device/snapshot.js';
import type { CompleteDeviceSnapshot } from '../../src/device/snapshot.js';

const SERIAL = 'SYNTHETIC0000LBL1';
const SIBLING = 'SYNTHETIC0000LBL2';

function snapshot(devices: readonly Record<string, unknown>[]): CompleteDeviceSnapshot {
  return { version: 1, complete: true, devices: devices as never };
}

/**
 * A condition about a device HomeKit could not represent has to name that device.
 *
 * An unrepresented device has no accessory, so a diagnostic resolving names against the accessory cache
 * finds nothing and the owner is told only that one accessory is affected — which names no device to go
 * and look at. The snapshot is the one place a recognized-but-unrepresented device is still described, so
 * the label comes from there, and it carries model and codec because a fleet holds several devices under
 * one name.
 */
describe('the owner-facing label for a device in a snapshot', () => {
  it('names the device with its model and codec', () => {
    const label = deviceSnapshotLabel(
      snapshot([{ sn: SERIAL, name: 'Front Door', model: 'T8960', codec: 'keypad' }]),
      SERIAL,
    );

    expect(label, 'the name alone does not separate two devices that share it').toBe('Front Door [T8960 keypad]');
  });

  it('separates two devices that share a name by the type beside it', () => {
    const view = snapshot([
      { sn: SERIAL, name: 'Front Door', model: 'T8960', codec: 'keypad' },
      { sn: SIBLING, name: 'Front Door', model: 'T8171', codec: 'camera' },
    ]);

    expect(deviceSnapshotLabel(view, SERIAL)).toBe('Front Door [T8960 keypad]');
    expect(deviceSnapshotLabel(view, SIBLING)).toBe('Front Door [T8171 camera]');
  });

  it('falls back to the name alone where the snapshot states no model', () => {
    const label = deviceSnapshotLabel(snapshot([{ sn: SERIAL, name: 'Hallway', codec: 'sensor' }]), SERIAL);

    expect(label, 'a codec on its own still separates it').toBe('Hallway [sensor]');
  });

  it('answers undefined for a serial no snapshot carries, and for no snapshot at all', () => {
    const view = snapshot([{ sn: SERIAL, name: 'Front Door', model: 'T8960', codec: 'keypad' }]);

    expect(deviceSnapshotLabel(view, SIBLING), 'a caller must not receive another device by accident').toBeUndefined();
    expect(deviceSnapshotLabel(undefined, SERIAL), 'before a first discovery there is nothing to name').toBeUndefined();
  });
});
