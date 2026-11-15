import { LockPushEvent, type AnyDeviceEvent, type LockActions } from '@mega-yfue/eufy-sdk';

import {
  ownService,
  type AdapterAttachmentContext,
  type AdapterDiagnostic,
  type AdapterEventTrace,
  type AttachedAdapter,
  type HomeKitAdapter,
} from '../adapter.js';
import { PersistentMemberWrites } from '../device-control.js';

export const LOCK_ADAPTER_KEY = 'lock.mechanism';

/** The announcement this adapter presents what the bolt did from, as it happens. */
export const LOCK_STATE_EVENT_ROW = 'lock.lockState.event';

/**
 * The lock's own reported state, which presents the bolt before any announcement has.
 *
 * The SDK verifies it on the lock's state param. The lock and unlock actions are what write it, which is why
 * its operation row is the target this adapter already controls.
 */
export const LOCKED_READ_ROW = 'lock.locked.read';
const LOCKED_WRITE_ROW = 'lock.locked.persistent-operation';

const LOCK_ACTION = {
  id: 'lock.lock.momentary-action',
  kind: 'momentary-action',
} as const;
const UNLOCK_ACTION = {
  id: 'lock.unlock.momentary-action',
  kind: 'momentary-action',
} as const;

/** What one announcement says the bolt did, where it says anything about the bolt at all. */
type AnnouncedLockState = 'secured' | 'unsecured' | 'jammed';

/**
 * The HomeKit meaning of each lock push code the SDK names, and only those.
 *
 * The SDK collapses the whole `LockPushEvent` range into one `lockState` event carrying the raw code, so the
 * code is the only thing the announcement says. Translating a named code into a characteristic value is this
 * plugin's own concern — the SDK states what happened, HomeKit decides how a lock is presented — and the
 * names are the evidence being read, not the numbers: `LockPushEvent` states its provenance as cross-checked
 * against the v6 app, so `MANUAL_LOCK` means the deadbolt was thrown by hand.
 *
 * `MECHANICAL_ANOMALY`, `LOCK_MECHANICAL_ANOMALY` and `DOOR_STATE_ERROR` are the jam: the lock reporting that
 * its own mechanism did not do what it was told, which HomeKit has a state for and which must never be
 * rounded to locked.
 *
 * Not verified against a physical lock: this plugin's maintainers have none. That is why every code is
 * carried by name and an unnamed one presents no state at all rather than a plausible meaning.
 */
const ANNOUNCED_LOCK_STATES: ReadonlyMap<number, AnnouncedLockState> = new Map([
  [LockPushEvent.MANUAL_LOCK, 'secured'],
  [LockPushEvent.KEYPAD_LOCK, 'secured'],
  [LockPushEvent.APP_LOCK, 'secured'],
  [LockPushEvent.AUTO_LOCK, 'secured'],
  [LockPushEvent.PW_LOCK, 'secured'],
  [LockPushEvent.FINGER_LOCK, 'secured'],
  [LockPushEvent.TEMPORARY_PW_LOCK, 'secured'],
  [LockPushEvent.MANUAL_UNLOCK, 'unsecured'],
  [LockPushEvent.AUTO_UNLOCK, 'unsecured'],
  [LockPushEvent.PW_UNLOCK, 'unsecured'],
  [LockPushEvent.FINGERPRINT_UNLOCK, 'unsecured'],
  [LockPushEvent.APP_UNLOCK, 'unsecured'],
  [LockPushEvent.TEMPORARY_PW_UNLOCK, 'unsecured'],
  [LockPushEvent.MECHANICAL_ANOMALY, 'jammed'],
  [LockPushEvent.LOCK_MECHANICAL_ANOMALY, 'jammed'],
  [LockPushEvent.DOOR_STATE_ERROR, 'jammed'],
]);

/**
 * The lock push codes this plugin has read and deliberately presents nothing for.
 *
 * A lock reports its battery, its radio, a tamper and its firmware through the same one event, and a lock that
 * has gone offline or been tampered with has not thereby become unlocked, so these leave the presented state
 * exactly as it was.
 *
 * Listed rather than inferred from the absence of a state mapping, so that the two sets together are exhaustive
 * over `LockPushEvent` and a code a later SDK adds is a code this build has not read. A contract test holds
 * that exhaustiveness, which is what makes an unlisted code a loud failure here instead of a silent decision
 * to keep showing a state nobody checked.
 */
