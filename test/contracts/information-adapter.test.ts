import type { Device } from '@mega-yfue/eufy-sdk';
import { Accessory, Characteristic, HAPStatus, HapStatusError, Service, uuid } from '@homebridge/hap-nodejs';
import type { PlatformAccessory } from 'homebridge';
import { describe, expect, it, vi } from 'vitest';

import { INFORMATION_ADAPTER } from '../../src/homekit/adapters/information.js';

const HAP = { Service, Characteristic, HAPStatus, HapStatusError };

/** Attaches the adapter to a fresh container and answers the AccessoryInformation service it wrote. */
function attach(info: Record<string, unknown>, before?: (accessory: PlatformAccessory) => void): Service {
  const accessory = new Accessory(
    'Synthetic identity',
    uuid.generate('synthetic-identity'),
  ) as unknown as PlatformAccessory;
  before?.(accessory);
  INFORMATION_ADAPTER.attach({
    device: { info: () => info } as unknown as Device,
    evidence: new Map(),
    accessory,
    hap: HAP,
    diagnose: vi.fn(),
    observed: vi.fn(),
    persist: vi.fn(),
  });
  return accessory.getService(Service.AccessoryInformation)!;
}

/** Answers the FirmwareRevision a reported vendor version is represented as. */
function firmware(firmwareVersion: string): unknown {
  return attach({ manufacturer: 'eufy', firmwareVersion }).getCharacteristic(Characteristic.FirmwareRevision).value;
}

/** Answers which characteristics the adapter wrote, which is what distinguishes a skip from a write. */
function writes(info: Record<string, unknown>): unknown[] {
  const written: unknown[] = [];
  const service = attach(info, (target) => {
    vi.spyOn(target.getService(Service.AccessoryInformation)!, 'updateCharacteristic').mockImplementation(function (
      this: Service,
      characteristic: unknown,
    ) {
      written.push(characteristic);
      return this;
    } as Service['updateCharacteristic']);
  });
  expect(service).toBeDefined();
  return written;
}

describe('accessory identity adapter', () => {
  /**
   * A controller substitutes `0.0` for a revision string outside HAP's two-or-three-decimal-component
   * format, so every vendor version a camera reports is represented as its leading components. The
   * inputs are the shapes real device records carry: a fourth component, and a build suffix.
   */
  it('represents a vendor firmware version as a HAP revision', () => {
    expect(firmware('2.7.4')).toBe('2.7.4');
    expect(firmware('2.5')).toBe('2.5');
    expect(firmware('2.1.0.2')).toBe('2.1.0');
    expect(firmware('1.2.1.6')).toBe('1.2.1');
    expect(firmware('2.2.4.6')).toBe('2.2.4');
    expect(firmware('2.3.2.4')).toBe('2.3.2');
    expect(firmware('2.0.1.1')).toBe('2.0.1');
    expect(firmware('0.1.0gb')).toBe('0.1.0');
    expect(firmware('3.4.2.2h')).toBe('3.4.2');
  });

  /**
   * A version leading with fewer than two decimal components has no HAP representation, so none is
   * claimed and the characteristic is left at the value HAP itself declares.
   */
  it('does not write a firmware revision it cannot represent', () => {
    const written = writes({ manufacturer: 'eufy', firmwareVersion: 'rev-P1' });

    expect(written).not.toContain(Characteristic.FirmwareRevision);
    expect(written).toContain(Characteristic.Manufacturer);
  });

  /** Identity members outside the revision format are represented exactly as the SDK reports them. */
  it('represents the remaining identity members verbatim', () => {
    const service = attach({
      manufacturer: 'eufy',
      model: 'T0000',
      serialNumber: 'T8000P0000000000',
      name: 'Synthetic identity',
      hardwareVersion: 'P1',
    });

    expect(service.getCharacteristic(Characteristic.Manufacturer).value).toBe('eufy');
    expect(service.getCharacteristic(Characteristic.Model).value).toBe('T0000');
    expect(service.getCharacteristic(Characteristic.SerialNumber).value).toBe('T8000P0000000000');
    expect(service.getCharacteristic(Characteristic.Name).value).toBe('Synthetic identity');
    expect(service.getCharacteristic(Characteristic.HardwareRevision).value).toBe('P1');
  });

  /** Identity is supplemental evidence on an existing container, never a reason to build one. */
  it('declines attachment when the device reports no identity', () => {
    const accessory = new Accessory(
      'Synthetic identity',
      uuid.generate('synthetic-identity'),
    ) as unknown as PlatformAccessory;

    expect(
      INFORMATION_ADAPTER.attach({
        device: {} as unknown as Device,
        evidence: new Map(),
        accessory,
        hap: HAP,
        diagnose: vi.fn(),
        observed: vi.fn(),
        persist: vi.fn(),
      }),
    ).toBeUndefined();
  });
});
