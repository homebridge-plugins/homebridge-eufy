import { ArmingMode, CapabilityNotSupportedError, type ArmingActions } from '@mega-yfue/eufy-sdk';

/**
 * What each HomeKit security state means where the user assigned nothing.
 *
 * `night` is absent: no vendor mode is a night posture, so HomeKit offers the state only once a user says what
 * it stands for on that station.
 */
const DEFAULT_ARMING_MODES: Readonly<Partial<Record<ArmingSlot, ArmingMode>>> = {
  home: ArmingMode.home,
  away: ArmingMode.away,
  off: ArmingMode.disarmed,
};

/**
 * The HomeKit states a station's guard mode is read against, in the order a mode is looked up in.
 *
 * Two states may name one mode — HomeKit's night standing for the same posture as home, say — so the order
 * decides which one a station reporting that mode reads as, and the first assignment wins.
 */
const SLOT_ORDER = ['home', 'away', 'night', 'off'] as const;

/** One of the four states HomeKit's security system names. */
type ArmingSlot = (typeof SLOT_ORDER)[number];

import type {
  AdapterAttachmentContext,
  AdapterDiagnostic,
  AdapterEventTrace,
  AttachedAdapter,
  HomeKitAdapter,
} from '../adapter.js';

export const SECURITY_SYSTEM_ADAPTER_KEY = 'arming.security-system';

interface SecuritySystemState {
  owner: symbol;
  arming: ArmingActions;
  alarmTriggered: boolean;
  unsupportedFault: boolean;
  operationFault: boolean;
  reconciliationFault: boolean;
  /** The last state read exactly, which is what a mode nothing can be read from answers with. */
  lastExact?: number;
  writes?: SecurityModeWrites;
}

const SECURITY_SYSTEM_STATES = new WeakMap<object, SecuritySystemState>();

const ARMING_MODE_READ = {
  id: 'arming.mode.read',
  kind: 'read',
  type: 'enum',
  writable: true,
} as const;
const ARMING_MODE_WRITE = {
  id: 'arming.mode.persistent-operation',
  kind: 'persistent-operation',
} as const;
const ARMING_MODE_EVENT = {
  id: 'arming.armingModeChanged.event',
  kind: 'event',
} as const;
const ARMING_ALARM_EVENT = {
  id: 'arming.alarm.event',
  kind: 'event',
} as const;

const OPERATION_DEADLINE_MS = 8_000;
const RECONCILIATION_WINDOW_MS = 60_000;

interface ModeRequest {
  value: number;
  settled: boolean;
  deadline: ReturnType<typeof setTimeout>;
  resolve(): void;
  reject(error: unknown): void;
}

interface ModeBatch {
  value: number;
  requests: ModeRequest[];
  reconciled: boolean;
  abandoned: boolean;
}

/** Serializes arming writes while exposing only a bounded target projection. */
class SecurityModeWrites {
  private active?: ModeBatch;
  private queued?: ModeBatch;
  private reconciliation?: ReturnType<typeof setTimeout>;
  private projection?: number;
  private blockedError?: unknown;
  private detached = false;

  constructor(
    private readonly issue: (value: number) => Promise<void>,
    private readonly communicationFailure: () => unknown,
    private readonly operationFailure: (error: unknown) => unknown,
    private readonly isNonRetryable: (error: unknown) => boolean,
    private readonly diagnose: (
      condition: 'operation' | 'reconciliation',
      active: boolean,
      reason: 'operation-failure' | 'capability-not-supported' | 'timeout' | 'expired' | 'recovered',
    ) => void,
    private readonly restore: () => void,
  ) {}

  read(): number | undefined {
    return this.projection;
  }

