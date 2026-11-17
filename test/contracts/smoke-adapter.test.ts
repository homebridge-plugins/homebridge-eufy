import { Device, type AnyDeviceEvent } from '@mega-yfue/eufy-sdk';
import { Accessory, Characteristic, HAPStatus, HapStatusError, Service, uuid } from '@homebridge/hap-nodejs';
import type { PlatformAccessory } from 'homebridge';
import { describe, expect, it, vi } from 'vitest';

import { indexDeviceEvidence } from '../../src/device/member-evidence.js';
import { SMOKE_ADAPTER, SMOKE_ADAPTER_KEY } from '../../src/homekit/adapters/smoke.js';
import { admittedHomeKitAdapters } from '../../src/homekit/representation.js';

/** A synthetic smoke alarm whose real SDK manifest admits the smoke adapter, which presents the device's own reading. */
describe('smoke capability adapter', () => {
  it('admits a smoke alarm manifest and maps the smoke bit of its alarm bitfield to SmokeDetected', async () => {
    const device = Device.fromRecord('T8931SYNTH000001', { model: 'T8931', params: { 1823: '5' } });
    device.bindActions({ channel: 0, paramIds: new Set([1823]) } as never, (() => Promise.resolve()) as never);
    const manifest = device.describe();
    const evidence = indexDeviceEvidence(manifest);
    expect(admittedHomeKitAdapters(manifest, evidence).map(([key]) => key)).toContain(SMOKE_ADAPTER_KEY);

    const diagnose = vi.fn();
    const target = new Accessory('Synthetic smoke', uuid.generate('synthetic-smoke')) as unknown as PlatformAccessory;
    const adapter = SMOKE_ADAPTER.attach({
      device,
      evidence: evidence.members,
      accessory: target,
      hap: { Service, Characteristic, HAPStatus, HapStatusError } as never,
      diagnose,
      observed: vi.fn(),
      persist: vi.fn(),
    });
    const state = target
      .getServiceById(Service.SmokeSensor, SMOKE_ADAPTER_KEY)!
      .getCharacteristic(Characteristic.SmokeDetected);
    await expect(state.handleGetRequest()).resolves.toBe(Characteristic.SmokeDetected.SMOKE_DETECTED);
    expect(diagnose).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'invalid-smoke-observation', active: false, reason: 'recovered' }),
    );

    const property = evidence.members.get('smoke.smokeDetected.read')!.property;
    adapter.event!({ eventName: 'propertyChanged', property, value: false } as unknown as AnyDeviceEvent);
    expect(state.value).toBe(Characteristic.SmokeDetected.SMOKE_NOT_DETECTED);
  });
});
