import { ArmingMode, CapabilityNotSupportedError, type AnyDeviceEvent, type ArmingActions } from '@mega-yfue/eufy-sdk';
import { Accessory, Characteristic, HAPStatus, HapStatusError, Service, uuid } from '@homebridge/hap-nodejs';
import type { PlatformAccessory } from 'homebridge';
import { describe, expect, it, vi } from 'vitest';

import {
  SECURITY_SYSTEM_ADAPTER,
  SECURITY_SYSTEM_ADAPTER_KEY,
  type SecuritySystemDiagnostic,
  type SecuritySystemSdkDevice,
} from '../../src/homekit/adapters/security-system.js';

const HAP = { Service, Characteristic, HAPStatus, HapStatusError };
/**
 * The SDK's own guard-mode labels, which is where the adapter reads what a wire value means.
 *
 * Keyed by the value the `mode` read answers with, exactly as the manifest carries it. Written out here rather
 * than derived, so a change to the vendor's vocabulary fails this contract instead of passing silently.
 */
const ARMING_MODE_LABELS = {
  '0': 'away',
  '1': 'home',
  '2': 'schedule',
  '3': 'custom1',
  '4': 'custom2',
  '5': 'custom3',
  '6': 'off',
  '47': 'geo',
  '63': 'disarmed',
} as const;

const ARMING_EVIDENCE = new Map(
  SECURITY_SYSTEM_ADAPTER.requires.map((requirement) => [
    requirement.id,
    requirement.id === 'arming.mode.read' ? { ...requirement, labels: ARMING_MODE_LABELS } : requirement,
  ]),
);

function accessory(): PlatformAccessory {
  return new Accessory(
    'Synthetic security system',
    uuid.generate('synthetic-security-system'),
  ) as unknown as PlatformAccessory;
}

function armingDevice(actions: Partial<ArmingActions>): SecuritySystemSdkDevice {
  return { arming: () => actions as ArmingActions };
}

function attach(
  device: SecuritySystemSdkDevice,
  target: PlatformAccessory,
  diagnose: (diagnostic: SecuritySystemDiagnostic) => void = vi.fn(),
  armingModes?: Partial<Record<'home' | 'away' | 'night' | 'off', ArmingMode>>,
) {
  return SECURITY_SYSTEM_ADAPTER.attach({
    device: device as never,
    evidence: ARMING_EVIDENCE,
    accessory: target,
    hap: HAP,
    ...(armingModes === undefined ? {} : { armingModes }),
    diagnose,
    observed: vi.fn(),
    persist: vi.fn(),
  });
}

