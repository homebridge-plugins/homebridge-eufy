import { Device, type AnyDeviceEvent } from '@mega-yfue/eufy-sdk';
import { Accessory, Characteristic, HAPStatus, HapStatusError, Service, uuid } from '@homebridge/hap-nodejs';
import type { PlatformAccessory } from 'homebridge';
import { describe, expect, it, vi } from 'vitest';

import { indexDeviceEvidence } from '../../src/device/member-evidence.js';
import { LEAK_ADAPTER, LEAK_ADAPTER_KEY } from '../../src/homekit/adapters/leak.js';
import { admittedHomeKitAdapters } from '../../src/homekit/representation.js';

/** A synthetic water sensor whose real SDK manifest admits the leak adapter, which presents the device's own reading. */
describe('leak capability adapter', () => {
  it('admits a water sensor manifest and maps its water-detected reading to LeakDetected', async () => {
    const device = Device.fromRecord('T8920SYNTH000001', { model: 'T8920', params: { 1820: '1' } });
    device.bindActions({ channel: 0, paramIds: new Set([1820]) } as never, (() => Promise.resolve()) as never);
    const manifest = device.describe();
    const evidence = indexDeviceEvidence(manifest);
    expect(admittedHomeKitAdapters(manifest, evidence).map(([key]) => key)).toContain(LEAK_ADAPTER_KEY);

    const diagnose = vi.fn();
    const target = new Accessory('Synthetic leak', uuid.generate('synthetic-leak')) as unknown as PlatformAccessory;
    const adapter = LEAK_ADAPTER.attach({
      device,
      evidence: evidence.members,
      accessory: target,
      hap: { Service, Characteristic, HAPStatus, HapStatusError } as never,
      diagnose,
      observed: vi.fn(),
      persist: vi.fn(),
    });
    const state = target
      .getServiceById(Service.LeakSensor, LEAK_ADAPTER_KEY)!
      .getCharacteristic(Characteristic.LeakDetected);
    await expect(state.handleGetRequest()).resolves.toBe(Characteristic.LeakDetected.LEAK_DETECTED);
    expect(diagnose).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'invalid-leak-observation', active: false, reason: 'recovered' }),
    );

    const property = evidence.members.get('leak.leakDetected.read')!.property;
    adapter.event!({ eventName: 'propertyChanged', property, value: false } as unknown as AnyDeviceEvent);
    expect(state.value).toBe(Characteristic.LeakDetected.LEAK_NOT_DETECTED);
  });
});