const NON_STATE_LOCK_CODES: ReadonlySet<number> = new Set([
  LockPushEvent.LOW_POWER,
  LockPushEvent.VERY_LOW_POWER,
  LockPushEvent.MULTIPLE_ERRORS,
  LockPushEvent.LOCK_OFFLINE,
  LockPushEvent.VIOLENT_DESTRUCTION,
  LockPushEvent.DOOR_OPEN_LEFT,
  LockPushEvent.DOOR_TAMPER,
  LockPushEvent.STATUS_CHANGE,
  LockPushEvent.OTA_STATUS,
  LockPushEvent.LOCK_ONLINE,
]);

/** Every lock push code this build has read, for the contract test that holds the two sets exhaustive. */
export const CLASSIFIED_LOCK_CODES: ReadonlySet<number> = new Set([
  ...ANNOUNCED_LOCK_STATES.keys(),
  ...NON_STATE_LOCK_CODES,
]);

/** The identity-free trace one lock announcement records. */
const LOCK_STATE_TRACE = 'lock-state';

/** Lock controls whose `lock` and `unlock` the adapter checked before admitting the accessory. */
type AdmittedLockActions = LockActions & Required<Pick<LockActions, 'lock' | 'unlock'>>;

interface LockState {
  owner: symbol;
  actions: AdmittedLockActions;
  diagnose: (
    code: 'lock-operation-failed' | 'lock-reconciliation-expired',
    active: boolean,
    reason: LockDiagnostic['reason'],
  ) => void;
  writes?: PersistentMemberWrites<number>;
  /** The last state an announcement established, retained across the reconciliation that replaces a handle. */
  announced?: AnnouncedLockState;
  /** The target that same announcement implies, which a jam does not move. */
  announcedTarget?: 'secured' | 'unsecured';
}

const LOCK_STATES = new WeakMap<object, LockState>();

/** The typed SDK lock accessor consumed by HomeKit. */
export interface LockSdkDevice {
  lock?: () => LockActions | undefined;
}

/** Structured conditions emitted by the evidence-bounded lock adapter. */
export interface LockDiagnostic extends AdapterDiagnostic {
  code:
    | 'lock-capability-unavailable'
    | 'lock-operation-failed'
    | 'lock-reconciliation-expired'
    | 'unusable-lock-announcement';
  capability: 'lock';
  member: 'target' | 'state';
  active: boolean;
  reason:
    | 'missing'
    | 'malformed'
    | 'missing-evidence'
    | 'sdk-fault'
    | 'operation-failure'
    | 'capability-not-supported'
    | 'timeout'
    | 'expired'
    | 'recovered';
}

const COVERAGE = [LOCK_ACTION.id, UNLOCK_ACTION.id, LOCK_STATE_EVENT_ROW, LOCKED_READ_ROW, LOCKED_WRITE_ROW];

/**
 * Complete HomeKit policy for the evidenced lock-control boundary, one model at a time.
 *
 * The SDK's actuation covers the whole lock family, and a family is not evidence: a lock button that a wrong
 * frame leaves inert is worse on a door than no button, so a model is listed once the bolt has been seen to
 * move on it. `T8531` is confirmed. `T8506` and `T85L0` are listed to be confirmed by their owner, and come
 * off again if the bolt does not move.
 */
export const LOCK_ADAPTER = {
  key: LOCK_ADAPTER_KEY,
  role: 'primary-purpose',
  requiresProduct: { models: ['T8531', 'T8506', 'T85L0'] },
  requires: [LOCK_ACTION, UNLOCK_ACTION],
  coverage: COVERAGE,
  attach: attachLock,
} as const satisfies HomeKitAdapter;

/**
 * Attaches the lock's controls, and its physical state where the device reports or announces one.
 *
 * The controls and the state are deliberately gated apart: a lock that reports no state is still worth locking
 * from HomeKit, so the two momentary actions admit the accessory and the state evidence only decides whether a
 * state is presented beside them. The reported state seeds only an attachment nothing has announced to yet,
 * because an announcement is the newer observation and the only one that can say the bolt jammed.
 */
