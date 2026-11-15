import { CapabilityNotSupportedError, type AnyDeviceEvent } from '@mega-yfue/eufy-sdk';

import type { AdapterAttachmentContext, AdapterEventTrace } from './adapter.js';

/**
 * How long one HomeKit-initiated SDK operation is given before HomeKit is told it failed.
 *
 * HomeKit expects a write to be answered promptly, and an SDK operation reaches a device over a session
 * that may be asleep, so the bound exists to answer HomeKit rather than to bound the device: the operation
 * itself is not cancelled, and the authoritative observation still decides what the characteristic reads
 * afterwards.
 */
export const OPERATION_DEADLINE_MS = 8_000;

/** The diagnostic code every bounded camera-control operation failure is reported under. */
export const OPERATION_FAILED_CONDITION = 'camera-control-operation-failed';

/** The diagnostic code an authoritative observation this plugin cannot read is reported under. */
export const INVALID_OBSERVATION_CONDITION = 'invalid-camera-control-observation';

const OPERATION_TIMEOUT = Symbol('camera-control-operation-timeout');

/** The identity-free trace one observed enablement change records, whichever bundle records it. */
const ENABLEMENT_EVENT_TRACE = 'camera-enabled-changed';

/** The row whose flat property name the generic enablement announcement is matched against. */
const CAMERA_ENABLED_READ_ROW = 'camera.enabled.read';

/**
 * The operation that turns a camera off and on again. The streaming bundle carries HomeKit's own camera-active
 * state to it and declares its coverage row; the controls bundle gates its switch on it without a second row,
 * which would claim one operation twice.
 */
export const CAMERA_ENABLED_WRITE = {
  id: 'camera.enabled.persistent-operation',
  kind: 'persistent-operation',
} as const;

/**
 * The trace one enablement announcement records, or nothing for an event that is not one.
 *
 * Both camera bundles answer the same two announcements and must agree on what they are and how they are
 * recorded; what each does about it differs — one ends a session watching a camera that just went off, the
 * other keeps its switch honest — so the observation is theirs to determine and only the envelope is shared.
 * The property pairing is resolved here for the same reason: it is the same join on the same row, and a copy
 * beside either bundle would drift.
 *
 * `cameraEnabledChanged` is the SDK reflecting a write this plugin issued, and is recorded as `write`. The
 * other is the SDK's generic property announcement, which is how a change this plugin did NOT make is learned
 * — the vendor app, or a physical switch — and is recorded as `poll`. That announcement names the property in
 * the device's flat namespace rather than the capability accessor this row is keyed on, and no wire id travels
 * with it, so the pairing the device's own manifest states is the only sound join. A device whose manifest
 * names no property for the read is left unfollowed rather than matched on the accessor, because an accessor
 * equal to some other capability's property name would end a session over a value that is not this camera's
 * power.
 */
export function enablementAnnouncement(
  context: Pick<AdapterAttachmentContext, 'evidence'>,
  event: AnyDeviceEvent,
  observe: () => AdapterEventTrace['observation'],
): (AdapterEventTrace & { announcedBy: 'write' | 'poll' }) | undefined {
  const announcedProperty = context.evidence.get(CAMERA_ENABLED_READ_ROW)?.property;
  const announcedBy =
    event.eventName === 'cameraEnabledChanged'
      ? 'write'
      : event.eventName === 'propertyChanged' && announcedProperty !== undefined && event.property === announcedProperty
        ? 'poll'
        : undefined;
  return announcedBy === undefined ? undefined : { event: ENABLEMENT_EVENT_TRACE, observation: observe(), announcedBy };
}

/** Operation lifetime retained across adapter replacement, so a write in flight survives reconciliation. */
export interface DeviceOperationState {
  owner: symbol;
  activeOperations: Map<string, Promise<void>>;
  blockedOperations: Set<string>;
}

/**
 * Issues one persistent HomeKit-initiated SDK operation under bounded, single-flight discipline.
 *
 * Every camera control HomeKit can write shares this, because they share the same three hazards: a device
 * that never answers, a member this device does not support at all, and a HomeKit value that must not be
 * left claiming a state the device never reached. A successful command acknowledges delivery and nothing
 * more, so the caller's `restore` re-reads the authoritative observation once the operation settles.
 *
 * A member whose operation the SDK refuses as unsupported is latched, so a camera that cannot do something
 * is asked exactly once rather than on every HomeKit write, and the refusal is reported once as well.
 */
export interface DeviceOperationIssuer {
  (capability: string, member: string, operation: () => Promise<void>, restore: () => void): Promise<void>;
}

/**
 * Builds that issuer for one attachment, bound to the operation lifetime the attachment retains and to the
 * ownership test that decides whether this attachment is still the one HomeKit is talking to.
 */
