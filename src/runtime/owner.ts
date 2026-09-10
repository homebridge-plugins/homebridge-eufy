import { join } from 'node:path';

import type {
  AnyDeviceEvent,
  AvailabilityObservation,
  Device,
  DeviceManifest,
  FcmStore,
  SessionStore,
} from '@mega-yfue/eufy-sdk';

import { AccountOwnership, type AccountOwnerEvidence, type AccountReleaseResult } from '../account/ownership.js';
import { AccountSessionPersistence } from '../account/persistence.js';
import type { EufyConfig } from '../configuration.js';
import {
  armDiagnosticsAuthorization,
  reportRuntimeNotice,
  type PlatformLogger,
  type RuntimeState,
  type UnconfirmedWrite,
} from '../diagnostics.js';
import { indexDeviceEvidence } from '../device/member-evidence.js';
import { cameraEnablement } from '../device/member-trust.js';
import { parseCompleteDeviceSnapshot, type CompleteDeviceSnapshot } from '../device/snapshot.js';
import {
  RuntimeChannelServer,
  runtimeChannelEndpointForHost,
  type RuntimeChannelAuthorization,
  type RuntimeChannelDevice,
  type RuntimeChannelStatus,
} from './channel.js';
import type { SdkClient, SdkClientFactory, SdkStartResult } from './sdk-client.js';
import { RuntimeTracker, runtimeStatusFor, type RuntimeTrackerRecord, type RuntimeTrackerUpdate } from './tracker.js';

export type RuntimeLogger = Pick<PlatformLogger, 'error' | 'warn'> & Partial<Pick<PlatformLogger, 'debug' | 'info'>>;

/**
 * How long a runtime that stood down on request keeps trying to take the account session back.
 *
 * It outlasts the interactive authentication a stand-down is requested for, whose own deadline is five minutes,
 * so a flow that runs to its limit still ends with a runtime that came back.
 */
const REARM_WINDOW_MS = 15 * 60_000;

/** How long between attempts to take the account session back after standing down on request. */
const REARM_INTERVAL_MS = 15_000;

export interface RuntimeOwnership {
  acquire(
    accountScope: string,
    kind: 'runtime',
  ): Promise<
    | { state: 'owner'; lease: RuntimeLease; recovered: boolean }
    | { state: 'owner-conflict'; owner: AccountOwnerEvidence }
  >;
}

type RuntimeOwnershipResult = Awaited<ReturnType<RuntimeOwnership['acquire']>>;

export interface RuntimeLease {
  release(onReleased?: () => void): Promise<AccountReleaseResult>;
}

export interface RuntimePersistence {
  active(): Promise<RuntimeActiveAccount | null>;
}

export interface RuntimeActiveAccount {
  account: string;
  generation: string;
  configuration: { load(): EufyConfig | null };
  session: SessionStore;
  push: FcmStore;
  snapshot: {
    load(): CompleteDeviceSnapshot | null;
    save(value: CompleteDeviceSnapshot): void;
  };
}

export interface RuntimeStatusPublisher {
  start(state?: RuntimeState, update?: RuntimeTrackerUpdate): boolean;
  update(state: RuntimeState, update?: RuntimeTrackerUpdate): boolean;
  latest?(): RuntimeTrackerRecord | undefined;
  stop(): void;
}

/**
 * The live status channel this runtime serves while it owns the account session.
 *
 * Declared beside its consumer, so the runtime depends on an endpoint's lifetime rather than on a transport.
 * `open` reports whether it bound. `close` is synchronous and complete when it returns, so it may be called
 * from inside the ownership release guard.
 */
export interface RuntimeChannelHost {
  open(): Promise<boolean>;
  close(): void;
}

export interface RuntimeOwnerOptions {
  storageRoot?: string;
  shutdownTimeoutMs?: number;
  rearmWindowMs?: number;
  rearmIntervalMs?: number;
  ownership?: RuntimeOwnership;
  persistence?: RuntimePersistence;
  statusPublisher?: RuntimeStatusPublisher;
  channel?: RuntimeChannelHost;
}