function attachLock(context: AdapterAttachmentContext): AttachedAdapter | undefined {
  const { accessory, hap } = context;
  const device = context.device as LockSdkDevice;
  let actions: LockActions | undefined;
  try {
    actions = device.lock?.();
  } catch {
    context.diagnose({
      code: 'lock-capability-unavailable',
      capability: 'lock',
      member: 'target',
      active: true,
      reason: 'sdk-fault',
    });
    return undefined;
  }
  if (!actions || typeof actions.lock !== 'function' || typeof actions.unlock !== 'function') {
    context.diagnose({
      code: 'lock-capability-unavailable',
      capability: 'lock',
      member: 'target',
      active: true,
      reason: 'missing',
    });
    return undefined;
  }
  context.diagnose({
    code: 'lock-capability-unavailable',
    capability: 'lock',
    member: 'target',
    active: false,
    reason: 'recovered',
  });
  context.observed('lock-capability-unavailable');

  const service = ownService(accessory, hap.Service.LockMechanism, accessory.displayName, LOCK_ADAPTER_KEY);
  const previousState = LOCK_STATES.get(service);
  const owner = Symbol('lock-owner');
  const admitted = actions as AdmittedLockActions;
  const state: LockState = previousState ?? {
    owner,
    actions: admitted,
    diagnose: () => undefined,
  };
  state.owner = owner;
  state.actions = admitted;
  LOCK_STATES.set(service, state);

  const current = service.getCharacteristic(hap.Characteristic.LockCurrentState);
  const target = service.getCharacteristic(hap.Characteristic.LockTargetState);
  const announces = context.evidence.has(LOCK_STATE_EVENT_ROW);
  const reports = context.evidence.has(LOCKED_READ_ROW);
  /**
   * The flat property name this device announces its reported state under, as its own manifest pairs it.
   *
   * A device whose manifest names no property for the read is left unfollowed rather than matched on the
   * accessor, because an accessor equal to some other capability's property name would move this bolt.
   */
  const lockedProperty = context.evidence.get(LOCKED_READ_ROW)?.property;
  const diagnoseState = (active: boolean, reason: LockDiagnostic['reason']): void => {
    context.diagnose({ code: 'unusable-lock-announcement', capability: 'lock', member: 'state', active, reason });
    if (!active) {
      context.observed('unusable-lock-announcement');
    }
  };
  if (reports && state.announced === undefined) {
    let locked: unknown;
    try {
      locked = actions.locked;
    } catch {
      locked = undefined;
    }
    if (typeof locked === 'boolean') {
      state.announced = state.announcedTarget = locked ? 'secured' : 'unsecured';
    }
  }
  if (!announces && !reports) {
    state.announced = undefined;
    state.announcedTarget = undefined;
    context.diagnose({
      code: 'lock-capability-unavailable',
      capability: 'lock',
      member: 'state',
      active: true,
      reason: 'missing-evidence',
    });
  }

  const CURRENT_STATE: Readonly<Record<AnnouncedLockState, number>> = {
    secured: hap.Characteristic.LockCurrentState.SECURED,
    unsecured: hap.Characteristic.LockCurrentState.UNSECURED,
    jammed: hap.Characteristic.LockCurrentState.JAMMED,
  };
  const currentValue = (): number =>
    state.announced === undefined ? hap.Characteristic.LockCurrentState.UNKNOWN : CURRENT_STATE[state.announced];
  const targetValue = (): number | undefined =>
    state.announcedTarget === undefined
      ? undefined
      : state.announcedTarget === 'secured'
        ? hap.Characteristic.LockTargetState.SECURED
        : hap.Characteristic.LockTargetState.UNSECURED;
  current.updateValue(currentValue());

  state.diagnose = (
    code: 'lock-operation-failed' | 'lock-reconciliation-expired',
    active: boolean,
    reason: LockDiagnostic['reason'],
  ): void => {
    context.diagnose({ code, capability: 'lock', member: 'target', active, reason });
    if (!active) {
      context.observed(code);
    }
  };
  const communicationFailure = (): InstanceType<typeof hap.HapStatusError> =>
    new hap.HapStatusError(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  state.writes ??= new PersistentMemberWrites<number>(
    hap,
    (value) => (value === hap.Characteristic.LockTargetState.SECURED ? state.actions.lock() : state.actions.unlock()),
    (condition, active, reason) =>
      state.diagnose(
        condition === 'operation' ? 'lock-operation-failed' : 'lock-reconciliation-expired',
        active,
        reason,
      ),
    (cause) => cause === 'late-completed' && target.updateValue(state.writes!.read()!),
    { holdAbandoned: true, supersedeOnly: true },
  );

  current.onGet(currentValue);
  /**
   * Answers the target from the newest thing that established one: a write still in flight, else the last
   * settled announcement.
   *
   * Unanswerable until one of those exists, which includes a jam announced before this plugin has seen either
   * — HomeKit's target is what the lock was asked for, and nothing has asked. Left failing closed rather than
   * defaulted, because a target invented here reads in the Home app as a state the user chose.
   */
  target.onGet(() => {
    const requested = state.writes!.read() ?? targetValue();
    if (requested === undefined) {
      throw communicationFailure();
    }
    return requested;
  });
  target.onSet((value) => {
    if (
      value !== hap.Characteristic.LockTargetState.SECURED &&
      value !== hap.Characteristic.LockTargetState.UNSECURED
    ) {
      throw new hap.HapStatusError(hap.HAPStatus.INVALID_VALUE_IN_REQUEST);
    }
    return state.writes!.request(value as number);
  });

  /**
   * Presents what one announcement established, pushing only what moved.
   *
   * Both characteristics are pushed because HomeKit is not told a value changed unless the accessory says so:
   * a lock that answers reads and never notifies leaves the Home app showing what it last believed, which for
   * a lock is a claim about whether the house is locked. The target follows a settled state as well as the
   * current one, or the tile stays on "Locking…" after someone locks the door with a key.
   */
  const present = (announced: AnnouncedLockState): void => {
    state.announced = announced;
    if (announced !== 'jammed') {
      state.announcedTarget = announced;
    }
    state.writes?.observe();
    const nextCurrent = currentValue();
    if (current.value !== nextCurrent) {
      current.updateValue(nextCurrent);
    }
    const nextTarget = targetValue();
    if (nextTarget !== undefined && target.value !== nextTarget) {
      target.updateValue(nextTarget);
    }
  };

  /**
   * Withdraws a state this plugin can no longer vouch for.
   *
   * Something happened to the lock inside the announced range that this build has not read, so the last state
   * is no longer a claim it can make: HomeKit is told the state is unknown rather than left showing a value
   * that may now be wrong. The target is left alone — an unreadable announcement says nothing about what the
   * lock was asked to do.
   */
  const withdraw = (reason: 'missing' | 'malformed'): void => {
    state.announced = undefined;
    if (current.value !== hap.Characteristic.LockCurrentState.UNKNOWN) {
      current.updateValue(hap.Characteristic.LockCurrentState.UNKNOWN);
    }
    diagnoseState(true, reason);
  };

  return {
    /**
     * Presents what one `lockState` announcement says about the bolt.
     *
     * `eventType` is read as `unknown` rather than as the number it is declared to be, because the SDK folds
     * the raw push body into this payload: the declared type is what the event promises, not what every
     * announcement will carry, and a lock is the wrong accessory on which to trust a shape.
     *
     * A code this build has read and deliberately presents nothing for — a battery warning, a tamper, a
     * firmware update — is not this member reporting at all, so it leaves the state alone and records only
     * its code. Anything else in the range is unread: the state is withdrawn rather than kept, because the
     * announcement was about this lock and this build cannot say what it meant.
     *
     * The SDK's property announcement of the reported state is presented the same way, recorded as `poll`: it
     * is how a lock that moved without a push, such as an auto-lock, is learned.
     */
    event(event: AnyDeviceEvent): AdapterEventTrace | undefined {
      if (event.eventName === 'propertyChanged') {
        if (lockedProperty === undefined || event.property !== lockedProperty) {
          return undefined;
        }
        if (typeof event.value !== 'boolean') {
          const observation = event.value === undefined ? 'missing' : 'malformed';
          return { event: LOCK_STATE_TRACE, observation, announcedBy: 'poll' };
        }
        present(event.value ? 'secured' : 'unsecured');
        return { event: LOCK_STATE_TRACE, observation: 'valid', announcedBy: 'poll' };
      }
      if (event.eventName !== 'lockState' || !announces) {
        return undefined;
      }
      const code: unknown = event.eventType;
      if (code === undefined) {
        withdraw('missing');
        return { event: LOCK_STATE_TRACE, observation: 'missing' };
      }
      if (typeof code === 'number' && NON_STATE_LOCK_CODES.has(code)) {
        return { event: LOCK_STATE_TRACE, observation: 'ignored', code };
      }
      const announced = typeof code === 'number' ? ANNOUNCED_LOCK_STATES.get(code) : undefined;
      if (announced === undefined) {
        withdraw('malformed');
        return { event: LOCK_STATE_TRACE, observation: 'malformed', ...(typeof code === 'number' ? { code } : {}) };
      }
      present(announced);
      diagnoseState(false, 'recovered');
      return { event: LOCK_STATE_TRACE, observation: 'valid' };
    },
    detach(): void {
      if (LOCK_STATES.get(service)?.owner !== owner) {
        return;
      }
      state.writes?.detach();
      LOCK_STATES.delete(service);
      accessory.removeService(service);
    },
  };
}