export function deviceOperationIssuer({
  context,
  state,
  owned,
  detached,
  detachRejectors,
}: {
  readonly context: Pick<AdapterAttachmentContext, 'diagnose' | 'hap'>;
  readonly state: DeviceOperationState;
  /** Whether this attachment still owns the operation state, which a replacement takes over. */
  readonly owned: () => boolean;
  readonly detached: () => boolean;
  /** Rejectors woken when the attachment detaches, so a pending write does not outlive it. */
  readonly detachRejectors: Set<(error: unknown) => void>;
}): DeviceOperationIssuer {
  const { hap } = context;
  return async (capability, member, operation, restore) => {
    const key = `${capability}.${member}`;
    if (state.blockedOperations.has(key)) {
      throw new hap.HapStatusError(hap.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE);
    }
    if (state.activeOperations.has(key)) {
      throw new hap.HapStatusError(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const operationPromise = Promise.resolve().then(operation);
    state.activeOperations.set(key, operationPromise);
    void operationPromise.then(
      () => state.activeOperations.delete(key),
      (error) => {
        state.activeOperations.delete(key);
        if (error instanceof CapabilityNotSupportedError) {
          state.blockedOperations.add(key);
        }
      },
    );
    let rejectDetached!: (error: unknown) => void;
    const detachedPromise = new Promise<never>((_, reject) => {
      rejectDetached = reject;
    });
    detachRejectors.add(rejectDetached);
    try {
      await Promise.race([
        operationPromise,
        detachedPromise,
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(OPERATION_TIMEOUT), OPERATION_DEADLINE_MS);
        }),
      ]);
      if (!detached() && owned()) {
        context.diagnose({
          code: OPERATION_FAILED_CONDITION,
          capability,
          member,
          active: false,
          reason: 'recovered',
        });
        queueMicrotask(() => {
          if (!detached() && owned()) {
            restore();
          }
        });
      }
    } catch (error) {
      const unsupported = error instanceof CapabilityNotSupportedError;
      if (unsupported) {
        state.blockedOperations.add(key);
      }
      if (!detached() && owned()) {
        context.diagnose({
          code: OPERATION_FAILED_CONDITION,
          capability,
          member,
          active: true,
          reason: unsupported
            ? 'capability-not-supported'
            : error === OPERATION_TIMEOUT
              ? 'timeout'
              : 'operation-failure',
        });
      }
      throw new hap.HapStatusError(
        unsupported ? hap.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE : hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    } finally {
      detachRejectors.delete(rejectDetached);
      if (deadline) {
        clearTimeout(deadline);
      }
    }
  };
}

type Observation<T extends 'boolean' | 'number'> = T extends 'boolean' ? boolean : number;

/**
 * Reads one authoritative SDK observation for a HomeKit characteristic, failing closed.
 *
 * A camera control answers HomeKit from the device's own reading, so a reading that is absent, of another
 * shape, or faults must make HomeKit show no response rather than borrow a plausible value from somewhere
 * else: a guessed control state is a control the user cannot trust. Each outcome is reported once under its
 * own reason, and a later readable value withdraws it.
 *
 * The expected shape is stated by the caller rather than inferred, because the SDK stores an enum member as
 * a number and a caller that accepted whatever arrived would present one member's value under another
 * member's meaning. A `valid` predicate narrows it further, to the range or set HomeKit can present.
 */
