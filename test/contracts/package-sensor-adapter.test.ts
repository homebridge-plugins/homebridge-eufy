import type { AnyDeviceEvent } from '@mega-yfue/eufy-sdk';
import { Accessory, Characteristic, HAPStatus, HapStatusError, Service, uuid } from '@homebridge/hap-nodejs';
import type { PlatformAccessory } from 'homebridge';
import { describe, expect, it, vi } from 'vitest';

import { PACKAGE_SENSOR_ADAPTER, PACKAGE_SENSOR_ADAPTER_KEY } from '../../src/homekit/adapters/package-sensor.js';

const HAP = { Service, Characteristic, HAPStatus, HapStatusError };
const { OCCUPANCY_DETECTED, OCCUPANCY_NOT_DETECTED } = Characteristic.OccupancyDetected;

function attach(target: PlatformAccessory) {
  return PACKAGE_SENSOR_ADAPTER.attach({
    device: {} as never,
    evidence: new Map(PACKAGE_SENSOR_ADAPTER.requires.map((requirement) => [requirement.id, requirement])),
    accessory: target,
    hap: HAP,
    diagnose: vi.fn(),
    observed: vi.fn(),
    persist: vi.fn(),
  })!;
}

function occupancy(target: PlatformAccessory): unknown {
  return target
    .getServiceById(Service.OccupancySensor, PACKAGE_SENSOR_ADAPTER_KEY)!
    .getCharacteristic(Characteristic.OccupancyDetected).value;
}

function event(eventName: string): AnyDeviceEvent {
  return { eventName } as AnyDeviceEvent;
}

describe('package sensor adapter', () => {
  /** A package reads as detected from its delivery, or a stranded reminder, until it is taken. */
  it('holds a package as detected from delivery until it is taken', () => {
    const target = new Accessory(
      'Synthetic doorbell',
      uuid.generate('synthetic-package'),
    ) as unknown as PlatformAccessory;
    const adapter = attach(target);
    expect(occupancy(target)).toBe(OCCUPANCY_NOT_DETECTED);

    expect(adapter.event?.(event('packageDelivered'))).toEqual({ event: 'package-presence', observation: 'valid' });
    expect(occupancy(target)).toBe(OCCUPANCY_DETECTED);
    adapter.event?.(event('packageStranded'));
    expect(occupancy(target)).toBe(OCCUPANCY_DETECTED);
    adapter.event?.(event('packageTaken'));
    expect(occupancy(target)).toBe(OCCUPANCY_NOT_DETECTED);
    adapter.event?.(event('packageStranded'));
    expect(occupancy(target)).toBe(OCCUPANCY_DETECTED);
    expect(adapter.event?.(event('doorbellPress'))).toBeUndefined();
  });

  /** Reattaching to the same service keeps a waiting package; only the last owner removes the service. */
  it('keeps a waiting package across reattachment', () => {
    const target = new Accessory(
      'Synthetic doorbell',
      uuid.generate('synthetic-reattach'),
    ) as unknown as PlatformAccessory;
    const first = attach(target);
    first.event?.(event('packageDelivered'));
    const second = attach(target);
    expect(occupancy(target)).toBe(OCCUPANCY_DETECTED);

    first.detach?.();
    expect(target.getServiceById(Service.OccupancySensor, PACKAGE_SENSOR_ADAPTER_KEY)).toBeDefined();
    second.detach?.();
    expect(target.getServiceById(Service.OccupancySensor, PACKAGE_SENSOR_ADAPTER_KEY)).toBeUndefined();
  });
});
