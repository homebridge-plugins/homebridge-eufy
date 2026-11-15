import { describe, expect, it } from 'vitest';

import { parseCompleteDeviceSnapshot } from '../../src/device/snapshot.js';

function snapshotWith(detail: Record<string, unknown>): unknown {
  const device = {
    sn: 'SYNTHETIC0000MAN1',
    name: 'Front Door',
    modelName: 'Synthetic Camera',
    codec: 'camera',
    source: 'cloud',
    bound: true,
    capabilities: ['personDetection'],
    details: [{ capability: 'personDetection', reads: [], actions: [], undescribedActions: [], events: [], ...detail }],
  };
  return { version: 1, complete: true, devices: [device] };
}

/** A capability whose whole surface is inbound events states no accessor, and the snapshot still parses. */
describe('a manifest detail in a device snapshot', () => {
  it('accepts an absent accessor and rejects one that is not a string', () => {
    expect(parseCompleteDeviceSnapshot(snapshotWith({})).devices).toHaveLength(1);
    expect(parseCompleteDeviceSnapshot(snapshotWith({ accessor: 'personDetection' })).devices).toHaveLength(1);
    expect(() => parseCompleteDeviceSnapshot(snapshotWith({ accessor: 7 }))).toThrow('malformed manifest');
  });
});