export function observationReader<T extends 'boolean' | 'number'>(
  context: Pick<AdapterAttachmentContext, 'diagnose' | 'hap'>,
  expected: T,
  code: string = INVALID_OBSERVATION_CONDITION,
): (
  capability: string,
  member: string,
  read: () => unknown,
  valid?: (value: Observation<T>) => boolean,
) => Observation<T> {
  const { hap } = context;
  return (capability, member, read, valid) => {
    let value: unknown;
    try {
      value = read();
    } catch {
      context.diagnose({
        code,
        capability,
        member,
        active: true,
        reason: 'sdk-fault',
      });
      throw new hap.HapStatusError(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    if (
      typeof value !== expected ||
      (expected === 'number' && !Number.isFinite(value)) ||
      (valid && !valid(value as Observation<T>))
    ) {
      context.diagnose({
        code,
        capability,
        member,
        active: true,
        reason: value === undefined ? 'missing' : 'malformed',
      });
      throw new hap.HapStatusError(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    context.diagnose({
      code,
      capability,
      member,
      active: false,
      reason: 'recovered',
    });
    return value as Observation<T>;
  };
}

/** How long a completed write's projection waits for the device to report before the gap is diagnosed. */
const RECONCILIATION_WINDOW_MS = 60_000;

interface WriteRequest<T> {
  value: T;
  settled: boolean;
  deadline?: ReturnType<typeof setTimeout>;
  resolve(): void;
  reject(error: unknown): void;
}

interface WriteBatch<T> {
  value: T;
  requests: WriteRequest<T>[];
  reconciled: boolean;
  abandoned: boolean;
}

/**
 * Serializes one persistent member's writes, coalescing to the newest value, and holds the requested value as
 * a bounded projection until the device reports.
 *
 * A successful command acknowledges delivery and nothing more, so the projection only answers HomeKit until
 * an observation supersedes it; one that never comes is diagnosed once the reconciliation window closes. A
 * member the SDK refuses as unsupported is latched and every later request refused the same way.
 */
export class PersistentMemberWrites<T> {
  private active?: WriteBatch<T>;
  private queued?: WriteBatch<T>;
  private reconciliation?: ReturnType<typeof setTimeout>;
  private projection?: T;
  private blockedError?: unknown;
  private detached = false;

  constructor(
    private readonly hap: AdapterAttachmentContext['hap'],
    private readonly issue: (value: T) => Promise<void>,
    private readonly diagnose: (
      condition: 'operation' | 'reconciliation',
      active: boolean,
      reason: 'operation-failure' | 'capability-not-supported' | 'timeout' | 'expired' | 'recovered',
    ) => void,
    /** Hands HomeKit back to the adapter, which decides per cause whether to re-present anything. */
    private readonly restore: (cause: 'completed' | 'late-completed' | 'failed' | 'timed-out' | 'expired') => void,
    private readonly policy: {
      /** Keep a write whose every request timed out in flight until the SDK settles it, so a late completion lands. */
      readonly holdAbandoned?: boolean;
      /**
       * An observation only supersedes the projection: it neither marks the writes in flight reconciled nor
       * clears a warning, and each request's deadline starts when its write is issued rather than requested.
       */
      readonly supersedeOnly?: boolean;
    } = {},
  ) {}

  read(): T | undefined {
    return this.projection;
  }

  request(value: T): Promise<void> {
    if (this.blockedError) {
      return Promise.reject(this.blockedError);
    }
    this.projection = value;
    return new Promise<void>((resolve, reject) => {
      const request: WriteRequest<T> = { value, settled: false, resolve, reject };
      if (!this.policy.supersedeOnly) {
        request.deadline = setTimeout(() => this.timeout(request), OPERATION_DEADLINE_MS);
      }
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

  /** Settles the window a write opened, because the device has since said what it actually did. */
  observe(): void {
    this.projection = undefined;
    if (this.reconciliation) {
      clearTimeout(this.reconciliation);
      this.reconciliation = undefined;
    }
    if (this.policy.supersedeOnly) {
      return;
    }
    if (this.active) {
      this.active.reconciled = true;
    }
    if (this.queued) {
      this.queued.reconciled = true;
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

  private communicationFailure(): unknown {
    return new this.hap.HapStatusError(this.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  private start(batch: WriteBatch<T>): void {
    if (this.detached) {
      return;
    }
    if (this.reconciliation) {
      clearTimeout(this.reconciliation);
      this.reconciliation = undefined;
    }
    this.active = batch;
    if (this.policy.supersedeOnly) {
      for (const request of batch.requests) {
        request.deadline = setTimeout(() => this.timeout(request), OPERATION_DEADLINE_MS);
      }
    }
    Promise.resolve()
      .then(() => this.issue(batch.value))
      .then(
        () => this.complete(batch),
        (error) => this.fail(batch, error),
      );
  }

  private complete(batch: WriteBatch<T>): void {
    if (this.active !== batch) {
      return;
    }
    if (batch.abandoned && this.queued?.requests.some(({ settled }) => !settled)) {
      this.active = undefined;
      this.startQueued();
      return;
    }
    for (const request of batch.requests) {
      this.settle(request, 'resolve');
    }
    if (batch.abandoned && !batch.reconciled) {
      this.projection = batch.value;
      this.restore('late-completed');
    }
    this.diagnose('operation', false, 'recovered');
    if (this.policy.supersedeOnly ? this.projection !== undefined : !batch.reconciled) {
      this.reconciliation = setTimeout(() => {
        this.reconciliation = undefined;
        this.projection = undefined;
        this.restore('expired');
        this.diagnose('reconciliation', true, 'expired');
      }, RECONCILIATION_WINDOW_MS);
    }
    this.active = undefined;
    this.restore('completed');
    this.startQueued();
  }

  private fail(batch: WriteBatch<T>, cause: unknown): void {
    if (this.active !== batch) {
      return;
    }
    const nonRetryable = cause instanceof CapabilityNotSupportedError;
    const { hap } = this;
    const error = new hap.HapStatusError(
      nonRetryable ? hap.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE : hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
    );
    for (const request of batch.requests) {
      this.settle(request, 'reject', error);
    }
    if (nonRetryable) {
      this.blockedError = error;
      for (const request of this.queued?.requests ?? []) {
        this.settle(request, 'reject', error);
      }
      this.queued = undefined;
    }
    this.projection = this.queued?.value;
    this.restore('failed');
    if (batch.abandoned && !nonRetryable) {
      this.active = undefined;
      this.startQueued();
      return;
    }
    this.diagnose('operation', true, nonRetryable ? 'capability-not-supported' : 'operation-failure');
    this.active = undefined;
    this.startQueued();
  }

  private timeout(request: WriteRequest<T>): void {
    if (request.settled) {
      return;
    }
    this.settle(request, 'reject', this.communicationFailure());
    this.diagnose('operation', true, 'timeout');
    if (this.active?.requests.every(({ settled }) => settled)) {
      this.projection = this.queued?.value;
      this.restore('timed-out');
      if (this.policy.holdAbandoned) {
        this.active.abandoned = true;
      } else {
        this.active = undefined;
        this.startQueued();
      }
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

  private settle(request: WriteRequest<T>, result: 'resolve' | 'reject', error?: unknown): void {
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