  request(value: number): Promise<void> {
    if (this.blockedError) {
      return Promise.reject(this.blockedError);
    }
    this.projection = value;
    return new Promise<void>((resolve, reject) => {
      const request = {
        value,
        settled: false,
        deadline: undefined as unknown as ReturnType<typeof setTimeout>,
        resolve,
        reject,
      };
      request.deadline = setTimeout(() => this.timeout(request), OPERATION_DEADLINE_MS);
      if (!this.active) {
        this.start({ value, requests: [request], reconciled: false, abandoned: false });
      } else if (this.queued) {
        this.queued.value = value;
        this.queued.reconciled = false;
        this.queued.requests.push(request);
      } else {
        this.queued = { value, requests: [request], reconciled: false, abandoned: false };
      }
    });
  }

  observe(): void {
    if (this.active) {
      this.active.reconciled = true;
    }
    if (this.queued) {
      this.queued.reconciled = true;
    }
    this.projection = undefined;
    if (this.reconciliation) {
      clearTimeout(this.reconciliation);
      this.reconciliation = undefined;
    }
    if (!this.blockedError) {
      this.diagnose('operation', false, 'recovered');
    }
    this.diagnose('reconciliation', false, 'recovered');
  }

  detach(): void {
    this.detached = true;
    if (this.reconciliation) {
      clearTimeout(this.reconciliation);
    }
    for (const request of [...(this.active?.requests ?? []), ...(this.queued?.requests ?? [])]) {
      this.settle(request, 'reject', this.communicationFailure());
    }
    this.active = undefined;
    this.queued = undefined;
    this.projection = undefined;
    this.reconciliation = undefined;
  }

  private start(batch: ModeBatch): void {
    if (this.detached) {
      return;
    }
    if (this.reconciliation) {
      clearTimeout(this.reconciliation);
      this.reconciliation = undefined;
    }
    this.active = batch;
    Promise.resolve()
      .then(() => this.issue(batch.value))
      .then(
        () => this.complete(batch),
        (error) => this.fail(batch, error),
      );
  }

  private complete(batch: ModeBatch): void {
    if (this.active !== batch) {
      return;
    }
    if (batch.abandoned) {
      this.active = undefined;
      this.startQueued();
      return;
    }
    for (const request of batch.requests) {
      this.settle(request, 'resolve');
    }
    this.diagnose('operation', false, 'recovered');
    if (!batch.reconciled) {
      this.reconciliation = setTimeout(() => {
        this.reconciliation = undefined;
        this.projection = undefined;
        this.restore();
        this.diagnose('reconciliation', true, 'expired');
      }, RECONCILIATION_WINDOW_MS);
    }
    this.active = undefined;
    this.startQueued();
  }

  private fail(batch: ModeBatch, cause: unknown): void {
    if (this.active !== batch) {
      return;
    }
    const error = this.operationFailure(cause);
    for (const request of batch.requests) {
      this.settle(request, 'reject', error);
    }
    const nonRetryable = this.isNonRetryable(cause);
    if (nonRetryable) {
      this.blockedError = error;
      for (const request of this.queued?.requests ?? []) {
        this.settle(request, 'reject', error);
      }
      this.queued = undefined;
    }
    this.projection = this.queued?.value;
    this.restore();
    if (batch.abandoned && !nonRetryable) {
      this.active = undefined;
      this.startQueued();
      return;
    }
    this.diagnose('operation', true, nonRetryable ? 'capability-not-supported' : 'operation-failure');
    this.active = undefined;
    this.startQueued();
  }

  private timeout(request: ModeRequest): void {
    if (request.settled) {
      return;
    }
    this.settle(request, 'reject', this.communicationFailure());
    this.diagnose('operation', true, 'timeout');
    if (this.active?.requests.every(({ settled }) => settled)) {
      this.active.abandoned = true;
      this.projection = this.queued?.value;
      this.restore();
      return;
    }
    if (this.queued) {
      this.queued.requests = this.queued.requests.filter(({ settled }) => !settled);
      if (this.queued.requests.length === 0) {
        this.queued = undefined;
        this.projection = this.active?.value;
      } else {
        this.queued.value = this.queued.requests.at(-1)!.value;
      }
    }
  }