export interface RuntimeRegistryView {
  readonly version: number;
  readonly generation: string;
  readonly registry: ReadonlyMap<string, Device>;
  readonly snapshot: CompleteDeviceSnapshot;
}

export type RuntimeRegistryListener = (view: RuntimeRegistryView) => void;
export type RuntimeEventListener = (event: AnyDeviceEvent) => void;
export type RuntimeUnconfirmedWriteListener = (write: UnconfirmedWrite) => void;
export type RuntimeStateListener = (state: RuntimeState) => void;

/** Owns the long-lived SDK session, canonical registry, and runtime state transitions. */
export class RuntimeOwner {
  private client?: SdkClient;
  private startPromise?: Promise<void>;
  private stopPromise?: Promise<void>;
  private statusPublisher?: RuntimeStatusPublisher;
  private statusPublisherActive = false;
  private channel?: RuntimeChannelHost;
  private ownership?: RuntimeOwnership;
  private accountScope?: string;
  private runtimeLease?: RuntimeLease;
  private pendingOwnership?: Promise<RuntimeOwnershipResult>;
  private runtimeState: RuntimeState = 'stopped';
  private registryView?: RuntimeRegistryView;
  private registryVersion = 0;
  private readonly registryListeners = new Set<RuntimeRegistryListener>();
  private readonly eventListeners = new Set<RuntimeEventListener>();
  private readonly unconfirmedListeners = new Set<RuntimeUnconfirmedWriteListener>();
  private readonly stateListeners = new Set<RuntimeStateListener>();
  private stopping = false;
  private cleanupTerminalState?: 'authentication-required' | 'failed' | 'stopped';
  private readonly storageRoot?: string;
  private readonly persistence?: RuntimePersistence;
  private readonly shutdownTimeoutMs: number;
  private readonly rearmWindowMs: number;
  private readonly rearmIntervalMs: number;
  private shuttingDown = false;
  private standingDown = false;
  private rearming = false;
  private rearmTimer?: NodeJS.Timeout;
  private rearmGeneration?: string;
  private activeGeneration?: string;

  constructor(
    private readonly log: RuntimeLogger,
    private readonly configuredConfig: EufyConfig,
    private readonly clientFactory: SdkClientFactory,
    options: RuntimeOwnerOptions = {},
  ) {
    this.storageRoot = options.storageRoot;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 10_000;
    this.rearmWindowMs = options.rearmWindowMs ?? REARM_WINDOW_MS;
    this.rearmIntervalMs = options.rearmIntervalMs ?? REARM_INTERVAL_MS;
    this.ownership = options.ownership;
    this.statusPublisher = options.statusPublisher;
    this.channel = options.channel;
    if (this.storageRoot) {
      this.persistence = options.persistence ?? new AccountSessionPersistence(join(this.storageRoot, 'accounts'));
    } else {
      this.persistence = options.persistence;
      this.client = clientFactory(configuredConfig);
    }
  }

  start(): Promise<void> {
    if (this.stopPromise) {
      return Promise.resolve();
    }
    this.startPromise ??= this.startClient();
    return this.startPromise;
  }

  currentRegistry(): RuntimeRegistryView | undefined {
    return this.registryView;
  }

  currentState(): RuntimeState {
    return this.runtimeState;
  }

  currentAvailability(serial: string): AvailabilityObservation | undefined {
    return this.client?.deviceAvailability?.(serial);
  }

  subscribeRegistry(listener: RuntimeRegistryListener): () => void {
    this.registryListeners.add(listener);
    return () => this.registryListeners.delete(listener);
  }

