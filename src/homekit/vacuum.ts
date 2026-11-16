import type { AnyDeviceEvent, Device, VacuumActivity } from '@mega-yfue/eufy-sdk';
import type { MatterAccessory } from 'homebridge';

import { indexDeviceEvidence, satisfiesMemberRequirements } from '../device/member-evidence.js';
import type { DeviceMemberEvidence } from '../device/member-evidence.js';
import type { CompleteDeviceSnapshot } from '../device/snapshot.js';

/** The SDK members that make a device a controllable robot vacuum: start, pause and return to the dock. */
const VACUUM_REQUIREMENTS = (['startCleaning', 'pauseCleaning', 'returnToDock'] as const).map(
  (verb) => ({ id: `vacuum_clean.${verb}.momentary-action`, kind: 'momentary-action' }) as const,
);

/** Matter `RvcOperationalState.OperationalState` for each SDK activity; `unknown` is never presented. */
const OPERATIONAL_STATE: Readonly<Record<Exclude<VacuumActivity, 'unknown'>, number>> = {
  idle: 0,
  cleaning: 1,
  paused: 2,
  error: 3,
  returning: 0x40,
  docked: 0x42,
};

/** The two Matter run modes, tagged `Idle` (0x4000) and `Cleaning` (0x4001) as the RVC device type requires. */
const RUN_MODES = [
  { label: 'Idle', mode: 0, modeTags: [{ value: 0x4000 }] },
  { label: 'Cleaning', mode: 1, modeTags: [{ value: 0x4001 }] },
];

/** Whether one device's indexed evidence admits it as a Matter robot vacuum. */
export function admitsVacuum(evidence: ReadonlyMap<string, DeviceMemberEvidence>): boolean {
  return satisfiesMemberRequirements(evidence, VACUUM_REQUIREMENTS);
}

/** The Homebridge Matter operations a vacuum representation needs, absent when the bridge has Matter off. */
export interface MatterVacuumHost {
  readonly deviceType: MatterAccessory['deviceType'];
  uuid(serial: string): string;
  register(accessory: MatterAccessory): Promise<void>;
  unregister(accessory: MatterAccessory): Promise<void>;
  update(uuid: string, cluster: string, state: Record<string, unknown>): Promise<void>;
}

/** The complete-registry and event seam the vacuum representation follows. */
export interface VacuumSource {
  currentRegistry(): { registry: ReadonlyMap<string, Device>; snapshot: CompleteDeviceSnapshot } | undefined;
  subscribeRegistry(
    listener: (view: { registry: ReadonlyMap<string, Device>; snapshot: CompleteDeviceSnapshot }) => void,
  ): () => void;
  subscribeEvents(listener: (event: AnyDeviceEvent) => void): () => void;
}

/** The one condition this representation states: vacuums exist and the bridge cannot represent them. */
interface VacuumDiagnostic {
  code: 'vacuum-matter-disabled';
  active: boolean;
  reason: 'disabled' | 'recovered';
}

/**
 * Represents every admitted robot vacuum as a Matter robotic vacuum cleaner, and returns its stop.
 *
 * A command is acknowledged by the SDK, not observed: the presented state moves only on a later activity or
 * battery observation. With no Matter host nothing is represented and the vacuums are named in one condition.
 */
export function representVacuums(
  source: VacuumSource,
  host: MatterVacuumHost | undefined,
  diagnose: (diagnostic: VacuumDiagnostic, serials: readonly string[]) => void,
  hidden: (serial: string) => boolean,
): () => void {
  const represented = new Map<string, { device: Device; accessory: MatterAccessory }>();

  const act = async (serial: string, verb: 'startCleaning' | 'pauseCleaning' | 'returnToDock' | 'resumeCleaning') => {
    const vacuum = represented.get(serial)?.device.vacuumClean?.();
    const run = vacuum?.[verb] ?? (verb === 'resumeCleaning' ? vacuum?.startCleaning : undefined);
    if (!run) throw new Error(`${verb} is unavailable`);
    await run();
  };

  const present = (serial: string): void => {
    const entry = represented.get(serial);
    const vacuum = entry && host ? entry.device.vacuumClean?.() : undefined;
    if (!entry || !host || !vacuum) return;
    const update = (cluster: string, state: Record<string, unknown>) =>
      void host.update(entry.accessory.UUID, cluster, state).catch(() => {});
    const activity = vacuum.activity;
    if (activity !== undefined && activity !== 'unknown') {
      update('rvcOperationalState', { operationalState: OPERATIONAL_STATE[activity] });
      update('rvcRunMode', { currentMode: activity === 'cleaning' || activity === 'paused' ? 1 : 0 });
    }
    if (entry.accessory.clusters?.powerSource && typeof vacuum.battery === 'number') {
      update('powerSource', { batPercentRemaining: Math.round(vacuum.battery * 2) });
    }
  };

  const reconcile = (view: { registry: ReadonlyMap<string, Device>; snapshot: CompleteDeviceSnapshot }): void => {
    const admitted = view.snapshot.devices.filter(
      (manifest) => !hidden(manifest.sn) && admitsVacuum(indexDeviceEvidence(manifest).members),
    );
    diagnose(
      { code: 'vacuum-matter-disabled', active: !host && admitted.length > 0, reason: host ? 'recovered' : 'disabled' },
      host ? [] : admitted.map((manifest) => manifest.sn),
    );
    if (!host) return;
    for (const manifest of admitted) {
      const device = view.registry.get(manifest.sn)!;
      const known = represented.get(manifest.sn);
      if (known) {
        known.device = device;
        continue;
      }
      const accessory: MatterAccessory = {
        UUID: host.uuid(manifest.sn),
        displayName: manifest.name,
        deviceType: host.deviceType,
        serialNumber: manifest.sn,
        manufacturer: 'eufy',
        model: manifest.model ?? manifest.modelName,
        context: {},
        clusters: {
          rvcRunMode: { supportedModes: RUN_MODES, currentMode: 0 },
          rvcOperationalState: {
            operationalStateList: Object.values(OPERATIONAL_STATE).map((operationalStateId) => ({
              operationalStateId,
            })),
            operationalState: OPERATIONAL_STATE.idle,
            operationalError: { errorStateId: 0 },
          },
          ...(indexDeviceEvidence(manifest).members.has('vacuum_clean.battery.read')
            ? { powerSource: { batPercentRemaining: null } }
            : {}),
        },
        handlers: {
          rvcRunMode: {
            changeToMode: ({ newMode }: { newMode: number }) =>
              act(manifest.sn, newMode === 1 ? 'startCleaning' : 'pauseCleaning'),
          },
          rvcOperationalState: {
            pause: () => act(manifest.sn, 'pauseCleaning'),
            resume: () => act(manifest.sn, 'resumeCleaning'),
            goHome: () => act(manifest.sn, 'returnToDock'),
          },
        },
      };
      represented.set(manifest.sn, { device, accessory });
      void host
        .register(accessory)
        .then(() => present(manifest.sn))
        .catch(() => {});
    }
    const kept = new Set(admitted.map((manifest) => manifest.sn));
    for (const [serial, { accessory }] of represented) {
      if (kept.has(serial)) continue;
      represented.delete(serial);
      void host.unregister(accessory).catch(() => {});
    }
  };

  const unsubscribeRegistry = source.subscribeRegistry(reconcile);
  const unsubscribeEvents = source.subscribeEvents((event) => {
    if (event.eventName === 'propertyChanged') present(event.deviceSn);
  });
  const current = source.currentRegistry();
  if (current) reconcile(current);
  return () => {
    unsubscribeRegistry();
    unsubscribeEvents();
  };
}
