import type { AnyDeviceEvent, Device, DeviceManifest } from '@mega-yfue/eufy-sdk';
import type { MatterAccessory } from 'homebridge';
import { describe, expect, it, vi } from 'vitest';

import { describeHomeKitRepresentation } from '../../src/homekit/representation.js';
import { representVacuums, type MatterVacuumHost } from '../../src/homekit/vacuum.js';

const SERIAL = 'T2351P0000000000';

const manifest: DeviceManifest = {
  sn: SERIAL,
  name: 'Synthetic vacuum',
  model: 'T2351',
  modelName: 'Synthetic vacuum',
  codec: 'vacuum',
  source: 'inferred',
  bound: true,
  capabilities: ['vacuum_clean'],
  details: [
    {
      capability: 'vacuum_clean',
      accessor: 'vacuumClean',
      reads: [
        { accessor: 'activity', property: 'activity', type: 'string', writable: false },
        { accessor: 'battery', property: 'battery', type: 'number', writable: false },
      ],
      actions: ['startCleaning', 'pauseCleaning', 'returnToDock'].map((name) => ({ name, form: 'momentary' as const })),
      undescribedActions: [],
      events: ['propertyChanged'],
    },
  ],
};

function fleet() {
  const vacuum = {
    activity: 'cleaning',
    battery: 80,
    startCleaning: vi.fn(async () => {}),
    pauseCleaning: vi.fn(async () => {}),
    returnToDock: vi.fn(async () => {}),
  };
  const device = { sn: SERIAL, vacuumClean: () => vacuum } as unknown as Device;
  let emit: (event: AnyDeviceEvent) => void = () => {};
  const view = { registry: new Map([[SERIAL, device]]), snapshot: { version: 1, complete: true, devices: [manifest] } };
  const source = {
    currentRegistry: () => view as never,
    subscribeRegistry: () => () => {},
    subscribeEvents: (listener: (event: AnyDeviceEvent) => void) => ((emit = listener), () => {}),
  };
  return { vacuum, source, emit: (event: AnyDeviceEvent) => emit(event) };
}

/**
 * A robot vacuum with the SDK's start, pause and return-to-dock actions is represented as a Matter robotic vacuum
 * cleaner whose commands reach those actions and whose state follows the device's own activity and battery; on a
 * bridge without Matter nothing is registered and the vacuum is named in one condition carrying the remedy.
 */
describe('Matter robot vacuum representation', () => {
  it('registers an evidenced vacuum, routes its commands, and presents its observations', async () => {
    const { vacuum, source, emit } = fleet();
    const registered: MatterAccessory[] = [];
    const update = vi.fn(async () => {});
    const host: MatterVacuumHost = {
      deviceType: 'rvc' as never,
      uuid: (serial) => `uuid-${serial}`,
      register: async (accessory) => void registered.push(accessory),
      unregister: async () => {},
      update,
    };
    const diagnose = vi.fn();

    representVacuums(source, host, diagnose, () => false);
    await new Promise((resolve) => setImmediate(resolve));

    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({ UUID: `uuid-${SERIAL}`, deviceType: 'rvc' });
    expect(update).toHaveBeenCalledWith(`uuid-${SERIAL}`, 'rvcOperationalState', { operationalState: 1 });
    expect(update).toHaveBeenCalledWith(`uuid-${SERIAL}`, 'powerSource', { batPercentRemaining: 160 });

    await registered[0]!.handlers!.rvcOperationalState!.goHome!(undefined);
    await registered[0]!.handlers!.rvcRunMode!.changeToMode!({ newMode: 1 });
    expect(vacuum.returnToDock).toHaveBeenCalledOnce();
    expect(vacuum.startCleaning).toHaveBeenCalledOnce();

    vacuum.activity = 'docked';
    emit({ eventName: 'propertyChanged', deviceSn: SERIAL, property: 'activity' } as AnyDeviceEvent);
    expect(update).toHaveBeenCalledWith(`uuid-${SERIAL}`, 'rvcOperationalState', { operationalState: 0x42 });
    expect(update).toHaveBeenCalledWith(`uuid-${SERIAL}`, 'rvcRunMode', { currentMode: 0 });
    expect(diagnose).not.toHaveBeenCalledWith(expect.objectContaining({ active: true }), expect.anything());
    expect(describeHomeKitRepresentation(manifest)).toMatchObject({ represented: true, services: ['vacuum.matter'] });
  });

  it('states that Matter is off instead of representing a vacuum without it', () => {
    const { source } = fleet();
    const diagnose = vi.fn();

    representVacuums(source, undefined, diagnose, () => false);

    expect(diagnose).toHaveBeenCalledWith({ code: 'vacuum-matter-disabled', active: true, reason: 'disabled' }, [
      SERIAL,
    ]);
  });
});