function deferred(): { promise: Promise<void>; resolve(): void; reject(error: Error): void } {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('security-system capability adapter', () => {
  it('maps authoritative Home, Away, and Disarmed modes and exposes only those targets', async () => {
    const target = accessory();
    const setMode = vi.fn(async () => undefined);
    const actions = { mode: 1, setMode };
    const adapter = attach(armingDevice(actions), target);
    const service = target.getServiceById(Service.SecuritySystem, SECURITY_SYSTEM_ADAPTER_KEY)!;
    const current = service.getCharacteristic(Characteristic.SecuritySystemCurrentState);
    const desired = service.getCharacteristic(Characteristic.SecuritySystemTargetState);

    expect(adapter).toBeDefined();
    await expect(current.handleGetRequest()).resolves.toBe(Characteristic.SecuritySystemCurrentState.STAY_ARM);
    await expect(desired.handleGetRequest()).resolves.toBe(Characteristic.SecuritySystemTargetState.STAY_ARM);
    expect(desired.props.validValues).toEqual([
      Characteristic.SecuritySystemTargetState.STAY_ARM,
      Characteristic.SecuritySystemTargetState.AWAY_ARM,
      Characteristic.SecuritySystemTargetState.DISARM,
    ]);

    await desired.handleSetRequest(Characteristic.SecuritySystemTargetState.AWAY_ARM);
    expect(setMode).toHaveBeenCalledExactlyOnceWith(ArmingMode.away);

    actions.mode = 0;
    await expect(current.handleGetRequest()).resolves.toBe(Characteristic.SecuritySystemCurrentState.AWAY_ARM);
    actions.mode = 63;
    await expect(current.handleGetRequest()).resolves.toBe(Characteristic.SecuritySystemCurrentState.DISARMED);
  });

  /**
   * A station reports nine modes and HomeKit names four, so the five armed postures HomeKit cannot name read
   * as night and hold `StatusFault`. Answering the read is what keeps the accessory alive: a read that errors
   * takes the whole station to "No Response", which names the bridge instead of the mode.
   */
  it.each([
    [2, 'schedule'],
    [3, 'custom 1'],
    [4, 'custom 2'],
    [5, 'custom 3'],
    [47, 'geofencing'],
  ])('reads eufy mode %i (%s) as night and faults, rather than failing the read', async (mode) => {
    const target = accessory();
    const diagnostics: SecuritySystemDiagnostic[] = [];
    const setMode = vi.fn(async () => undefined);
    const adapter = attach(armingDevice({ mode, setMode }), target, (diagnostic) => diagnostics.push(diagnostic))!;
    const service = target.getServiceById(Service.SecuritySystem, SECURITY_SYSTEM_ADAPTER_KEY)!;
    const current = service.getCharacteristic(Characteristic.SecuritySystemCurrentState);
    const desired = service.getCharacteristic(Characteristic.SecuritySystemTargetState);

    await expect(current.handleGetRequest()).resolves.toBe(Characteristic.SecuritySystemCurrentState.NIGHT_ARM);
    await expect(desired.handleGetRequest()).resolves.toBe(Characteristic.SecuritySystemTargetState.DISARM);
    expect(desired.props.validValues).not.toContain(Characteristic.SecuritySystemCurrentState.NIGHT_ARM);
    expect(service.getCharacteristic(Characteristic.StatusFault).value).toBe(Characteristic.StatusFault.GENERAL_FAULT);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unsupported-arming-mode', member: 'mode', active: true, reason: 'unsupported' }),
    );
    expect(adapter.event?.({ eventName: 'armingModeChanged' } as AnyDeviceEvent)).toMatchObject({
      event: 'arming-mode-changed',
      observation: 'malformed',
    });
  });

  it('reads a station whose alarm system is switched off as disarmed', async () => {
    const target = accessory();
    const diagnostics: SecuritySystemDiagnostic[] = [];
    attach(armingDevice({ mode: 6, setMode: vi.fn(async () => undefined) }), target, (diagnostic) =>
      diagnostics.push(diagnostic),
    );
    const service = target.getServiceById(Service.SecuritySystem, SECURITY_SYSTEM_ADAPTER_KEY)!;

    await expect(service.getCharacteristic(Characteristic.SecuritySystemCurrentState).handleGetRequest()).resolves.toBe(
      Characteristic.SecuritySystemCurrentState.DISARMED,
    );
    expect(service.getCharacteristic(Characteristic.StatusFault).value).toBe(Characteristic.StatusFault.NO_FAULT);
    expect(diagnostics).not.toContainEqual(expect.objectContaining({ code: 'unsupported-arming-mode', active: true }));
  });

  /**
   * A mode nothing can be read from answers with the last state read exactly, and disarmed where the station
   * has reported none, because HomeKit has no way to show that a state is unknown other than not answering —
   * which costs the accessory.
   */
  it('answers an unreadable mode with the last exact state, and faults until one is read', async () => {
    const target = accessory();
    const diagnostics: SecuritySystemDiagnostic[] = [];
    const setMode = vi.fn(async () => undefined);
    const actions = { mode: undefined as unknown as number, setMode };
    const adapter = attach(armingDevice(actions), target, (diagnostic) => diagnostics.push(diagnostic))!;
    const service = target.getServiceById(Service.SecuritySystem, SECURITY_SYSTEM_ADAPTER_KEY)!;
    const current = service.getCharacteristic(Characteristic.SecuritySystemCurrentState);
    const fault = service.getCharacteristic(Characteristic.StatusFault);

    await expect(current.handleGetRequest()).resolves.toBe(Characteristic.SecuritySystemCurrentState.DISARMED);
    expect(fault.value).toBe(Characteristic.StatusFault.GENERAL_FAULT);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unsupported-arming-mode', member: 'mode', active: true, reason: 'missing' }),
    );

    actions.mode = 0;
    expect(adapter.event?.({ eventName: 'armingModeChanged' } as AnyDeviceEvent)).toMatchObject({
      event: 'arming-mode-changed',
      observation: 'valid',
    });
    await expect(current.handleGetRequest()).resolves.toBe(Characteristic.SecuritySystemCurrentState.AWAY_ARM);
    expect(fault.value).toBe(Characteristic.StatusFault.NO_FAULT);

    actions.mode = 'nonsense' as unknown as number;
    await expect(current.handleGetRequest()).resolves.toBe(Characteristic.SecuritySystemCurrentState.AWAY_ARM);
    expect(fault.value).toBe(Characteristic.StatusFault.GENERAL_FAULT);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unsupported-arming-mode', member: 'mode', active: true, reason: 'malformed' }),
    );
  });

  /**
   * HomeKit names four states and a station reports nine, so a user assigns the pairing. An assignment makes the
   * mode read exactly and makes its HomeKit state writable, which is the only way night becomes a control at all.
   */
  it('reads and writes the modes a user assigned to HomeKit states', async () => {
    const target = accessory();
    const setMode = vi.fn(async () => undefined);
    const actions = { mode: 2, setMode };
    attach(armingDevice(actions), target, vi.fn(), { night: ArmingMode.schedule, off: ArmingMode.off });
    const service = target.getServiceById(Service.SecuritySystem, SECURITY_SYSTEM_ADAPTER_KEY)!;
    const current = service.getCharacteristic(Characteristic.SecuritySystemCurrentState);
    const desired = service.getCharacteristic(Characteristic.SecuritySystemTargetState);

    await expect(current.handleGetRequest()).resolves.toBe(Characteristic.SecuritySystemCurrentState.NIGHT_ARM);
    await expect(desired.handleGetRequest()).resolves.toBe(Characteristic.SecuritySystemTargetState.NIGHT_ARM);
    expect(service.getCharacteristic(Characteristic.StatusFault).value).toBe(Characteristic.StatusFault.NO_FAULT);
    expect(desired.props.validValues).toEqual([
      Characteristic.SecuritySystemTargetState.STAY_ARM,
      Characteristic.SecuritySystemTargetState.AWAY_ARM,
      Characteristic.SecuritySystemTargetState.NIGHT_ARM,
      Characteristic.SecuritySystemTargetState.DISARM,
    ]);

    await desired.handleSetRequest(Characteristic.SecuritySystemTargetState.NIGHT_ARM);
    expect(setMode).toHaveBeenCalledExactlyOnceWith(ArmingMode.schedule);

    await desired.handleSetRequest(Characteristic.SecuritySystemTargetState.DISARM);
    expect(setMode).toHaveBeenLastCalledWith(ArmingMode.off);
  });

  /** Two states may name one mode, and the first assignment in HomeKit's own order is what the station reads as. */
  it('reads a mode two HomeKit states name as the first of them', async () => {
    const target = accessory();
    attach(armingDevice({ mode: 1, setMode: vi.fn(async () => undefined) }), target, vi.fn(), {
      night: ArmingMode.home,
    });
    const service = target.getServiceById(Service.SecuritySystem, SECURITY_SYSTEM_ADAPTER_KEY)!;

    await expect(service.getCharacteristic(Characteristic.SecuritySystemCurrentState).handleGetRequest()).resolves.toBe(
      Characteristic.SecuritySystemCurrentState.STAY_ARM,
    );
  });

  /**
   * The wire values of a guard mode are the SDK's protocol facts, carried as the labels of its enumerated read.
   * Without them nothing here can say that a value means away, and guessing is what a support case cannot undo.
   */
  it('reports a fault rather than guessing when the SDK named no modes', async () => {
    const target = accessory();
    const diagnostics: SecuritySystemDiagnostic[] = [];
    SECURITY_SYSTEM_ADAPTER.attach({
      device: armingDevice({ mode: 0, setMode: vi.fn(async () => undefined) }) as never,
      evidence: new Map(SECURITY_SYSTEM_ADAPTER.requires.map((requirement) => [requirement.id, requirement])),
      accessory: target,
      hap: HAP,
      diagnose: (diagnostic) => diagnostics.push(diagnostic as SecuritySystemDiagnostic),
      observed: vi.fn(),
      persist: vi.fn(),
    } as never);
    const service = target.getServiceById(Service.SecuritySystem, SECURITY_SYSTEM_ADAPTER_KEY)!;

    await expect(service.getCharacteristic(Characteristic.SecuritySystemCurrentState).handleGetRequest()).resolves.toBe(
      Characteristic.SecuritySystemCurrentState.DISARMED,
    );
    expect(service.getCharacteristic(Characteristic.StatusFault).value).toBe(Characteristic.StatusFault.GENERAL_FAULT);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unsupported-arming-mode', member: 'mode', active: true, reason: 'missing' }),
    );
  });

  it('keeps admitted controls available while a mode reads inexactly', async () => {
    const target = accessory();
    const setMode = vi.fn(async () => undefined);
    const actions = { mode: 2, setMode };
    const adapter = attach(armingDevice(actions), target)!;
    const service = target.getServiceById(Service.SecuritySystem, SECURITY_SYSTEM_ADAPTER_KEY)!;
    const desired = service.getCharacteristic(Characteristic.SecuritySystemTargetState);

    await desired.handleSetRequest(Characteristic.SecuritySystemTargetState.DISARM);
    expect(setMode).toHaveBeenCalledExactlyOnceWith(ArmingMode.disarmed);

    actions.mode = 63;
    expect(adapter.event?.({ eventName: 'armingModeChanged' } as AnyDeviceEvent)).toMatchObject({
      event: 'arming-mode-changed',
      observation: 'valid',
    });
    await expect(service.getCharacteristic(Characteristic.SecuritySystemCurrentState).handleGetRequest()).resolves.toBe(
      Characteristic.SecuritySystemCurrentState.DISARMED,
    );
    expect(service.getCharacteristic(Characteristic.StatusFault).value).toBe(Characteristic.StatusFault.NO_FAULT);
  });

  it.each(['delayed', 'triggered'] as const)(
    'reports a %s alarm immediately and clears it only after an authoritative arming observation',
    async (phase) => {
      vi.useFakeTimers();
      const target = accessory();
      const actions = { mode: 1, setMode: vi.fn(async () => undefined) };
      const adapter = attach(armingDevice(actions), target)!;
      const service = target.getServiceById(Service.SecuritySystem, SECURITY_SYSTEM_ADAPTER_KEY)!;
      const current = service.getCharacteristic(Characteristic.SecuritySystemCurrentState);
      const alarmType = service.getCharacteristic(Characteristic.SecuritySystemAlarmType);

      expect(adapter.event?.({ eventName: 'alarm', phase } as AnyDeviceEvent)).toMatchObject({
        event: 'security-system-alarm',
        observation: 'valid',
      });
      await expect(current.handleGetRequest()).resolves.toBe(Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED);
      expect(current.value).toBe(Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED);
      expect(alarmType.value).toBe(Characteristic.SecuritySystemAlarmType.UNKNOWN);

      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await expect(current.handleGetRequest()).resolves.toBe(Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED);

      actions.mode = 0;
      adapter.event?.({ eventName: 'armingModeChanged' } as AnyDeviceEvent);
      await expect(current.handleGetRequest()).resolves.toBe(Characteristic.SecuritySystemCurrentState.AWAY_ARM);
      expect(alarmType.value).toBe(Characteristic.SecuritySystemAlarmType.NO_ALARM);
      vi.useRealTimers();
    },
  );

  it('projects only the target until a matching or conflicting authoritative observation arrives', async () => {
    const target = accessory();
    const operation = deferred();
    const actions = { mode: 1, setMode: vi.fn(() => operation.promise) };
    const adapter = attach(armingDevice(actions), target)!;
    const service = target.getServiceById(Service.SecuritySystem, SECURITY_SYSTEM_ADAPTER_KEY)!;
    const current = service.getCharacteristic(Characteristic.SecuritySystemCurrentState);
    const desired = service.getCharacteristic(Characteristic.SecuritySystemTargetState);

    const write = desired.handleSetRequest(Characteristic.SecuritySystemTargetState.AWAY_ARM);
    await vi.waitFor(() => expect(actions.setMode).toHaveBeenCalledExactlyOnceWith(ArmingMode.away));
    await expect(current.handleGetRequest()).resolves.toBe(Characteristic.SecuritySystemCurrentState.STAY_ARM);
    await expect(desired.handleGetRequest()).resolves.toBe(Characteristic.SecuritySystemTargetState.AWAY_ARM);
    operation.resolve();
    await write;

    actions.mode = 63;
    adapter.event?.({ eventName: 'armingModeChanged' } as AnyDeviceEvent);
    await expect(current.handleGetRequest()).resolves.toBe(Characteristic.SecuritySystemCurrentState.DISARMED);
    await expect(desired.handleGetRequest()).resolves.toBe(Characteristic.SecuritySystemTargetState.DISARM);

    await desired.handleSetRequest(Characteristic.SecuritySystemTargetState.AWAY_ARM);
    actions.mode = 0;
    adapter.event?.({ eventName: 'armingModeChanged' } as AnyDeviceEvent);
    await expect(current.handleGetRequest()).resolves.toBe(Characteristic.SecuritySystemCurrentState.AWAY_ARM);
    await expect(desired.handleGetRequest()).resolves.toBe(Characteristic.SecuritySystemTargetState.AWAY_ARM);
  });

  it('maps operation failures and blocks a typed absent operation until capability withdrawal', async () => {
    const failedTarget = accessory();
    const failure = vi.fn(async () => {
      throw new Error('synthetic operation failure');
    });
    attach(armingDevice({ mode: 1, setMode: failure }), failedTarget);
    const failedDesired = failedTarget
      .getServiceById(Service.SecuritySystem, SECURITY_SYSTEM_ADAPTER_KEY)!
      .getCharacteristic(Characteristic.SecuritySystemTargetState);

    await expect(failedDesired.handleSetRequest(Characteristic.SecuritySystemTargetState.AWAY_ARM)).rejects.toBe(
      HAPStatus.SERVICE_COMMUNICATION_FAILURE,
    );

    const target = accessory();
    const absent = vi.fn(async () => {
      throw new CapabilityNotSupportedError('synthetic-device', 'mode');
    });
    const firstAttachment = attach(armingDevice({ mode: 1, setMode: absent }), target)!;
    const desired = target
      .getServiceById(Service.SecuritySystem, SECURITY_SYSTEM_ADAPTER_KEY)!
      .getCharacteristic(Characteristic.SecuritySystemTargetState);

    await expect(desired.handleSetRequest(Characteristic.SecuritySystemTargetState.AWAY_ARM)).rejects.toBe(
      HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE,
    );
    await expect(desired.handleSetRequest(Characteristic.SecuritySystemTargetState.DISARM)).rejects.toBe(
      HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE,
    );
    expect(absent).toHaveBeenCalledOnce();

    const replacementSet = vi.fn(async () => undefined);
    const replacement = attach(armingDevice({ mode: 1, setMode: replacementSet }), target)!;
    firstAttachment.detach?.();
    await expect(desired.handleSetRequest(Characteristic.SecuritySystemTargetState.DISARM)).rejects.toBe(
      HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE,
    );
    expect(replacementSet).not.toHaveBeenCalled();
    expect(
      target
        .getServiceById(Service.SecuritySystem, SECURITY_SYSTEM_ADAPTER_KEY)!
        .getCharacteristic(Characteristic.StatusFault).value,
    ).toBe(Characteristic.StatusFault.GENERAL_FAULT);

    replacement.detach?.();
    attach(armingDevice({ mode: 1, setMode: replacementSet }), target);
    await target
      .getServiceById(Service.SecuritySystem, SECURITY_SYSTEM_ADAPTER_KEY)!
      .getCharacteristic(Characteristic.SecuritySystemTargetState)
      .handleSetRequest(Characteristic.SecuritySystemTargetState.DISARM);
    expect(replacementSet).toHaveBeenCalledOnce();
  });

  it('uses one eight-second attempt and faults an acknowledgement unreconciled after 60 seconds', async () => {
    vi.useFakeTimers();
    const timedOutTarget = accessory();
    const timedOutOperation = vi.fn(() => new Promise<void>(() => undefined));
    attach(armingDevice({ mode: 1, setMode: timedOutOperation }), timedOutTarget);
    const timedOutDesired = timedOutTarget
      .getServiceById(Service.SecuritySystem, SECURITY_SYSTEM_ADAPTER_KEY)!
      .getCharacteristic(Characteristic.SecuritySystemTargetState);
    const timedOutWrite = expect(
      timedOutDesired.handleSetRequest(Characteristic.SecuritySystemTargetState.AWAY_ARM),
    ).rejects.toBe(HAPStatus.SERVICE_COMMUNICATION_FAILURE);

    await vi.advanceTimersByTimeAsync(7_999);
    expect(timedOutOperation).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await timedOutWrite;
    expect(timedOutOperation).toHaveBeenCalledOnce();

    const target = accessory();
    const diagnostics: SecuritySystemDiagnostic[] = [];
    attach(armingDevice({ mode: 1, setMode: vi.fn(async () => undefined) }), target, (diagnostic) =>
      diagnostics.push(diagnostic),
    );
    const service = target.getServiceById(Service.SecuritySystem, SECURITY_SYSTEM_ADAPTER_KEY)!;
    await service
      .getCharacteristic(Characteristic.SecuritySystemTargetState)
      .handleSetRequest(Characteristic.SecuritySystemTargetState.AWAY_ARM);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(diagnostics.some(({ code, active }) => code === 'arming-reconciliation-expired' && active)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'arming-reconciliation-expired', member: 'mode', active: true }),
    );
    expect(service.getCharacteristic(Characteristic.StatusFault).value).toBe(Characteristic.StatusFault.GENERAL_FAULT);
    vi.useRealTimers();
  });

  it('serializes arming controls and coalesces queued requests to the newest target', async () => {
    const target = accessory();
    const operations = [deferred(), deferred()];
    const setMode = vi
      .fn<(mode: ArmingMode) => Promise<void>>()
      .mockImplementationOnce(() => operations[0]!.promise)
      .mockImplementationOnce(() => operations[1]!.promise);
    attach(armingDevice({ mode: 1, setMode }), target);
    const desired = target
      .getServiceById(Service.SecuritySystem, SECURITY_SYSTEM_ADAPTER_KEY)!
      .getCharacteristic(Characteristic.SecuritySystemTargetState);

    const first = desired.handleSetRequest(Characteristic.SecuritySystemTargetState.AWAY_ARM);
    const superseded = desired.handleSetRequest(Characteristic.SecuritySystemTargetState.DISARM);
    const newest = desired.handleSetRequest(Characteristic.SecuritySystemTargetState.STAY_ARM);
    await vi.waitFor(() => expect(setMode).toHaveBeenCalledTimes(1));

    operations[0]!.resolve();
    await first;
    await vi.waitFor(() => expect(setMode).toHaveBeenCalledTimes(2));
    expect(setMode.mock.calls).toEqual([[ArmingMode.away], [ArmingMode.home]]);

    operations[1]!.resolve();
    await expect(Promise.all([superseded, newest])).resolves.toEqual([undefined, undefined]);
  });

  it('does not overlap a queued control with a timed-out SDK operation', async () => {
    vi.useFakeTimers();
    const target = accessory();
    const operations = [deferred(), deferred()];
    const setMode = vi
      .fn<(mode: ArmingMode) => Promise<void>>()
      .mockImplementationOnce(() => operations[0]!.promise)
      .mockImplementationOnce(() => operations[1]!.promise);
    attach(armingDevice({ mode: 1, setMode }), target);
    const desired = target
      .getServiceById(Service.SecuritySystem, SECURITY_SYSTEM_ADAPTER_KEY)!
      .getCharacteristic(Characteristic.SecuritySystemTargetState);

    const first = desired.handleSetRequest(Characteristic.SecuritySystemTargetState.AWAY_ARM);
    const firstFailure = expect(first).rejects.toBe(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    await vi.advanceTimersByTimeAsync(1_000);
    const queued = desired.handleSetRequest(Characteristic.SecuritySystemTargetState.DISARM);
    await vi.advanceTimersByTimeAsync(7_000);
    await firstFailure;
    expect(setMode).toHaveBeenCalledExactlyOnceWith(ArmingMode.away);

    operations[0]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(setMode.mock.calls).toEqual([[ArmingMode.away], [ArmingMode.disarmed]]);
    operations[1]!.resolve();
    await queued;
    vi.useRealTimers();
  });

  it('keeps an in-flight control attached while a complete observation replaces the adapter handle', async () => {
    const target = accessory();
    const operation = deferred();
    const firstAttachment = attach(armingDevice({ mode: 1, setMode: vi.fn(() => operation.promise) }), target)!;
    const desired = target
      .getServiceById(Service.SecuritySystem, SECURITY_SYSTEM_ADAPTER_KEY)!
      .getCharacteristic(Characteristic.SecuritySystemTargetState);
    const write = desired.handleSetRequest(Characteristic.SecuritySystemTargetState.AWAY_ARM);

    attach(armingDevice({ mode: 63, setMode: vi.fn(async () => undefined) }), target);
    firstAttachment.detach?.();
    operation.resolve();

    await expect(write).resolves.toBeUndefined();
    await expect(desired.handleGetRequest()).resolves.toBe(Characteristic.SecuritySystemTargetState.DISARM);
  });

  it('does not restore a queued projection reconciled by a later observation', async () => {
    const target = accessory();
    const operations = [deferred(), deferred()];
    const actions = {
      mode: 1,
      setMode: vi
        .fn<(mode: ArmingMode) => Promise<void>>()
        .mockImplementationOnce(() => operations[0]!.promise)
        .mockImplementationOnce(() => operations[1]!.promise),
    };
    const adapter = attach(armingDevice(actions), target)!;
    const desired = target
      .getServiceById(Service.SecuritySystem, SECURITY_SYSTEM_ADAPTER_KEY)!
      .getCharacteristic(Characteristic.SecuritySystemTargetState);
    const first = desired.handleSetRequest(Characteristic.SecuritySystemTargetState.AWAY_ARM);
    const queued = desired.handleSetRequest(Characteristic.SecuritySystemTargetState.DISARM);

    actions.mode = 1;
    adapter.event?.({ eventName: 'armingModeChanged' } as AnyDeviceEvent);
    operations[0]!.resolve();
    await first;
    await vi.waitFor(() => expect(actions.setMode).toHaveBeenCalledTimes(2));
    operations[1]!.resolve();
    await queued;

    await expect(desired.handleGetRequest()).resolves.toBe(Characteristic.SecuritySystemTargetState.STAY_ARM);
  });

  it('reports an arming capability whose typed operation is absent as unavailable', () => {
    const target = accessory();
    const diagnose = vi.fn();

    expect(attach(armingDevice({}), target, diagnose)).toBeUndefined();

    expect(diagnose).toHaveBeenCalledWith({
      code: 'arming-capability-unavailable',
      capability: 'arming',
      member: 'mode',
      active: true,
      reason: 'missing',
    });
  });

  it('reports an arming write the station refused as a failed operation', async () => {
    const target = accessory();
    const diagnose = vi.fn();
    const setMode = vi.fn(async () => {
      throw new Error('synthetic arming write fault');
    });
    attach(armingDevice({ mode: 1, setMode }), target, diagnose);
    const desired = target
      .getService(Service.SecuritySystem)!
      .getCharacteristic(Characteristic.SecuritySystemTargetState);

    await expect(desired.handleSetRequest(Characteristic.SecuritySystemTargetState.AWAY_ARM)).rejects.toBe(
      HAPStatus.SERVICE_COMMUNICATION_FAILURE,
    );

    expect(setMode).toHaveBeenCalledOnce();
    expect(diagnose).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'arming-operation-failed', capability: 'arming', active: true }),
    );
  });
});
