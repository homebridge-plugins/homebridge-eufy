import type { AnyDeviceEvent, ArmingMode, AvailabilityObservation, Device } from '@mega-yfue/eufy-sdk';
import type { HAP, PlatformAccessory, Service, WithUUID } from 'homebridge';

import type { DeviceMemberEvidence, DeviceProductRequirement } from '../device/member-evidence.js';
import type {
  LiveMediaAdapter,
  LiveVideoSettings,
  LiveSessionOutcome,
  LiveSessionRelease,
  MediaSessionBudget,
  StationLiveSessionRegistry,
  NegotiatedLiveVideo,
  RecordingMediaAdapter,
  SnapshotMediaAdapter,
  SnapshotMode,
} from '../media/contracts.js';

/** The HAP definitions required by any self-hosted capability adapter. */
export type HomeKitDefinitions = Pick<
  HAP,
  | 'Service'
  | 'Characteristic'
  | 'HAPStatus'
  | 'HapStatusError'
  | 'CameraController'
  | 'H264Profile'
  | 'H264Level'
  | 'AudioStreamingCodecType'
  | 'AudioStreamingSamplerate'
  | 'SRTPCryptoSuites'
  | 'VideoCodecType'
  | 'MediaContainerType'
  | 'AudioRecordingCodecType'
  | 'AudioRecordingSamplerate'
  | 'AudioBitrate'
  | 'EventTriggerOption'
  | 'HDSProtocolError'
  | 'HDSProtocolSpecificErrorReason'
>;

/** An allowlisted capability condition emitted without physical-device identity. */
export interface AdapterDiagnostic {
  code: string;
  capability: string;
  member: string;
  active: boolean;
  reason: string;
}

/** A redacted account of one capability event handled in debug mode. */
export interface AdapterEventTrace {
  event: string;
  /** `ignored` is an announcement the adapter read and deliberately presents nothing for. */
  observation: 'valid' | 'missing' | 'malformed' | 'ignored';
  /** The device's own numeric event code, where the announcement carries one and it decided the observation. */
  code?: number;
  /**
   * What announced the change, where the adapter follows more than one announcement for the same state.
   *
   * `write` is the SDK reflecting a write this plugin issued; `poll` is the SDK's generic property
   * announcement seeing the value move, which means something other than this plugin changed it. That
   * announcement reaches the plugin on whichever inbound path saw the value — a cloud poll, a realtime
   * report, or the read-through cache's own re-read — and the SDK deliberately does not distinguish them,
   * because it cannot tell its own write's echo from a change made in the vendor app. Both reach the same
   * handler and produced the same record until now, so a support case could not tell "we did this" from
   * "the user did this in the vendor app" — the first question anyone asks about a camera that turned
   * itself off.
   */
  announcedBy?: 'write' | 'poll';
}

/** An identity-free account of one live video selection made by a HomeKit controller. */
type AdapterLiveVideoTrace = Pick<
  NegotiatedLiveVideo,
  'profile' | 'level' | 'width' | 'height' | 'fps' | 'mtu' | 'maxBitRate'
> & {
  event: 'live-video-selected';
  operation: 'start' | 'reconfigure';
  /** The family of address this selection's adapted output is sent to. The address itself is never recorded. */
  addressVersion: 'ipv4' | 'ipv6';
};

/** An identity-free live-session failure or release milestone. */
type AdapterLiveSessionTrace =
  | (Extract<LiveSessionOutcome, { outcome: 'failed' }> & { event: 'live-session-failed' })
  /**
   * A session gave its source back, and whether it was asked to or ended itself.
   *
   * Both look identical on a controller, which simply stops showing a picture, so the record is the only place
   * the difference exists.
   */
  | { event: 'live-session-released'; release: LiveSessionRelease }
  /** The first adapted output reached the negotiated destination, which is when a picture can appear. */
  | { event: 'live-session-streaming' }
  /** The device accepted talkback and return audio is being handed to it. A failure is the talkback condition. */
  | { event: 'live-talkback-started' }
  /**
   * A started request reached neither a streaming outcome nor a failure.
   *
   * Every request is meant to end in one or the other, and a controller badges the camera either way. One
   * ending in neither leaves an operator looking at a failure the log has no record of, which nobody can
   * diagnose. This states that it happened and how long was waited; it says nothing about why, because the
   * path that dropped it left nothing to say.
   */
  | { event: 'live-request-unaccounted'; afterMs: number }
  /**
   * A stream request refused before it reached the source at all.
   *
   * Every one of these answers a controller instantly, and a controller badges the camera instantly with it.
   * None of them was recorded before, so the badge an operator saw at the moment of a switch had no counterpart
   * in a log, and five separate explanations for it were proposed and ruled out by measurement instead.
   *
   * `cancelled` and `at-capacity` are the two a fast switch produces: a controller prepares the next camera
   * before the last has given its port back, so the preparation is superseded or the declared ceiling is
   * momentarily full. Neither is a fault, and both are indistinguishable from one without this.
   */
  | { event: 'live-request-refused'; reason: 'disabled' | 'at-capacity' | 'cancelled' | 'prepare-failed' };