  private startQueued(): void {
    const queued = this.queued;
    this.queued = undefined;
    if (!queued) {
      return;
    }
    queued.requests = queued.requests.filter(({ settled }) => !settled);
    if (queued.requests.length > 0) {
      queued.value = queued.requests.at(-1)!.value;
      this.projection = queued.reconciled ? undefined : queued.value;
      this.start(queued);
    }
  }

  private settle(request: ModeRequest, result: 'resolve' | 'reject', error?: unknown): void {
    if (request.settled) {
      return;
    }
    request.settled = true;
    clearTimeout(request.deadline);
    if (result === 'resolve') {
      request.resolve();
    } else {
      request.reject(error);
    }
  }
}

/** The typed SDK arming accessor consumed by HomeKit. */
export interface SecuritySystemSdkDevice {
  arming?: () => ArmingActions | undefined;
}

/** Structured conditions emitted by the security-system adapter. */
export interface SecuritySystemDiagnostic extends AdapterDiagnostic {
  code:
    | 'arming-capability-unavailable'
    | 'unsupported-arming-mode'
    | 'arming-operation-failed'
    | 'arming-reconciliation-expired';
  capability: 'arming';
  member: 'mode' | 'alarm';
  active: boolean;
  reason:
    | 'missing'
    | 'malformed'
    | 'unsupported'
    | 'sdk-fault'
    | 'operation-failure'
    | 'capability-not-supported'
    | 'timeout'
    | 'expired'
    | 'recovered';
}

const COVERAGE = [ARMING_MODE_READ, ARMING_MODE_WRITE, ARMING_MODE_EVENT, ARMING_ALARM_EVENT].map(({ id }) => id);

/** Complete HomeKit policy for evidenced arming modes and alarm events. */
export const SECURITY_SYSTEM_ADAPTER = {
  key: SECURITY_SYSTEM_ADAPTER_KEY,
  role: 'primary-purpose',
  requires: [ARMING_MODE_READ, ARMING_MODE_WRITE, ARMING_MODE_EVENT, ARMING_ALARM_EVENT],
  coverage: COVERAGE,
  attach: attachSecuritySystem,
} as const satisfies HomeKitAdapter;

/**
 * Attaches authoritative arming state to one official Security System service.
 *
 * A station reports nine guard modes and HomeKit names four states. `away` and `home` are exact, `off` and
 * `disarmed` both read as disarmed because HomeKit has one unarmed state, and `schedule`, `custom1` to
 * `custom3` and `geo` read as night: they are armed postures HomeKit cannot name, and night is the one state
 * left to carry them. An approximated mode holds `StatusFault`, which is the only place a state HomeKit shows
 * inexactly says so.
 *
 * A read never fails. A characteristic whose read errors takes the whole accessory to "No Response" in
 * HomeKit, which names the bridge rather than the mode and leaves the station indistinguishable from one that
 * is unreachable — so a mode that cannot be read at all answers with the last state read exactly, disarmed
 * where there is none, and faults.
 *
 * Only an exact mode reaches the target state, whose valid values are the three modes this adapter can write.
 * Night is a state the station reports and nothing here sets, so the target keeps the last mode written or
 * read exactly, and HomeKit offers no control that would have to be refused.
 */