  subscribeEvents(listener: RuntimeEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /**
   * Follows a write the device acknowledged and never applied. Separate from the event subscription because
   * it is an operation outcome and not device state: nothing about the device changed, which is the news.
   */
  subscribeUnconfirmedWrites(listener: RuntimeUnconfirmedWriteListener): () => void {
    this.unconfirmedListeners.add(listener);
    return () => this.unconfirmedListeners.delete(listener);
  }

  subscribeState(listener: RuntimeStateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  stop(): Promise<void> {
    this.shuttingDown = true;
    this.clearRearm();
    return this.stopOwnership();
  }

  /**
   * Releases the account session so another process may own it, and takes it back when it can.
   *
   * Reports whether a stand-down was started, which is acceptance and not completion: the release runs the same
   * bounded cleanup a shutdown runs, and the endpoint closes inside the release guard. Only the lease is
   * evidence that the session is free. A runtime holding no lease, one already stopping, and one already
   * standing down each refuse, so the caller behaves as it does without this channel.
   */
  standDown(): boolean {
    if (!this.storageRoot || !this.runtimeLease || this.stopping || this.standingDown || this.shuttingDown) {
      return false;
    }
    this.standingDown = true;
    this.rearmGeneration = this.activeGeneration;
    void this.stopOwnership().then(() => {
      this.standingDown = false;
      if (!this.shuttingDown) {
        this.scheduleRearm(Date.now() + this.rearmWindowMs);
      }
    });
    return true;
  }

  private stopOwnership(): Promise<void> {
    this.cleanupTerminalState = 'stopped';
    if (!this.stopPromise) {
      this.stopping = true;
      if (this.runtimeState !== 'owner-conflict') {
        this.transitionTo('stopping');
        if (this.statusPublisherActive) {
          this.statusPublisher?.update('stopping');
        }
      }
      this.stopPromise = this.cleanupWithinDeadline('stopped');
    } else if (
      this.runtimeState !== 'owner-conflict' &&
      this.runtimeState !== 'failed' &&
      this.runtimeState !== 'stopping'
    ) {
      this.transitionTo('stopping');
      if (this.statusPublisherActive) {
        this.statusPublisher?.update('stopping');
      }
    }
    return this.stopPromise.then(() => {
      if (this.runtimeState !== 'owner-conflict' && this.runtimeState !== 'failed' && this.runtimeState !== 'stopped') {
        if (this.statusPublisherActive) {
          this.statusPublisher?.stop();
        }
        this.transitionTo('stopped');
      }
    });
  }

  /**
   * Schedules the next attempt to take the account session back, or gives up once the window has passed.
   *
   * Nothing can tell this runtime when the session is free: the endpoint's lifetime is the lease, so the channel
   * is gone for exactly as long as the reason to re-arm lasts, and the process that asked may itself be gone.
   */
  private scheduleRearm(deadline: number): void {
    this.rearming = true;
    if (Date.now() >= deadline) {
      this.clearRearm();
      reportRuntimeNotice(this.log, 'stand-down-not-rearmed');
      return;
    }
    this.rearmTimer = setTimeout(() => void this.attemptRearm(deadline), this.rearmIntervalMs);
    this.rearmTimer.unref();
  }

  /**
   * Takes the account session back if it is free, and schedules another attempt if it is not.
   *
   * An attempt that finds the lease held is the ordinary case for as long as the authentication this runtime
   * stood down for is running, so it reports nothing and leaves this runtime stopped, which is what it is.
   */
  private async attemptRearm(deadline: number): Promise<void> {
    this.rearmTimer = undefined;
    if (this.shuttingDown || !this.rearming) {
      return;
    }
    this.resetForRearm();
    await this.start();
    if (this.rearming) {
      this.scheduleRearm(deadline);
    }
  }

  /**
   * Returns this owner to the state a start begins from, keeping what a stopped runtime is defined to retain.
   *
   * The latest complete registry view and its version survive, because HomeKit's topology is built from them
   * and only a later complete inventory may replace them. Everything a cleanup consumed is cleared so that one
   * cycle's cleanup cannot be a second cycle's, which is what keeps a lease from being released twice.
   */
  private resetForRearm(): void {
    this.startPromise = undefined;
    this.stopPromise = undefined;
    this.stopping = false;
    this.cleanupTerminalState = undefined;
    this.statusPublisherActive = false;
    this.pendingOwnership = undefined;
    this.client = undefined;
  }

  private clearRearm(): void {
    clearTimeout(this.rearmTimer);
    this.rearmTimer = undefined;
    this.rearming = false;
    this.rearmGeneration = undefined;
  }

  private async startClient(): Promise<void> {
    try {
      const { active, config } = await this.activeAccount();
      this.activeGeneration = active?.generation;
      if (this.stopping) {
        return;
      }
      if (this.rearming && this.activeGeneration !== this.rearmGeneration) {
        reportRuntimeNotice(this.log, 'stand-down-account-replaced');
        this.clearRearm();
        return;
      }
      if (this.storageRoot && !active) {
        this.statusPublisher ??= this.createStatusPublisher();
        this.statusPublisherActive = this.statusPublisher.update('authentication-required');
        this.transitionTo('authentication-required');
        return;
      }
      if (this.storageRoot && config.username?.trim()) {
        this.accountScope = config.username.trim().toLowerCase();
        this.ownership ??= new AccountOwnership(join(this.storageRoot, 'ownership'));
        this.statusPublisher ??= this.createStatusPublisher();
      }
      if (this.ownership && this.accountScope && active) {
        if (!this.rearming) {
          this.transitionTo('acquiring-ownership');
        }
        const pendingOwnership = this.ownership.acquire(this.accountScope, 'runtime');
        this.pendingOwnership = pendingOwnership;
        const ownership = await pendingOwnership;
        if (this.stopping) {
          return;
        }
        this.pendingOwnership = undefined;
        if (ownership.state === 'owner-conflict') {
          if (!this.rearming) {
            this.transitionTo('owner-conflict');
          }
          return;
        }
        this.runtimeLease = ownership.lease;
        this.clearRearm();
        await this.openChannel();
        const previousSnapshot = active.snapshot.load() ?? undefined;
        if (
          !this.statusPublisher?.start('starting', {
            generation: active.generation,
            complete: false,
            snapshot: previousSnapshot,
          })
        ) {
          throw new Error('runtime status tracker could not be started');
        }
        this.statusPublisherActive = true;
        this.transitionTo('starting');
        if (!active.session.load()) {
          this.transitionTo('authentication-required');
          await this.beginCleanup('authentication-required', {
            generation: active.generation,
            complete: false,
            snapshot: previousSnapshot,
          });
          return;
        }
        this.client = this.clientFactory(config, active, this.log);
        this.client.onEvent?.((event) => this.publishEvent(event));
        this.client.onUnconfirmedWrite?.((write) => this.publishUnconfirmedWrite(write));
        this.client.onInventory?.((result) => {
          void this.applyRuntimeResult(active, result).catch(() => this.beginCleanup('failed'));
        });
        const result = await this.client.start();
        if (result) {
          await this.applyRuntimeResult(active, result);
        }
        return;
      }
      this.client ??= this.clientFactory(config, active ?? undefined, this.log);
      await this.client.start();
    } catch {
      await this.beginCleanup('failed');
    }
  }

  private async activeAccount(): Promise<{ active: RuntimeActiveAccount | null; config: EufyConfig }> {
    const active = await this.persistence?.active();
    const configuration = active?.configuration.load();
    if (!active) {
      return { active: null, config: this.configuredConfig };
    }
    if (!configuration) {
      if (this.configuredConfig.username?.trim().toLowerCase() !== active.account) {
        throw new Error('legacy active account generation does not match Homebridge configuration');
      }
      return { active, config: this.configuredConfig };
    }
    if (configuration.username?.trim().toLowerCase() !== active.account) {
      throw new Error('active account generation has mismatched configuration');
    }
    return { active, config: configuration };
  }

  private createStatusPublisher(): RuntimeStatusPublisher {
    return new RuntimeTracker(join(this.storageRoot!, 'tracker.json'), 90_000, Date.now, () => {
      reportRuntimeNotice(this.log, 'status-publication-failed');
    });
  }

  private async applyRuntimeResult(active: RuntimeActiveAccount, result: SdkStartResult): Promise<void> {
    if (
      this.stopping ||
      (this.runtimeState === 'authentication-required' && result.state !== 'authentication-required')
    ) {
      return;
    }
    const previousSnapshot = active.snapshot.load() ?? undefined;
    if (result.state === 'authentication-required') {
      if (this.runtimeState === 'authentication-required') {
        return;
      }
      this.transitionTo('authentication-required');
      await this.beginCleanup('authentication-required', {
        generation: active.generation,
        complete: false,
        snapshot: previousSnapshot,
      });
      return;
    }
    if (result.state === 'degraded') {
      let latestSnapshot = previousSnapshot;
      const completeTopology = result.complete === true;
      if (completeTopology) {
        this.acceptCompleteRegistry(active, result.registry, result.snapshot);
        latestSnapshot = result.snapshot;
      }
      this.statusPublisher?.update('degraded', {
        generation: active.generation,
        complete: completeTopology,
        snapshot: latestSnapshot,
        status: completeTopology ? 'transport-degraded' : 'incomplete-inventory',
      });
      this.transitionTo('degraded');
      return;
    }
    this.acceptCompleteRegistry(active, result.registry, result.snapshot);
    if (
      !this.statusPublisher?.update('ready', {
        generation: active.generation,
        complete: true,
        snapshot: result.snapshot,
      })
    ) {
      throw new Error('complete runtime snapshot could not be published');
    }
    this.transitionTo('ready');
  }

  private acceptCompleteRegistry(
    active: RuntimeActiveAccount,
    registry: ReadonlyMap<string, Device>,
    snapshot: CompleteDeviceSnapshot,
  ): void {
    const registrySerials = [...registry.keys()].sort();
    const snapshotSerials = snapshot.devices.map((device) => device.sn).sort();
    if (JSON.stringify(registrySerials) !== JSON.stringify(snapshotSerials)) {
      throw new Error('canonical registry does not match its complete device snapshot');
    }
    active.snapshot.save(snapshot);
    this.publishRegistry(active.generation, registry, snapshot);
  }

  private async releaseRuntimeLease(onReleased: () => void = () => undefined): Promise<boolean> {
    const lease = this.runtimeLease;
    this.runtimeLease = undefined;
    if (!lease) {
      onReleased();
      return true;
    }
    try {
      let finalized = false;
      const release = await lease.release(() => {
        finalized = true;
        onReleased();
      });
      if (release.state !== 'stopped') {
        return false;
      }
      if (!finalized) {
        reportRuntimeNotice(this.log, 'ownership-release-not-finalized');
        return false;
      }
    } catch {
      reportRuntimeNotice(this.log, 'ownership-release-failed');
      return false;
    }
    return true;
  }

  private async stopRuntimeClient(): Promise<boolean> {
    const client = this.client;
    this.client = undefined;
    try {
      await client?.stop();
    } catch {
      reportRuntimeNotice(this.log, 'shutdown-failed');
      return false;
    }
    return true;
  }

  private beginCleanup(
    completedState: 'authentication-required' | 'failed' | 'stopped',
    update?: RuntimeTrackerUpdate,
  ): Promise<void> {
    this.stopping = true;
    if (!this.stopPromise) {
      this.cleanupTerminalState = completedState;
      this.stopPromise = this.cleanupWithinDeadline(completedState, update);
    }
    return this.stopPromise;
  }

  private async cleanupWithinDeadline(
    completedState: 'authentication-required' | 'failed' | 'stopped',
    update?: RuntimeTrackerUpdate,
  ): Promise<void> {
    if (this.runtimeState === 'owner-conflict') {
      return;
    }
    const deadline = Date.now() + this.shutdownTimeoutMs;
    const clientStopped = await this.boundedCleanup(this.stopRuntimeClient(), deadline);
    const ownershipSettled = await this.settlePendingOwnership(deadline);
    const cleanupFailedBeforeRelease = clientStopped !== true || ownershipSettled !== true;
    let publishedTerminalState = cleanupFailedBeforeRelease ? 'failed' : (this.cleanupTerminalState ?? completedState);
    const leaseReleased = await this.boundedCleanup(
      this.releaseRuntimeLease(() => {
        this.channel?.close();
        this.publishTerminalState(publishedTerminalState, update);
      }),
      deadline,
    );
    const timedOut = clientStopped === 'timeout' || ownershipSettled === 'timeout' || leaseReleased === 'timeout';
    if (timedOut) {
      reportRuntimeNotice(this.log, 'shutdown-timeout', { durationMs: this.shutdownTimeoutMs });
    }
    if (leaseReleased === 'timeout') {
      publishedTerminalState = 'failed';
      this.publishTerminalState('failed');
    }
    const terminalState = leaseReleased === true ? publishedTerminalState : 'failed';
    this.transitionTo(terminalState);
  }

  /**
   * Binds the live channel once this process is the account's owner.
   *
   * The endpoint's lifetime is the lease's: opened here, and closed inside the release guard. An unbound
   * endpoint is reported and the runtime starts without one.
   */
  private async openChannel(): Promise<void> {
    if (this.storageRoot) {
      const storageRoot = this.storageRoot;
      this.channel ??= new RuntimeChannelServer(
        runtimeChannelEndpointForHost(storageRoot),
        () => this.channelStatus(),
        {
          devices: () => this.channelDevices(),
          diagnostics: (notice) => this.pickUpDiagnosticsAuthorization(storageRoot, notice),
          standDown: () => this.standDown(),
        },
      );
    }
    if (this.channel && !(await this.channel.open())) {
      reportRuntimeNotice(this.log, 'channel-serve-failed');
    }
  }

  /**
   * Reads the persisted diagnostics session the notification names, reporting whether the file confirms it.
   *
   * The file is the authority and this is only what makes it read now rather than when a later record arrives,
   * so a notification the file does not confirm changes nothing. Without a notification the same file decides
   * every record's retention exactly as it does when no channel is there at all.
   */
  private pickUpDiagnosticsAuthorization(storageRoot: string, notice: RuntimeChannelAuthorization): boolean {
    return armDiagnosticsAuthorization(this.log, storageRoot, notice.supportCaseId);
  }

  /**
   * What the live channel answers: the state this runtime holds now, and the inventory it last published.
   *
   * `status` accompanies the state it was published with, and is otherwise derived from the live state
   * through the one mapping the tracker uses, so the pair cannot disagree. `generation` and `complete`
   * describe the published inventory and outlive a state change. `updatedAt` is when this answer was given.
   */
  private channelStatus(): RuntimeChannelStatus {
    const published = this.statusPublisher?.latest?.();
    const current = published?.state === this.runtimeState ? published : undefined;
    return {
      state: this.runtimeState,
      status: current?.status ?? runtimeStatusFor(this.runtimeState),
      ...(published?.generation === undefined ? {} : { generation: published.generation }),
      complete: published?.complete ?? false,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * What the live channel observes about each device its published inventory names.
   *
   * Taken from the registry this runtime already holds and the evidence the same published manifest carries,
   * so no second capability model is built from SDK internals. Nothing is observed once the SDK client is
   * gone, because a surface belonging to a stopped client states nothing about a device now. A field left
   * `undefined` is dropped on the way to the wire: unobserved is not unreachable, and it is not switched off.
   */
  private channelDevices(): RuntimeChannelDevice[] {
    const view = this.registryView;
    if (!view || !this.client) {
      return [];
    }
    return view.snapshot.devices.map((manifest) => ({
      serial: manifest.sn,
      availability: this.currentAvailability(manifest.sn)?.availability,
      enabled: this.observedEnablement(view.registry.get(manifest.sn), manifest),
    }));
  }

  /**
   * A camera's enablement where its own surface states one.
   *
   * The capability accessor is a call into the SDK's binding and can fault, and a device that is not a camera
   * has no accessor at all. Both are unobserved.
   */
  private observedEnablement(device: Device | undefined, manifest: DeviceManifest): boolean | undefined {
    try {
      const camera = device?.camera?.();
      return camera ? cameraEnablement(camera, indexDeviceEvidence(manifest).members) : undefined;
    } catch {
      return undefined;
    }
  }

  private publishTerminalState(
    terminalState: 'authentication-required' | 'failed' | 'stopped',
    update?: RuntimeTrackerUpdate,
  ): void {
    if (terminalState === 'stopped') {
      if (this.statusPublisherActive) {
        this.statusPublisher?.stop();
      }
    } else if (this.statusPublisherActive) {
      if (terminalState === 'authentication-required') {
        this.statusPublisher?.update(terminalState, update);
      } else {
        this.statusPublisher?.update(terminalState);
      }
    }
  }

  private async boundedCleanup(operation: Promise<boolean>, deadline: number): Promise<boolean | 'timeout'> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), Math.max(0, deadline - Date.now()));
      timer.unref();
    });
    const result = await Promise.race([operation, timeout]);
    clearTimeout(timer!);
    return result;
  }

  private async settlePendingOwnership(deadline: number): Promise<boolean | 'timeout'> {
    const pendingOwnership = this.pendingOwnership;
    if (!pendingOwnership) {
      return true;
    }
    const acquisition = pendingOwnership
      .then((ownership) => {
        if (this.pendingOwnership === pendingOwnership) {
          this.pendingOwnership = undefined;
        }
        if (ownership.state === 'owner') {
          this.runtimeLease = ownership.lease;
        }
        return true;
      })
      .catch(() => {
        reportRuntimeNotice(this.log, 'ownership-acquisition-failed');
        return false;
      });
    const settled = await this.boundedCleanup(acquisition, deadline);
    if (settled === 'timeout') {
      void acquisition.then(async (acquired) => {
        if (!acquired) {
          return;
        }
        const released = await this.boundedCleanup(this.releaseRuntimeLease(), Date.now() + this.shutdownTimeoutMs);
        if (released !== true) {
          reportRuntimeNotice(this.log, 'ownership-release-incomplete');
        }
      });
    }
    return settled;
  }

  private publishRegistry(
    generation: string,
    registry: ReadonlyMap<string, Device>,
    snapshot: CompleteDeviceSnapshot,
  ): void {
    const view = Object.freeze({
      version: ++this.registryVersion,
      generation,
      registry: new Map(registry),
      snapshot: parseCompleteDeviceSnapshot(snapshot),
    });
    this.registryView = view;
    for (const listener of this.registryListeners) {
      try {
        listener(view);
      } catch {
        reportRuntimeNotice(this.log, 'registry-subscriber-failed');
      }
    }
  }

  private publishUnconfirmedWrite(write: UnconfirmedWrite): void {
    for (const listener of this.unconfirmedListeners) {
      try {
        listener(write);
      } catch {
        reportRuntimeNotice(this.log, 'event-subscriber-failed');
      }
    }
  }

  private publishEvent(event: AnyDeviceEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch {
        reportRuntimeNotice(this.log, 'event-subscriber-failed');
      }
    }
  }

  private transitionTo(state: RuntimeState): void {
    if (this.runtimeState === state) {
      return;
    }
    this.runtimeState = state;
    for (const listener of this.stateListeners) {
      try {
        listener(state);
      } catch {
        reportRuntimeNotice(this.log, 'state-subscriber-failed');
      }
    }
  }
}