export type AdapterTrace = AdapterEventTrace | AdapterLiveVideoTrace | AdapterLiveSessionTrace;

/** Dependencies supplied by the reconciler when an adapter attaches to one accessory container. */
export interface AdapterAttachmentContext {
  readonly device: Device;
  readonly evidence: ReadonlyMap<string, DeviceMemberEvidence>;
  readonly accessory: PlatformAccessory;
  readonly hap: HomeKitDefinitions;
  readonly liveMedia?: LiveMediaAdapter;
  readonly recordingMedia?: RecordingMediaAdapter;
  readonly snapshotMedia?: SnapshotMediaAdapter;
  /** The declared ceiling on concurrent media, absent when the operator declared none. */
  readonly mediaBudget?: MediaSessionBudget;
  /** Where a live session is recorded, so opportunistic media work elsewhere on its station stands aside. */
  readonly stationLiveSessions?: StationLiveSessionRegistry;
  /** Whether a camera offers a controller only its HD live resolutions, so no live view is sent below 720p. */
  readonly hdLiveVideo?: boolean;
  /** The live video settings this camera is coded with, its own override of each else the global one. */
  readonly liveVideoSettings?: LiveVideoSettings;
  readonly audioEnabled?: boolean;
  readonly securitySystemEnabled?: boolean;
  readonly snapshotMode?: SnapshotMode;
  /**
   * Which eufy guard mode each HomeKit security state means, for the states the user assigned.
   *
   * HomeKit names four states and a station reports nine, so the pairing is a decision rather than a fact. An
   * unassigned state carries this adapter's own default, and `night` has none: no vendor mode is a night
   * posture, so HomeKit can set it only once a user says what it means.
   */
  readonly armingModes?: Readonly<Partial<Record<'home' | 'away' | 'night' | 'off', ArmingMode>>>;
  readonly availability?: () => AvailabilityObservation | undefined;
  diagnose(diagnostic: AdapterDiagnostic): void;
  observed(code: string): void;
  trace?(trace: AdapterTrace): void;
  persist(): void;
}

/** Why an attachment is releasing runtime work; shutdown preserves HomeKit's persisted service state. */
export type AdapterDetachmentReason = 'replacement' | 'withdrawal' | 'shutdown';

/** Successful attachment state, optionally retaining typed SDK event behavior. */
export interface AttachedAdapter {
  event?(event: AnyDeviceEvent): AdapterEventTrace | undefined;
  detach?(reason?: AdapterDetachmentReason): void;
}

/** The complete interface presented by one self-hosted capability adapter. */
export interface HomeKitAdapter {
  readonly key: string;
  readonly role: 'primary-purpose' | 'supplemental';
  readonly requiresProduct?: DeviceProductRequirement;
  readonly requires: readonly DeviceMemberEvidence[];
  readonly requiresAny?: readonly DeviceMemberEvidence[];
  /** The stable evidence ids of every SDK member this adapter represents. */
  readonly coverage: readonly string[];
  attach(context: AdapterAttachmentContext): AttachedAdapter | undefined;
}

/** This accessory's service of one type under the stable key its adapter owns, created on first use. */
export function ownService(
  accessory: PlatformAccessory,
  type: WithUUID<typeof Service>,
  name: string,
  key: string,
): Service {
  return accessory.getServiceById(type, key) ?? accessory.addService(type, name, key);
}