function attachSecuritySystem(context: AdapterAttachmentContext): AttachedAdapter | undefined {
  const { accessory, hap } = context;
  const device = context.device as SecuritySystemSdkDevice;
  let arming: ArmingActions | undefined;
  try {
    arming = device.arming?.();
  } catch {
    context.diagnose({
      code: 'arming-capability-unavailable',
      capability: 'arming',
      member: 'mode',
      active: true,
      reason: 'sdk-fault',
    });
    return undefined;
  }
  if (!arming || typeof arming.setMode !== 'function') {
    context.diagnose({
      code: 'arming-capability-unavailable',
      capability: 'arming',
      member: 'mode',
      active: true,
      reason: 'missing',
    });
    return undefined;
  }
  context.diagnose({
    code: 'arming-capability-unavailable',
    capability: 'arming',
    member: 'mode',
    active: false,
    reason: 'recovered',
  });
  context.observed('arming-capability-unavailable');

  const service =
    accessory.getServiceById(hap.Service.SecuritySystem, SECURITY_SYSTEM_ADAPTER_KEY) ??
    accessory.addService(hap.Service.SecuritySystem, accessory.displayName, SECURITY_SYSTEM_ADAPTER_KEY);
  const previousState = SECURITY_SYSTEM_STATES.get(service);
  const owner = Symbol('security-system-owner');
  const state: SecuritySystemState = previousState ?? {
    owner,
    arming,
    alarmTriggered: false,
    unsupportedFault: false,
    operationFault: false,
    reconciliationFault: false,
  };
  state.owner = owner;
  state.arming = arming;
  SECURITY_SYSTEM_STATES.set(service, state);
  const current = service.getCharacteristic(hap.Characteristic.SecuritySystemCurrentState);
  const target = service.getCharacteristic(hap.Characteristic.SecuritySystemTargetState);
  const statusFault = service.getCharacteristic(hap.Characteristic.StatusFault);
  service.addOptionalCharacteristic(hap.Characteristic.SecuritySystemAlarmType);
  const alarmType = service.getCharacteristic(hap.Characteristic.SecuritySystemAlarmType);
  const assigned: Partial<Record<ArmingSlot, ArmingMode>> = {
    ...DEFAULT_ARMING_MODES,
    ...context.armingModes,
  };
  const slotState: Record<ArmingSlot, number> = {
    home: hap.Characteristic.SecuritySystemCurrentState.STAY_ARM,
    away: hap.Characteristic.SecuritySystemCurrentState.AWAY_ARM,
    night: hap.Characteristic.SecuritySystemCurrentState.NIGHT_ARM,
    off: hap.Characteristic.SecuritySystemCurrentState.DISARMED,
  };
  const modeNames = context.evidence.get(ARMING_MODE_READ.id)?.labels;
  target.setProps({
    validValues: SLOT_ORDER.filter((slot) => assigned[slot] !== undefined).map((slot) => slotState[slot]),
  });

  const homeKitMode = (value: unknown): { state: number; exact: boolean } | undefined => {
    const name = modeNames?.[String(value)];
    if (name === undefined) {
      return undefined;
    }
    const slot = SLOT_ORDER.find((candidate) => assigned[candidate] === name);
    if (slot !== undefined) {
      return { state: slotState[slot], exact: true };
    }
    return name === ArmingMode.disarmed || name === ArmingMode.off
      ? { state: hap.Characteristic.SecuritySystemCurrentState.DISARMED, exact: true }
      : { state: hap.Characteristic.SecuritySystemCurrentState.NIGHT_ARM, exact: false };
  };
  const sdkMode = (value: unknown): ArmingMode => {
    const mode = SLOT_ORDER.filter((slot) => slotState[slot] === value).map((slot) => assigned[slot])[0];
    if (mode === undefined) {
      throw new hap.HapStatusError(hap.HAPStatus.INVALID_VALUE_IN_REQUEST);
    }
    return mode;
  };

  const updateStatusFault = (): void => {
    statusFault.updateValue(
      state.unsupportedFault || state.operationFault || state.reconciliationFault
        ? hap.Characteristic.StatusFault.GENERAL_FAULT
        : hap.Characteristic.StatusFault.NO_FAULT,
    );
  };
  const diagnoseMode = (
    active: boolean,
    reason: 'missing' | 'malformed' | 'unsupported' | 'sdk-fault' | 'recovered',
  ) => {
    state.unsupportedFault = active;
    context.diagnose({
      code: 'unsupported-arming-mode',
      capability: 'arming',
      member: 'mode',
      active,
      reason,
    });
    updateStatusFault();
    if (!active) {
      context.observed('unsupported-arming-mode');
    }
  };
  const readMode = (): { state: number; exact: boolean } => {
    let value: unknown;
    try {
      value = state.arming.mode;
    } catch {
      diagnoseMode(true, 'sdk-fault');
      return { state: state.lastExact ?? hap.Characteristic.SecuritySystemCurrentState.DISARMED, exact: false };
    }
    const mapped = homeKitMode(value);
    if (mapped === undefined) {
      diagnoseMode(true, modeNames === undefined || value === undefined ? 'missing' : 'malformed');
      return { state: state.lastExact ?? hap.Characteristic.SecuritySystemCurrentState.DISARMED, exact: false };
    }
    if (!mapped.exact) {
      diagnoseMode(true, 'unsupported');
      return mapped;
    }
    diagnoseMode(false, 'recovered');
    state.lastExact = mapped.state;
    return mapped;
  };
  const observeMode = (): AdapterEventTrace => {
    const mode = readMode();
    state.alarmTriggered = false;
    state.writes?.observe();
    current.updateValue(mode.state);
    if (mode.exact) {
      target.updateValue(mode.state);
    }
    alarmType.updateValue(hap.Characteristic.SecuritySystemAlarmType.NO_ALARM);
    return { event: 'arming-mode-changed', observation: mode.exact ? 'valid' : 'malformed' };
  };

  state.writes ??= new SecurityModeWrites(
    (value) => state.arming.setMode(sdkMode(value)),
    () => new hap.HapStatusError(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE),
    (error) =>
      new hap.HapStatusError(
        error instanceof CapabilityNotSupportedError
          ? hap.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE
          : hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      ),
    (error) => error instanceof CapabilityNotSupportedError,
    (condition, active, reason) => {
      const code = condition === 'operation' ? 'arming-operation-failed' : 'arming-reconciliation-expired';
      if (condition === 'operation') {
        state.operationFault = active;
      } else {
        state.reconciliationFault = active;
      }
      updateStatusFault();
      context.diagnose({ code, capability: 'arming', member: 'mode', active, reason });
      if (!active) {
        context.observed(code);
      }
    },
    () => {
      const mode = readMode();
      if (mode.exact) {
        target.updateValue(mode.state);
      }
    },
  );
  updateStatusFault();
  observeMode();
  current.onGet(() =>
    state.alarmTriggered ? hap.Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED : readMode().state,
  );
  target.onGet(() => {
    const mode = readMode();
    return (
      state.writes!.read() ??
      (mode.exact ? mode.state : (state.lastExact ?? hap.Characteristic.SecuritySystemTargetState.DISARM))
    );
  });
  target.onSet((value) => {
    sdkMode(value);
    target.updateValue(value);
    return state.writes!.request(value as number);
  });

  return {
    event(event): AdapterEventTrace | undefined {
      if (event.eventName === 'armingModeChanged') {
        return observeMode();
      }
      if (event.eventName !== 'alarm') {
        return undefined;
      }
      if (event.phase !== 'delayed' && event.phase !== 'triggered') {
        return { event: 'security-system-alarm', observation: event.phase === undefined ? 'missing' : 'malformed' };
      }
      state.alarmTriggered = true;
      current.updateValue(hap.Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED);
      alarmType.updateValue(hap.Characteristic.SecuritySystemAlarmType.UNKNOWN);
      return { event: 'security-system-alarm', observation: 'valid' };
    },
    detach(): void {
      if (SECURITY_SYSTEM_STATES.get(service)?.owner !== owner) {
        return;
      }
      state.writes?.detach();
      SECURITY_SYSTEM_STATES.delete(service);
      accessory.removeService(service);
    },
  };
}
