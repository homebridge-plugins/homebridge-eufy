import type { LiveAudioFrame, LiveStreamConsumer, LiveVideoConfig, LiveVideoFrame, TalkbackHandle } from '@mega-yfue/eufy-sdk';
import { LiveStreamStartError, StationKeyUnavailableError, StationUnreachableError } from '@mega-yfue/eufy-sdk';
import { createSocket } from 'node:dgram';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import type { Readable, Writable } from 'node:stream';

import type { LiveVideoSettings } from '../configuration.js';
import type {
  AdaptationCause,
  AdaptationDiagnostics,
  AdaptationEvent,
  AdaptationNotice,
  AdaptationRole,
  LiveMediaAdapter,
  LiveMediaSource,
  LiveMediaTarget,
  LiveMediaTransport,
  LiveSessionFailure,
  NegotiatedLiveAudio,
  NegotiatedLiveMedia,
  NegotiatedLiveVideo,
  PreparedLiveMedia,
  TalkbackFailure,
} from './contracts.js';

/** How long a deliberately stopped adaptation process is given to exit before it is killed. */
const PROCESS_STOP_GRACE_MS = 2_000;

/** Closes an adaptation process's input and terminates it, killing it if it has not exited within the grace. */
export function stopProcess(
  process: Pick<MediaProcess, 'kill'> & { readonly stdin: Writable | null; on(event: 'exit', listener: () => void): unknown },
): void {
  process.stdin?.destroy();
  process.kill('SIGTERM');
  const killDeadline = setTimeout(() => process.kill('SIGKILL'), PROCESS_STOP_GRACE_MS);
  killDeadline.unref?.();
  process.on('exit', () => clearTimeout(killDeadline));
}

/**
 * Whether an adaptation opened for `running` can code what the source announced as `announced`.
 *
 * Only the codec decides it. An adaptation's input format is fixed at spawn, so an H.265 access unit fed to
 * a process opened for H.264 does not parse; a changed geometry is absorbed, because the decoder
 * reinitialises on the new parameter sets and the scale filter follows it. Measured through this plugin's
 * bundled FFmpeg on its own argument list: 60 of 60 frames across 1280x720 to 640x360, 60 of 60 in reverse,
 * 90 of 90 across 640 to 1280 to 640, no warnings; and a codec change decoding only the frames before it.
 *
 * The geometry never reached the argument list either — the output geometry is HomeKit's selection — so
 * rebuilding on it spawned a byte-identical command, discarded the frames in flight, and waited for the
 * next keyframe. A camera ramps its ladder during the first seconds of a session, four rungs inside 3.9 s
 * on a mains-powered camera measured on the fleet, so all of that was paid before any video reached the
 * controller.
 */
function canCode(running: LiveVideoConfig, announced: LiveVideoConfig): boolean {
  return running.codec === announced.codec;
}

/**
 * How many times one live session replaces its adaptation because the source's input changed, before it
 * fails the session instead.
 *
 * A replacement costs a process, FFmpeg's stream analysis, the encoder's state, and the wait for another
 * source keyframe, withholding every access unit in between. A source alternating between two inputs pays
 * that at every keyframe and produces nothing watchable, so this bound sits above the changes a source
 * settling on one input makes and below an alternation. Only a changed codec reaches it: {@link canCode}
 * absorbs a changed geometry.
 */
const MAX_SOURCE_INPUT_REPLACEMENTS = 3;

const INITIAL_RTCP_GRACE_MS = 15_000;
/**
 * The longest a session waits for the SDK to hand over a source, after which it cancels the acquisition.
 *
 * Reaching a station is inside this wait: an unconnected station is reconnected within it, and a HomeBase
 * resolves its session before it can start one. The bound is therefore above what reaching a station costs and
 * below both {@link SOURCE_START_BACKSTOP_MS} and the window a started request is owed an outcome within, so
 * the acquisition is what this expiry reports.
 *
 * Expiry cancels the acquisition. A station serves one media channel, and an uncancelled acquisition holds it
 * until the SDK's own wait elapses, which refuses every camera behind that station meanwhile.
 */
const SOURCE_ACQUISITION_DEADLINE_MS = 25_000;
const RETURN_AUDIO_BIND_GRACE_MS = 250;
/**
 * Backstop for a started media session that never produces adapted output. The SDK source owns the
 * warm-up window, retries the start inside it, and fails its consumers with a typed `error` event, which
 * is the primary failure signal for both live and recording sessions; that window is an SDK-internal
 * default the plugin cannot read, so this bound sits strictly above it and only catches an SDK that
 * reports nothing at all.
 */
export const SOURCE_START_BACKSTOP_MS = 30_000;
/**
 * How far the RTP sequence space is advanced for each adaptation a session sends on, in packets.
 *
 * One session keeps one SSRC and one SRTP key across a replaced adaptation, and the SRTP packet index is built
 * from the sequence number — so a replacement that started where FFmpeg would have, at a random base, is read
 * by the controller as replay half the time and its packets are discarded under a key that still
 * authenticates. Nothing reports it: the controller goes on acknowledging what it received before, so RTCP
 * liveness holds while the picture never advances again.
 *
 * Advancing instead of restarting keeps the index monotonic. The step is well under half the sequence space,
 * which is what keeps the receiver's own index estimate correct across the wrap it eventually crosses; a gap
 * this size reads as loss, which a controller already tolerates.
 */
const OUTPUT_SEQUENCE_STEP = 4_096;
const SOURCE_ACQUISITION_TIMEOUT = Symbol('source-acquisition-timeout');

/**
 * The bounded reason one SDK source failure reports.
 *
 * The SDK stages a start that produced no keyframe by what the source delivered, and a start that carried
 * audio and never a single video frame is the one signature worth naming apart: measured on a real camera
 * that had been switched off, the source accepted the start, delivered audio for the whole warm-up window,
 * and reported `audio-only`. Every other stage is a source error, because nothing else distinguishes it
 * from a transport that failed.
 */
function liveSourceFailure(error: unknown): LiveSessionFailure {
  return error instanceof LiveStreamStartError && error.stage === 'audio-only' ? 'source-audio-only' : sourceFailure(error);
}

/**
 * Why a source stopped producing, as this domain's bounded vocabulary.
 *
 * A station names its own failures apart from the camera's: every camera behind a base that did not connect
 * fails together, and a sealed start the station gave no key for does not resolve by retrying.
 */
export function sourceFailure(error: unknown): 'station-unreachable' | 'station-key-unavailable' | 'source-error' {
  if (error instanceof StationUnreachableError) {
    return 'station-unreachable';
  }
  return error instanceof StationKeyUnavailableError ? 'station-key-unavailable' : 'source-error';
}

/** One adaptation process, in the terms every adapted media session controls it by. */
export interface MediaProcess {
  readonly stdin: Writable;
  readonly stderr: Readable;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

/** How many diagnostic lines one adaptation retains, which is what a failure is attributed from. */
const ADAPTATION_STDERR_TAIL_LINES = 8;
/** The longest partial line held while waiting for its terminator, so a silent process cannot grow one. */
const ADAPTATION_STDERR_PARTIAL_BYTES = 512;

/** RFC 3550 fixed RTP header, RFC 3711 HMAC-SHA1-80 tag, and the RFC 6184 FU-A fragmentation header. */
const PACKET_OVERHEAD_BYTES = 12 + 10 + 2;
/**
 * How far under the negotiated MTU the RTP muxer keeps a datagram. Measured on the bundled encoder at two
 * MTUs: `pkt_size` 1200 emitted datagrams of at most 1196 bytes and 1378 emitted at most 1374.
 */
const PACKET_SIZE_HEADROOM_BYTES = 4;

/**
 * The encoder budget one negotiated video selection leaves after paying for its own transport, in kbps.
 *
 * The negotiated bit rate bounds what the accessory transmits, not what it codes, so the RTP and SRTP bytes
 * this session will add are reserved out of the ceiling instead of being spent beside it. Every packet costs
 * a header, an authentication tag and a fragmentation header, and the packet count is the coded media divided
 * by what one full packet can carry, plus one partial packet per frame.
 *
 * The negotiated frame rate is the figure used because it bounds packets per second exactly as it bounds
 * pictures per second. A camera delivering below its selection therefore produces fewer packets than were
 * reserved for, which spends the ceiling rather than exceeding it.
 *
 * A ceiling too small to pay for its own transport still yields a positive budget, because an encoder given
 * a non-positive rate refuses to start and a refused session is worse than an overshooting one.
 */
function videoBudgetInsideCeiling(selection: NegotiatedLiveVideo): number {
  const ceilingBytesPerSecond = selection.maxBitRate * 125;
  const mediaBytesPerPacket = selection.mtu - PACKET_SIZE_HEADROOM_BYTES - PACKET_OVERHEAD_BYTES;
  const packetsPerSecond = ceilingBytesPerSecond / mediaBytesPerPacket + selection.fps;
  const reserved = (PACKET_OVERHEAD_BYTES * packetsPerSecond * 8) / 1_000;
  return Math.max(1, Math.floor(selection.maxBitRate - reserved));
}

/**
 * Splits one adaptation process's stderr into whole lines and retains a bounded tail of the diagnostic
 * ones.
 *
 * Both consumers of that pipe read it: `-progress pipe:2` writes the key/value block that says adaptation
 * reached its output, and everything else on it is the only account of why a process refused or stopped.
 * Progress lines are excluded from the tail because they are emitted on a timer and would otherwise be the
 * whole of it by the time anything went wrong.
 */
export class AdaptationStderr {
  private partial = '';
  private readonly retained: string[] = [];

  /** Consumes one chunk and returns the lines it completed, in the order they were written. */
  observe(chunk: Buffer): readonly string[] {
    const lines = `${this.partial}${chunk.toString()}`.split(/\r?\n/);
    this.partial = lines.pop()?.slice(-ADAPTATION_STDERR_PARTIAL_BYTES) ?? '';
    for (const line of lines) {
      if (line.trim() === '' || line.startsWith('progress=')) {
        continue;
      }
      this.retained.push(line);
      if (this.retained.length > ADAPTATION_STDERR_TAIL_LINES) {
        this.retained.shift();
      }
    }
    return lines;
  }

  /** The retained diagnostic tail, oldest first. */
  tail(): readonly string[] {
    return [...this.retained];
  }
}

/**
 * Which FFmpeg an adaptation will run, so a failure can be attributed to a build rather than to FFmpeg in
 * general.
 *
 * `version` is the binary's own banner and is absent when it did not answer at all, which is what a path
 * naming nothing runnable looks like. That distinction is the whole point of resolving it before any media
 * exists: a bundled static build and a distribution build on the same host have completely different
 * encoder sets, and neither can be inferred from the host facts alone.
 */
interface FfmpegIdentity {
  readonly path: string;
  readonly source: 'bundled' | 'configured';
  readonly version?: string;
}

/** How the version banner is read: the executable's own answer, or nothing where it did not give one. */
type FfmpegVersionProbe = (path: string) => Promise<string | undefined>;

/** How long the version probe is allowed to take before the binary counts as not having answered. */
const FFMPEG_VERSION_PROBE_TIMEOUT_MS = 5_000;
/** How much of the banner is kept: enough for the build and version, and no more. */
const FFMPEG_VERSION_BANNER_LENGTH = 120;

/**
 * Runs `-version` on one path and returns its first banner line, or nothing where it produced none.
 *
 * Every failure answers the same way, because none of them can be told apart by a caller that only needs
 * to know whether this binary can be asked to encode: a missing file, a file that is not executable, one
 * that is not FFmpeg, and one that hangs all mean the same thing to the media that would have used it.
 */
const probeFfmpegVersion: FfmpegVersionProbe = async (path) => {
  const { stdout } = await promisify(execFile)(path, ['-hide_banner', '-version'], {
    timeout: FFMPEG_VERSION_PROBE_TIMEOUT_MS,
    maxBuffer: 64 * 1024,
    windowsHide: true,
  }).catch(() => ({ stdout: '' }));
  return stdout.split(/\r?\n/, 1)[0]?.trim().slice(0, FFMPEG_VERSION_BANNER_LENGTH) || undefined;
};

/**
 * Resolves the complete identity of one adaptation binary, without opening any media.
 *
 * Reading the banner spawns the binary, so this is asked once at launch and its answer is not waited on: a
 * support archive is worth one process at startup, and no camera is worth delaying for one.
 */
export async function resolveFfmpegIdentity(
  path: string,
  source: 'bundled' | 'configured',
  probe: FfmpegVersionProbe = probeFfmpegVersion,
): Promise<FfmpegIdentity> {
  const version = await probe(path).catch(() => undefined);
  return { path, source, ...(version === undefined ? {} : { version }) };
}

interface ReservedMediaPort {
  readonly port: number;
  onMessage(listener: () => void): void;
  close(): void | Promise<void>;
}

type LiveMediaProcessFactory = (executable: string, args: readonly string[]) => MediaProcess;
interface ReturnAudioProcess extends MediaProcess {
  readonly stdout: Readable;
  /** FFmpeg's fd 3: the AAC-ELD FLV output. */
  readonly eld: Readable;
}
type ReturnAudioProcessFactory = (executable: string, args: readonly string[]) => ReturnAudioProcess;
type MediaPortFactory = (addressVersion: 'ipv4' | 'ipv6') => Promise<ReservedMediaPort>;

/**
 * Reports what one adaptation process did to `diagnostics`, whether or not the session it belonged to fails for it.
 *
 * An audio adaptation is restarted rather than failed and a return-audio one fails only talkback, so without a
 * report of their own those two exit with no account anywhere of why they stopped. An `output` report carries
 * nothing but the tail, so it is made only when the process actually wrote something: a silent process that
 * ended as intended has nothing to attribute.
 */
export function adaptationReporter(diagnostics: AdaptationDiagnostics | undefined) {
  return (
    role: AdaptationRole,
    event: AdaptationEvent,
    stderr: AdaptationStderr,
    code?: number | null,
    signal?: NodeJS.Signals | null,
    extras?: Pick<AdaptationNotice, 'sourceFragments'>,
  ): void => {
    const tail = stderr.tail();
    if (event === 'output' && tail.length === 0) {
      return;
    }
    diagnostics?.report({
      role,
      event,
      ...(typeof code === 'number' ? { code } : {}),
      ...(typeof signal === 'string' ? { signal } : {}),
      ...extras,
      ...(tail.length ? { stderr: tail } : {}),
    });
  };
}

/** The `libx264` constant rate factor a live adaptation codes at when the negotiated bit rate is ignored. */
const CONSTANT_QUALITY_CRF = 23;

/**
 * One way of coding a negotiated live selection: the encoder FFmpeg names, the arguments it is given for a
 * selection and an encoder budget in kbps, and what it appends to the shared scale and pad chain.
 *
 * The same builder produces the arguments a session runs and the arguments qualification proves, so nothing
 * qualified differs from what is served.
 */
interface LiveVideoEncoder {
  readonly name: string;
  readonly args: (selection: NegotiatedLiveVideo, kbps: string) => string[];
  readonly upload?: string;
}

/** The host facts that decide which hardware encoders a binary may carry. */
export interface EncoderHost {
  readonly platform: string;
  readonly arch: string;
  /** Whether the binary is an administrator's own `ffmpegPath` rather than the bundled build. */
  readonly configured: boolean;
}

/** `libx264`'s profile, level, speed and pixel format, shared by its rate-capped and constant-quality forms. */
function libx264Arguments(selection: NegotiatedLiveVideo): string[] {
  return [
    '-preset',
    'superfast',
    '-tune',
    'zerolatency',
    '-profile:v',
    selection.profile,
    '-level:v',
    selection.level,
    '-pix_fmt',
    'yuv420p',
  ];
}

/** The software encoder every selection no qualified hardware encoder serves is coded by. */
const LIBX264: LiveVideoEncoder = {
  name: 'libx264',
  args: (selection, kbps) => [...libx264Arguments(selection), '-b:v', kbps, '-maxrate', kbps, '-bufsize', kbps],
};

/** `libx264` at {@link CONSTANT_QUALITY_CRF} with no rate control, which no hardware encoder replaces. */
const CONSTANT_QUALITY: LiveVideoEncoder = {
  name: 'libx264',
  args: (selection) => [...libx264Arguments(selection), '-crf', String(CONSTANT_QUALITY_CRF)],
};

/** The H.264 `profile_idc` of each negotiable profile. */
const PROFILE_IDC = { baseline: 66, main: 77, high: 100 } as const;

/**
 * The hardware encoders a selection may be served by, in order of preference, each with the hosts whose
 * binary may carry it.
 *
 * Each states profile, level and rate control in its own encoder's spelling, with B-frames off and its
 * lowest-latency mode, as docs/reference/hardware-encoder-viability.md records them. None is used for a
 * selection until {@link FfmpegLiveMedia.qualify} has proven it against that selection.
 */
const HARDWARE_ENCODERS: readonly (LiveVideoEncoder & { readonly triedOn: (host: EncoderHost) => boolean })[] = [
  {
    name: 'h264_videotoolbox',
    triedOn: (host) => host.platform === 'darwin',
    args: (selection, kbps) => [
      '-profile:v',
      selection.profile,
      '-level:v',
      selection.level,
      '-realtime',
      '1',
      '-prio_speed',
      '1',
      '-bf',
      '0',
      '-pix_fmt',
      'yuv420p',
      '-b:v',
      kbps,
      '-maxrate',
      kbps,
    ],
  },
  {
    name: 'h264_qsv',
    triedOn: (host) => host.platform === 'win32' || host.configured,
    args: (selection, kbps) => [
      '-profile:v',
      selection.profile,
      '-level:v',
      selection.level.replace('.', ''),
      '-pix_fmt',
      'nv12',
      '-bf',
      '0',
      '-look_ahead',
      '0',
      '-async_depth',
      '1',
      '-b:v',
      kbps,
      '-maxrate',
      kbps,
    ],
  },
  {
    name: 'h264_nvenc',
    triedOn: (host) => host.configured,
    args: (selection, kbps) => [
      '-profile:v',
      selection.profile,
      '-level:v',
      selection.level,
      '-preset',
      'p1',
      '-tune',
      'ull',
      '-zerolatency',
      '1',
      '-bf',
      '0',
      '-pix_fmt',
      'yuv420p',
      '-rc',
      'cbr',
      '-b:v',
      kbps,
      '-maxrate',
      kbps,
      '-bufsize',
      kbps,
    ],
  },
  {
    name: 'h264_amf',
    triedOn: (host) => host.platform === 'linux' && host.arch === 'x64',
    args: (selection, kbps) => [
      '-profile:v',
      selection.profile === 'baseline' ? 'constrained_baseline' : selection.profile,
      '-level:v',
      selection.level,
      '-usage',
      'ultralowlatency',
      '-bf',
      '0',
      '-pix_fmt',
      'yuv420p',
      '-b:v',
      kbps,
      '-maxrate',
      kbps,
      '-bufsize',
      kbps,
    ],
  },
  {
    name: 'h264_vaapi',
    triedOn: (host) => host.platform === 'linux' && host.configured,
    upload: ',format=nv12,hwupload',
    args: (selection, kbps) => [
      '-vaapi_device',
      '/dev/dri/renderD128',
      '-profile:v',
      selection.profile === 'baseline' ? 'constrained_baseline' : selection.profile,
      '-level:v',
      selection.level,
      '-bf',
      '0',
      '-async_depth',
      '1',
      '-b:v',
      kbps,
      '-maxrate',
      kbps,
    ],
  },
  {
    name: 'h264_v4l2m2m',
    triedOn: (host) => host.platform === 'linux' && (host.arch === 'arm' || host.arch === 'arm64'),
    args: (selection, kbps) => [
      '-profile:v',
      String(PROFILE_IDC[selection.profile]),
      '-pix_fmt',
      'yuv420p',
      '-b:v',
      kbps,
    ],
  },
];

/** How many seconds of synthetic picture one qualification run codes. */
const QUALIFICATION_SECONDS = 2;
/** The longest one qualification process may run before its selection counts as unqualified. */
const QUALIFICATION_RUN_TIMEOUT_MS = 10_000;
/** The longest qualification as a whole may take; a selection it has not finished by then stays unqualified. */
const QUALIFICATION_BUDGET_MS = 60_000;

/**
 * The selections every hardware encoder is qualified against: each advertised profile and level, at the
 * largest advertised geometry that level's frame-size limit admits, at the advertised frame-rate ceiling, and
 * at 299 kbps, the lowest bit rate a controller has been measured selecting.
 */
const QUALIFICATION_SELECTIONS: readonly NegotiatedLiveVideo[] = (['baseline', 'main', 'high'] as const).flatMap(
  (profile) =>
    (
      [
        ['3.1', 1280, 720],
        ['3.2', 1280, 720],
        ['4.0', 1920, 1080],
      ] as const
    ).map(([level, width, height]) => ({
      profile,
      level,
      width,
      height,
      fps: 30,
      maxBitRate: 299,
      mtu: 1378,
      payloadType: 99,
      ssrc: 1,
      rtcpInterval: 0.5,
    })),
);

/**
 * Runs one FFmpeg process to completion with `input` on its stdin, and returns what it wrote, or nothing where
 * it exited non-zero, failed to start, or outran `timeoutMs`.
 */
export type QualificationRun = (
  executable: string,
  args: readonly string[],
  input: Buffer | undefined,
  timeoutMs: number,
) => Promise<{ readonly stdout: Buffer; readonly stderr: string } | undefined>;

const runQualification: QualificationRun = (executable, args, input, timeoutMs) =>
  new Promise((resolve) => {
    const child = execFile(
      executable,
      args,
      { encoding: 'buffer', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => resolve(error ? undefined : { stdout, stderr: stderr.toString() }),
    );
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(input);
  });

/**
 * What qualifying one hardware encoder for one selection found: `qualified`, or the first check it failed.
 *
 * `budget` is qualification's deadline reached before a run, `encode` a coding run that exited non-zero, failed
 * to start, or timed out, and `trace` a tracing run that did. The rest name the coded fact that differed, and
 * `bytes` carries the coded bytes beside the bound they exceeded.
 */
type QualificationOutcome =
  | 'qualified'
  | 'budget'
  | 'encode'
  | 'trace'
  | 'profile'
  | 'level'
  | 'geometry'
  | 'frames'
  | readonly ['bytes', number, number];

/**
 * Qualifies `encoder` for `selection` before `deadline`.
 *
 * The encoder codes {@link QUALIFICATION_SECONDS} of moving synthetic picture through the session's own
 * argument list, which proves it is named by the binary, accepts those arguments, and opens on this host's
 * devices. A second FFmpeg then traces the coded parameter sets, which proves what was coded: a profile at or
 * below the negotiated one, the negotiated level and macroblock geometry, every frame, and no more bytes than
 * the encoder budget plus the one second of it the session's rate control may borrow.
 */
async function qualification(
  executable: string,
  encoder: LiveVideoEncoder,
  selection: NegotiatedLiveVideo,
  run: QualificationRun,
  deadline: number,
): Promise<QualificationOutcome> {
  const within = (args: string[], input?: Buffer) => {
    const left = deadline - Date.now();
    return left > 0 ? run(executable, args, input, Math.min(left, QUALIFICATION_RUN_TIMEOUT_MS)) : ('budget' as const);
  };
  const coded = await within([
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=${selection.width}x${selection.height}:rate=${selection.fps}:duration=${QUALIFICATION_SECONDS}`,
    ...encodeArguments(encoder, selection),
    '-f',
    'h264',
    'pipe:1',
  ]);
  if (!coded || coded === 'budget') {
    return coded ?? 'encode';
  }
  const traced = await within(
    ['-hide_banner', '-f', 'h264', '-i', 'pipe:0', '-c', 'copy', '-bsf:v', 'trace_headers', '-f', 'null', '-'],
    coded.stdout,
  );
  if (!traced || traced === 'budget') {
    return traced ?? 'trace';
  }
  const field = (name: string) => Number(new RegExp(`\\b${name}\\s.*= (\\d+)$`, 'm').exec(traced.stderr)?.[1]);
  const profile = field('profile_idc');
  const wanted = PROFILE_IDC[selection.profile];
  const checks: ReadonlyArray<readonly [QualificationOutcome, boolean]> = [
    ['profile', profile === wanted || (profile === 66 && field('constraint_set1_flag') === 1) || (profile === 77 && wanted === 100)],
    ['level', field('level_idc') === Number(selection.level.replace('.', ''))],
    [
      'geometry',
      field('pic_width_in_mbs_minus1') + 1 === Math.ceil(selection.width / 16) &&
        field('pic_height_in_map_units_minus1') + 1 === Math.ceil(selection.height / 16),
    ],
    ['frames', (traced.stderr.match(/\bPacket: /g)?.length ?? 0) === selection.fps * QUALIFICATION_SECONDS],
  ];
  const bound = videoBudgetInsideCeiling(selection) * 125 * (QUALIFICATION_SECONDS + 1);
  return (
    checks.find(([, passed]) => !passed)?.[0] ??
    (coded.stdout.length <= bound ? 'qualified' : ['bytes', coded.stdout.length, bound])
  );
}

/** The live video packet size an administrator can choose for networks that drop the negotiated one. */
export const SMALL_VIDEO_PACKET_SIZE = 1128;

/** Adapts separate SDK elementary streams into independently failing HomeKit SRTP outputs. */
export class FfmpegLiveMedia implements LiveMediaAdapter {
  constructor(
    private readonly executable: string,
    private readonly adaptationDiagnostics?: AdaptationDiagnostics,
    private readonly createProcess: LiveMediaProcessFactory = spawnLiveMediaProcess,
    private readonly reservePort: MediaPortFactory = reserveMediaPort,
    private readonly createReturnAudioProcess: ReturnAudioProcessFactory = spawnReturnAudioProcess,
    private readonly maxVideoPacketSize = Number.POSITIVE_INFINITY,
    private readonly copyVideo = false,
    private readonly constantQuality = false,
  ) {}

  /**
   * Each hardware encoder's qualified selections, as `profile@level`, for the rest of this run.
   *
   * A spawn reads it, so a selection is served by hardware from the moment it qualifies, and an encoder that
   * exits before output in a session is removed from it and serves nothing again.
   */
  private readonly qualified = new Map<string, Set<string>>();

  /**
   * Qualifies every hardware encoder `host`'s binary may carry against every selection it is qualified for,
   * one run after another and within {@link QUALIFICATION_BUDGET_MS}, and returns each tried encoder's
   * outcome per `profile@level`.
   *
   * Until a selection qualifies it is coded by `libx264`, and a selection no encoder qualifies for stays there.
   */
  async qualify(
    host: EncoderHost,
    run: QualificationRun = runQualification,
  ): Promise<Record<string, Record<string, QualificationOutcome>>> {
    const deadline = Date.now() + QUALIFICATION_BUDGET_MS;
    const outcomes: Record<string, Record<string, QualificationOutcome>> = {};
    for (const encoder of HARDWARE_ENCODERS.filter((candidate) => candidate.triedOn(host))) {
      const tried: Record<string, QualificationOutcome> = (outcomes[encoder.name] = {});
      for (const selection of QUALIFICATION_SELECTIONS) {
        const key = `${selection.profile}@${selection.level}`;
        tried[key] = await qualification(this.executable, encoder, selection, run, deadline);
        if (tried[key] === 'qualified') {
          this.qualified.set(encoder.name, (this.qualified.get(encoder.name) ?? new Set<string>()).add(key));
        }
      }
    }
    return outcomes;
  }

  /**
   * What a session codes `selection` from a `codec` source with: `copy` for a passed-through H.264 source,
   * {@link CONSTANT_QUALITY} where the negotiated bit rate is ignored, else the first hardware encoder qualified
   * for `selection`, or `libx264` where none is or `settings` turn hardware off. Without `settings`, this
   * adapter's own.
   */
  private encoderFor(
    codec: LiveVideoConfig['codec'],
    selection: NegotiatedLiveVideo,
    settings?: LiveVideoSettings,
  ): LiveVideoEncoder | 'copy' {
    if ((settings?.liveVideoPassthrough ?? this.copyVideo) && codec === 'h264') return 'copy';
    if (settings?.ignoreHomeBitRate ?? this.constantQuality) return CONSTANT_QUALITY;
    if (settings?.hardwareVideoEncoder === false) return LIBX264;
    const key = `${selection.profile}@${selection.level}`;
    return HARDWARE_ENCODERS.find((encoder) => this.qualified.get(encoder.name)?.has(key)) ?? LIBX264;
  }

  /** The largest video packet a session sends under `settings`, or under this adapter's own without them. */
  private packetSize(settings?: LiveVideoSettings): number {
    if (!settings) return this.maxVideoPacketSize;
    return settings.smallVideoPackets ? SMALL_VIDEO_PACKET_SIZE : Number.POSITIVE_INFINITY;
  }

  /**
   * The encoder and the argument list a session would code `selection` from a `codec` source with, its video
   * written to `output` instead of RTP: every argument before `output` is the session's own, or that of a session
   * of an adapter configured with `settings`.
   */
  videoAdaptation(
    codec: LiveVideoConfig['codec'],
    selection: NegotiatedLiveVideo,
    output: readonly string[],
    settings?: LiveVideoSettings,
  ): { encoder: string; args: string[] } {
    const video = { ...selection, mtu: Math.min(selection.mtu, this.packetSize(settings)) };
    const encoder = this.encoderFor(codec, video, settings);
    return { encoder: encoder === 'copy' ? encoder : encoder.name, args: videoArguments(codec, video, encoder, output) };
  }

  /**
   * Reserves the negotiated output ports so `SetupEndpoints` can be answered with them, and returns a
   * session that holds nothing else: no SDK handle, adaptation process, or device session exists until
   * `start`. The reservation therefore lives for as long as its HomeKit consumer keeps the session, and
   * `stop` releases every reservation exactly once however the session ended.
   */
  async prepare(transport: LiveMediaTransport): Promise<PreparedLiveMedia> {
    const videoPort = await this.reservePort(transport.addressVersion);
    const targetAddress = transport.addressVersion === 'ipv6' ? `[${transport.targetAddress}]` : transport.targetAddress;
    const maxVideoPacketSize = this.packetSize(transport.liveVideoSettings);
    let audioPort: ReservedMediaPort | undefined;
    try {
      audioPort = transport.audio ? await this.reservePort(transport.addressVersion) : undefined;
    } catch (error) {
      videoPort.close();
      throw error;
    }

    let source: LiveStreamConsumer | undefined;
    /**
     * Cancels the source acquisition in flight, and is held for exactly as long as one is.
     *
     * The station's one media channel is held for the whole of an uncancelled acquisition, so a session that
     * ends during one cancels it rather than leaving it to the SDK's own wait.
     */
    let acquiring: AbortController | undefined;
    let videoProcess: MediaProcess | undefined;
    let audioProcess: MediaProcess | undefined;
    let returnAudioProcess: ReturnAudioProcess | undefined;
    let talkbackHandle: TalkbackHandle | undefined;
    let talkbackSink: Writable | undefined;
    let talkbackStarting = false;
    let talkbackEnded = false;
    let negotiated: NegotiatedLiveMedia | undefined;
    let stopped = false;
    let receivedVideoKeyframe = false;
    /**
     * The coded configuration the source last announced, and the one the running adaptation was opened for.
     *
     * Both, rather than a flag, because only a difference between them is a reason to replace an adaptation:
     * announcements arrive before the first keyframe has opened one, and a configuration that moves away and
     * back leaves the running adaptation still able to code what follows. What counts as a difference is
     * {@link canCode}.
     */
    let videoConfig: LiveVideoConfig | undefined;
    let adaptationConfig: LiveVideoConfig | undefined;
    /** How many adaptation replacements the source's own changes have asked this session for. */
    let sourceInputReplacements = 0;
    let audioInputCodec: LiveAudioFrame['codec'] | undefined;
    let rtcpDeadline: ReturnType<typeof setTimeout> | undefined;
    let initialRtcpGrace: ReturnType<typeof setTimeout> | undefined;
    let videoStartBackstop: ReturnType<typeof setTimeout> | undefined;
    let videoFailed = false;
    let rtcpObserved = false;
    /** How many receiver reports this session was acknowledged by, and when the last one arrived. */
    /** Why the video adaptation now running was started, which the record reporting it carries. */
    let videoCause: AdaptationCause = 'first';
    /** Where the next adaptation this session sends on starts its RTP sequence, advanced for every one. */
    let videoSequence = 0;
    let rtcpReports = 0;
    let lastRtcpAt: number | undefined;
    let streaming = false;
    const stoppingProcesses = new WeakSet<object>();
    const congested = new Set<Writable>();
    const { adaptationDiagnostics } = this;

    /**
     * Releases one adaptation input's claim on the source, whether it drained or stopped existing.
     *
     * An adaptation that is replaced or exits while full never emits the `drain` its claim is waiting for, so
     * discharging the claim is part of ending the process rather than something only a successful drain does:
     * otherwise one stalled process that a geometry change already replaced would hold the source for the
     * rest of the session. It is idempotent and claimed from both directions — the process ending, and its
     * input closing — because an adaptation can stop either way and neither alone covers both.
     */
    const releaseAdaptation = (sink: Writable): void => {
      if (congested.delete(sink) && !stopped && congested.size === 0) {
        source?.resume();
      }
    };

    /**
     * Writes one media payload to an adaptation, holding the SDK source while that input stays full.
     *
     * A discarded write result relocates a keyframe-aware bounded queue in the SDK into a byte-blind pipe
     * buffer, which then grows in plugin heap for the life of the session and stalls the event loop with it.
     * Holding the source instead arms the SDK's own drop-to-keyframe policy, so a session that cannot keep up
     * resynchronises on decodable media rather than replaying a stale backlog.
     *
     * One source feeds both adaptations, so it is held while *any* of them is full and released only once
     * every one has drained. That keeps a single source of truth for backpressure on this path: no queue,
     * threshold, or drop rule is invented here.
     */
    const writeToAdaptation = (sink: Writable, data: Buffer): void => {
      if (sink.write(data) || congested.has(sink)) {
        return;
      }
      congested.add(sink);
      if (congested.size === 1) {
        source?.pause();
      }
      sink.once('drain', () => releaseAdaptation(sink));
    };

    const reportAdaptation = adaptationReporter(adaptationDiagnostics);

    const stopAdaptation = (process: MediaProcess | undefined): void => {
      if (!process) {
        return;
      }
      stoppingProcesses.add(process);
      stopProcess(process);
      releaseAdaptation(process.stdin);
    };
    /** Stop a caller-owned SDK handle without allowing synchronous or asynchronous faults to abort cleanup. */
    const stopTalkbackHandle = (handle: TalkbackHandle): void => {
      try {
        void handle.stop().catch(() => undefined);
      } catch {}
    };
    const stopTalkback = (stopHandle = true): void => {
      if (talkbackEnded) {
        return;
      }
      talkbackEnded = true;
      stopAdaptation(returnAudioProcess);
      returnAudioProcess?.stdout.destroy();
      returnAudioProcess?.eld.destroy();
      returnAudioProcess = undefined;
      talkbackSink?.destroy();
      talkbackSink = undefined;
      const handle = talkbackHandle;
      talkbackHandle = undefined;
      if (stopHandle && handle) {
        stopTalkbackHandle(handle);
      }
    };
    const failTalkback = (reason: TalkbackFailure): void => {
      if (stopped || talkbackEnded) {
        return;
      }
      transport.onTalkbackOutcome?.({ outcome: 'failed', reason });
      stopTalkback();
    };
    const stop = (): void => {
      if (stopped) {
        return;
      }
      stopped = true;
      acquiring?.abort(new Error('live media session stopped'));
      clearTimeout(rtcpDeadline);
      clearTimeout(initialRtcpGrace);
      clearTimeout(videoStartBackstop);
      stopTalkback();
      stopAdaptation(videoProcess);
      stopAdaptation(audioProcess);
      source?.stop();
      if (negotiated) {
        transport.onSessionReleased?.(
          videoFailed ? 'failed' : 'requested',
          {
            reports: rtcpReports,
            ...(lastRtcpAt === undefined ? {} : { sinceLastReportMs: Date.now() - lastRtcpAt }),
          },
          ...(source === undefined ? (['sdk-source-acquisition'] as const) : []),
        );
      }
      videoPort.close();
      audioPort?.close();
    };
    const failVideo = (reason: LiveSessionFailure, error?: unknown): void => {
      if (stopped || videoFailed) {
        return;
      }
      videoFailed = true;
      stop();
      const warmUp = error instanceof LiveStreamStartError;
      const stage =
        reason === 'source-acquisition-timeout' || source === undefined
          ? 'sdk-source-acquisition'
          : reason === 'rtcp-timeout'
            ? 'controller-rtcp'
            : warmUp || !receivedVideoKeyframe
              ? 'first-source-keyframe'
              : 'first-adapted-output';
      transport.onSessionOutcome?.({
        outcome: 'failed',
        reason,
        stage,
        ...(warmUp ? { sourceStage: error.stage, sourceReason: error.reason } : {}),
      });
      transport.onVideoFailure?.();
    };
    /**
     * RTCP liveness bounds a session that is already sending media. Before adaptation reaches the
     * negotiated output the start backstop owns the bound, so an early datagram only records that the
     * controller is present; arming the recurring deadline here would fail a source that legitimately
     * warms for longer than one RTCP interval.
     */
    const resetRtcpDeadline = (): void => {
      rtcpObserved = true;
      rtcpReports += 1;
      lastRtcpAt = Date.now();
      clearTimeout(initialRtcpGrace);
      clearTimeout(rtcpDeadline);
      if (!streaming) {
        return;
      }
      const interval = Math.max(negotiated?.video.rtcpInterval ?? 1, 1) * 5_000;
      rtcpDeadline = setTimeout(() => failVideo('rtcp-timeout'), interval);
      rtcpDeadline.unref?.();
    };
    videoPort.onMessage(resetRtcpDeadline);
    /**
     * Adaptation reached the negotiated output, so the session is bounded from here by RTCP liveness
     * rather than by the start backstop. The initial grace is armed from this point because media may
     * legitimately start well after the session does.
     */
    const observeAdaptationProgress = (): void => {
      if (stopped) {
        return;
      }
      clearTimeout(videoStartBackstop);
      videoStartBackstop = undefined;
      if (streaming) {
        return;
      }
      streaming = true;
      if (rtcpObserved) {
        resetRtcpDeadline();
      } else {
        initialRtcpGrace = setTimeout(() => failVideo('rtcp-timeout'), INITIAL_RTCP_GRACE_MS);
        initialRtcpGrace.unref?.();
      }
      transport.onSessionOutcome?.({ outcome: 'streaming' });
    };

    /**
     * Records the coded configuration the source is about to deliver. Nothing is replaced here: a replacement
     * can only start on a keyframe, and this arrives ahead of the frame carrying the new configuration.
     */
    const observeVideoConfig = (config: LiveVideoConfig): void => {
      videoConfig = config;
    };

    /**
     * Writes one source access unit to the adaptation that is entitled to code it.
     *
     * A source configuration the running adaptation was not opened for cannot be coded by it at all, so those
     * frames wait for the keyframe that lets a replacement start.
     *
     * Source-driven replacement is bounded by {@link MAX_SOURCE_INPUT_REPLACEMENTS}, past which the session
     * fails rather than spawn again. It is the only replacement a session makes: a source that changes what it
     * delivers cannot be coded by the running process at all, whereas a controller's renegotiated selection is
     * a request this session declines in favour of the one it started on.
     */
    const writeVideo = (frame: LiveVideoFrame): void => {
      if (stopped || !negotiated || !videoConfig) {
        return;
      }
      if (!receivedVideoKeyframe) {
        if (!frame.keyframe) {
          return;
        }
        receivedVideoKeyframe = true;
      }
      const inputChanged = adaptationConfig !== undefined && !canCode(adaptationConfig, videoConfig);
      if (videoProcess && inputChanged && !frame.keyframe) {
        return;
      }
      if (videoProcess && frame.keyframe && inputChanged) {
        sourceInputReplacements += 1;
        if (sourceInputReplacements > MAX_SOURCE_INPUT_REPLACEMENTS) {
          failVideo('source-input-unstable');
          return;
        }
        videoCause = 'source-configuration';
        stopAdaptation(videoProcess);
        videoProcess = undefined;
      }
      if (!videoProcess) {
        adaptationConfig = videoConfig;
        videoSequence = (videoSequence + OUTPUT_SEQUENCE_STEP) & 0xffff;
        const { video } = negotiated;
        const encoder = this.encoderFor(videoConfig.codec, video, transport.liveVideoSettings);
        const child = this.createProcess(
          this.executable,
          videoArguments(
            videoConfig.codec,
            video,
            encoder,
            outputArguments(targetAddress, transport.video, video.payloadType, video.ssrc, video.mtu, videoSequence),
          ),
        );
        videoProcess = child;
        const encoderName = encoder === 'copy' ? encoder : encoder.name;
        adaptationDiagnostics?.report({
          role: 'live-video',
          event: 'started',
          cause: videoCause,
          encoder: encoderName,
          source: videoConfig.codec,
          sourceWidth: videoConfig.width,
          sourceHeight: videoConfig.height,
        });
        const stderr = new AdaptationStderr();
        let producedOutput = false;
        child.stderr.on('data', (chunk: Buffer) => {
          if (stderr.observe(chunk).some((line) => line.startsWith('progress='))) {
            producedOutput = true;
            observeAdaptationProgress();
          }
        });
        child.stdin.on('error', () => {
          if (!stoppingProcesses.has(child)) {
            reportAdaptation('live-video', 'input-failed', stderr);
            failVideo('adaptation-failed');
          }
        });
        child.stdin.on('close', () => releaseAdaptation(child.stdin));
        child.on('error', () => {
          if (!stoppingProcesses.has(child)) {
            reportAdaptation('live-video', producedOutput ? 'exited-while-streaming' : 'spawn-failed', stderr);
            failVideo(producedOutput ? 'adaptation-exited-while-streaming' : 'adaptation-spawn-failed');
          }
        });
        child.on('exit', (code, signal) => {
          if (stopped || stoppingProcesses.has(child)) {
            reportAdaptation('live-video', 'output', stderr, code, signal);
            return;
          }
          reportAdaptation(
            'live-video',
            producedOutput ? 'exited-while-streaming' : 'exited-before-output',
            stderr,
            code,
            signal,
          );
          if (!producedOutput && this.qualified.delete(encoderName)) {
            adaptationDiagnostics?.report({ role: 'live-video', event: 'encoder-disqualified', encoder: encoderName });
          }
          failVideo(producedOutput ? 'adaptation-exited-while-streaming' : 'adaptation-exited-before-output');
        });
      }
      writeToAdaptation(videoProcess.stdin, frame.data);
    };

    const writeAudio = (frame: LiveAudioFrame): void => {
      if (stopped || !negotiated?.audio || !transport.audio || !audioPort) {
        return;
      }
      if (!audioProcess) {
        audioInputCodec = frame.codec;
        const child = this.createProcess(
          this.executable,
          audioArguments(frame, negotiated.audio, targetAddress, transport.audio),
        );
        audioProcess = child;
        if (frame.config) {
          writeToAdaptation(child.stdin, Buffer.concat([FLV_FILE_HEADER, flvAacTag(0, frame.config)]));
        }
        adaptationDiagnostics?.report({ role: 'live-audio', event: 'started' });
        const stderr = new AdaptationStderr();
        let producedOutput = false;
        child.stderr.on('data', (chunk: Buffer) => {
          if (stderr.observe(chunk).some((line) => line.startsWith('progress='))) {
            producedOutput = true;
          }
        });
        /**
         * An audio adaptation is dropped rather than failed, so its own end has to discharge whatever claim
         * it held on the source. Nothing else would if its input outlives it: the `drain` a full input is
         * waiting for never arrives, and the video beside it would starve.
         */
        const clearChild = (): void => {
          releaseAdaptation(child.stdin);
          if (audioProcess === child) {
            audioProcess = undefined;
          }
        };
        child.stdin.on('close', () => releaseAdaptation(child.stdin));
        child.stdin.on('error', () => {
          if (!stoppingProcesses.has(child) && audioProcess === child) {
            reportAdaptation('live-audio', 'input-failed', stderr);
          }
          stopAdaptation(child);
          clearChild();
        });
        child.on('error', () => {
          if (!stoppingProcesses.has(child)) {
            reportAdaptation('live-audio', producedOutput ? 'exited-while-streaming' : 'spawn-failed', stderr);
          }
          stopAdaptation(child);
          clearChild();
        });
        child.on('exit', (code, signal) => {
          reportAdaptation(
            'live-audio',
            stopped || stoppingProcesses.has(child)
              ? 'output'
              : producedOutput
                ? 'exited-while-streaming'
                : 'exited-before-output',
            stderr,
            code,
            signal,
          );
          clearChild();
        });
      }
      if (audioInputCodec !== frame.codec) {
        stopAdaptation(audioProcess);
        audioProcess = undefined;
        audioInputCodec = undefined;
        writeAudio(frame);
        return;
      }
      writeToAdaptation(audioProcess.stdin, frame.config ? flvAacTag(1, frame.data) : frame.data);
    };

    /**
     * Write one decoded return-audio chunk through the SDK writable that owns ADTS frame recovery,
     * validation, pacing, and transport backpressure. The first chunk opens exactly one SDK handle;
     * stdout stays paused while that handle is acquired so acquisition cannot create an unbounded queue.
     * Once the handle's `codec` is `aac-eld`, ADTS output is discarded and fd 3 feeds the handle instead.
     */
    const writeReturnAudio = (camera: LiveMediaSource, child: ReturnAudioProcess, chunk: Buffer): void => {
      if (stopped || talkbackEnded) {
        return;
      }
      if (talkbackSink) {
        if (talkbackHandle?.codec === 'aac-eld') {
          return;
        }
        try {
          if (!talkbackSink.write(chunk)) {
            child.stdout.pause();
            talkbackSink.once('drain', () => {
              if (!stopped && !talkbackEnded) {
                child.stdout.resume();
              }
            });
          }
        } catch {
          failTalkback('device-audio-failed');
        }
        return;
      }
      if (talkbackStarting || !camera.talkback) {
        return;
      }
      talkbackStarting = true;
      child.stdout.pause();
      let acquisition: Promise<TalkbackHandle>;
      try {
        acquisition = camera.talkback();
      } catch {
        failTalkback('source-unavailable');
        return;
      }
      void acquisition.then(
        (handle) => {
          if (stopped || talkbackEnded) {
            stopTalkbackHandle(handle);
            return;
          }
          talkbackHandle = handle;
          try {
            const sink = handle.writable();
            talkbackSink = sink;
            handle.on('budget', (notice) => {
              if (!stopped && !talkbackEnded) {
                notice.extend();
              }
            });
            handle.on('error', () => failTalkback('device-audio-failed'));
          handle.on('stop', () => {
            if (!stopped && !talkbackEnded && talkbackHandle === handle) {
              failTalkback('device-audio-failed');
            }
          });
            sink.on('error', () => failTalkback('device-audio-failed'));
            if (handle.codec === 'aac-eld') {
              const reader = new FlvAacReader();
              child.eld.on('data', (eldChunk: Buffer) => writeReturnFrames(child, reader, sink, eldChunk));
              child.stdout.resume();
              transport.onTalkbackOutcome?.({ outcome: 'talking' });
              return;
            }
            child.eld.resume();
            const accepted = sink.write(chunk);
            if (talkbackEnded) {
              return;
            }
            transport.onTalkbackOutcome?.({ outcome: 'talking' });
            if (accepted) {
              child.stdout.resume();
            } else {
              sink.once('drain', () => {
                if (!stopped && !talkbackEnded) {
                  child.stdout.resume();
                }
              });
            }
          } catch {
            failTalkback('device-audio-failed');
          }
        },
        () => failTalkback('source-unavailable'),
      );
    };

    /**
     * Write the access units completed by one ELD output chunk through the SDK's object-mode writable,
     * holding fd 3 from the first refusal until that writable drains. What stays buffered is the SDK's
     * bounded pacing queue and at most the rest of the one read that was in hand. A write that fails or
     * ends the talkback stops the loop.
     */
    const writeReturnFrames = (child: ReturnAudioProcess, reader: FlvAacReader, sink: Writable, chunk: Buffer): void => {
      for (const data of reader.push(chunk)) {
        if (stopped || talkbackEnded) {
          return;
        }
        if (!sink.write(data) && !child.eld.isPaused()) {
          child.eld.pause();
          sink.once('drain', () => {
            if (!stopped && !talkbackEnded) {
              child.eld.resume();
            }
          });
        }
      }
    };

    /**
     * Hand the accessory audio endpoint to FFmpeg and give the spawned process a bounded bind grace before
     * stream start is acknowledged. FFmpeg owns SRTP authentication, RTP AAC-ELD depacketization, decoding,
     * the AAC-LC ADTS encoding on stdout, and the copy of HomeKit's AAC-ELD access units on fd 3; the SDK
     * handle remains unopened until the process produces decoded audio, and the handle's `codec` then
     * selects the ADTS output (stdout) or the ELD output (fd 3).
     */
    const startReturnAudio = async (camera: LiveMediaSource, selection: NegotiatedLiveAudio | undefined): Promise<void> => {
      if (!camera.talkback || !selection || !transport.audio || !audioPort) {
        return;
      }
      if (selection.sampleRate !== 16 || selection.channels !== 1) {
        failTalkback('unsupported-selection');
        return;
      }
      try {
        await audioPort.close();
        if (stopped || talkbackEnded) {
          return;
        }
        const child = this.createReturnAudioProcess(this.executable, returnAudioArguments());
        returnAudioProcess = child;
        const stderr = new AdaptationStderr();
        let producedOutput = false;
        child.stderr.on('data', (chunk: Buffer) => stderr.observe(chunk));
        const failInput = (): void => {
          if (!stopped && !talkbackEnded && !stoppingProcesses.has(child)) {
            reportAdaptation('return-audio', 'input-failed', stderr);
            failTalkback('adaptation-failed');
          }
        };
        child.stdin.on('error', failInput);
        child.stdout.on('data', (chunk: Buffer) => {
          producedOutput = true;
          writeReturnAudio(camera, child, chunk);
        });
        child.stdout.on('error', failInput);
        child.eld.on('error', failInput);
        child.on('error', () => {
          if (!stoppingProcesses.has(child)) {
            reportAdaptation('return-audio', producedOutput ? 'exited-while-streaming' : 'spawn-failed', stderr);
            failTalkback('adaptation-failed');
          }
        });
        child.on('exit', (code, signal) => {
          if (stopped || talkbackEnded || stoppingProcesses.has(child)) {
            reportAdaptation('return-audio', 'output', stderr, code, signal);
            return;
          }
          reportAdaptation(
            'return-audio',
            producedOutput ? 'exited-while-streaming' : 'exited-before-output',
            stderr,
            code,
            signal,
          );
          failTalkback(
            !stderr.tail().some((line) => line.includes('Error during demuxing: Operation timed out'))
              ? 'adaptation-failed'
              : receivedVideoKeyframe
                ? 'no-controller-audio'
                : 'source-unavailable',
          );
        });
        child.stdin.end(returnAudioSdp(audioPort.port, selection, transport.audio, transport.addressVersion));
        await delay(RETURN_AUDIO_BIND_GRACE_MS);
      } catch {
        failTalkback('adaptation-failed');
      }
    };

    return {
      videoPort: videoPort.port,
      ...(audioPort ? { audioPort: audioPort.port } : {}),
      async start(camera, selection): Promise<void> {
        if (stopped) {
          throw new Error('live media session is already stopped');
        }
        negotiated = { ...selection, video: { ...selection.video, mtu: Math.min(selection.video.mtu, maxVideoPacketSize) } };
        const returnAudioReady = startReturnAudio(camera, selection.audio);
        let sourcePromise: Promise<LiveStreamConsumer>;
        let acquisitionDeadline: ReturnType<typeof setTimeout> | undefined;
        const acquisition = new AbortController();
        acquiring = acquisition;
        try {
          sourcePromise = camera.live({ signal: acquisition.signal });
          void sourcePromise.then(
            (lateSource) => {
              if (stopped && source !== lateSource) {
                lateSource.stop();
              }
            },
            () => undefined,
          );
          source = await Promise.race([
            sourcePromise,
            new Promise<never>((_, reject) => {
              acquisitionDeadline = setTimeout(() => reject(SOURCE_ACQUISITION_TIMEOUT), SOURCE_ACQUISITION_DEADLINE_MS);
              acquisitionDeadline.unref?.();
            }),
          ]);
        } catch (error) {
          acquisition.abort(new Error('live media source acquisition was cancelled'));
          failVideo(error === SOURCE_ACQUISITION_TIMEOUT ? 'source-acquisition-timeout' : liveSourceFailure(error), error);
          throw error === SOURCE_ACQUISITION_TIMEOUT ? new Error('live media source acquisition timed out') : error;
        } finally {
          clearTimeout(acquisitionDeadline);
          acquiring = undefined;
        }
        if (stopped) {
          source.stop();
          return;
        }
        videoStartBackstop = setTimeout(() => failVideo('no-video-within-backstop'), SOURCE_START_BACKSTOP_MS);
        videoStartBackstop.unref?.();
        source.on('video-config', observeVideoConfig);
        source.on('video', writeVideo);
        source.on('audio', writeAudio);
        source.on('budget', (notice) => {
          if (!stopped) {
            notice.extend();
          }
        });
        source.on('error', (error) => failVideo(liveSourceFailure(error), error));
        source.on('stop', () => failVideo('source-stopped'));
        await returnAudioReady;
      },
      stop,
    };
  }
}

/**
 * Options every adapted input applies to itself: a piped elementary stream, or audio framed as FLV.
 *
 * FFmpeg's initial stream analysis is the only thing standing between the first written access unit and the
 * first coded frame. The caller already declares the format, and an FLV input states its decoder config in its
 * first tag, so that analysis has nothing left to discover and is bounded to its minimum; leaving it at the
 * default delays first output by seconds and scales that delay with the source keyframe interval.
 *
 * Every such input is read on one clock: when its media arrived. An elementary stream carries no timeline of its
 * own and the FLV tags this plugin writes carry none either, so arrival is the only timeline there is, and two
 * adapted streams of one session can be presented together only while both are read on it.
 *
 * Nothing asks FFmpeg to discard or reinterpret what it read. Discarding the analysed packets throws away the
 * leading keyframe the caller waited for, and a raw A-law demuxer stops emitting timestamps entirely, so both
 * cost media that was already in hand.
 */
export function commonArguments(inputFormat: string, inputOptions: readonly string[] = []): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-probesize',
    '32',
    '-analyzeduration',
    '1',
    '-progress',
    'pipe:2',
    '-nostats',
    '-f',
    inputFormat,
    ...inputOptions,
    '-use_wallclock_as_timestamps',
    '1',
    '-i',
    'pipe:0',
  ];
}

/**
 * The RTP output one adaptation sends on: the controller's endpoint, the identity the session negotiated for
 * it, and where its sequence numbering starts.
 *
 * `sequence` is stated wherever a session may send on more than one adaptation, because the identity and the
 * SRTP key outlive the process: see {@link OUTPUT_SEQUENCE_STEP} for what a restarted numbering costs. An
 * output no replacement can follow omits it and keeps FFmpeg's own base.
 */
function outputArguments(
  targetAddress: string,
  target: LiveMediaTarget,
  payloadType: number,
  ssrc: number,
  packetSize: number,
  sequence?: number,
): string[] {
  return [
    '-payload_type',
    String(payloadType),
    '-ssrc',
    String(ssrc),
    ...(sequence === undefined ? [] : ['-seq', String(sequence)]),
    '-f',
    'rtp',
    '-srtp_out_suite',
    target.srtpCryptoSuite,
    '-srtp_out_params',
    Buffer.concat([target.srtpKey, target.srtpSalt]).toString('base64'),
    `srtp://${targetAddress}:${target.port}?rtcpport=${target.port}&pkt_size=${packetSize}`,
  ];
}

/**
 * Raw SDK frames cannot prove profile, level, frame rate, and bitrate, so negotiated video is transcoded.
 *
 * Asking FFmpeg to generate presentation timestamps rather than read the arrival ones every adapted input
 * carries makes it interpolate them from a frame rate a bare Annex-B pipe never states, which collapses the
 * whole session onto one instant; the constant-rate output then resolves the collision by discarding almost
 * every frame it was given.
 *
 * A negotiated frame rate is a CEILING, not a cadence, so the rate is bounded rather than pinned. Pinning it
 * with `-r` makes the encoder interpolate a cadence a bare Annex-B pipe never states, which collapses a session
 * onto one instant.
 *
 * The output is constant-rate, which fills a gap in arrival with a duplicate of the last picture rather than
 * carrying the gap. A duplicate costs a full encode and a share of the negotiated bit rate for a frame carrying
 * nothing new, and a source over this transport gaps as its normal case: measured on the bundled encoder against
 * a 15 fps arrival stalled 1.5 seconds after every second of media, a constant rate emitted 266 frames of which
 * 146 were duplicates, against 120 frames and none when the arrival timestamps were passed through, at the same
 * 0.90x real time either way. What the duplicates buy is a dense presentation timeline: a controller shown the
 * gaps instead displays a picture that visibly jumps at every one of them.
 *
 * `-fpsmax` states that ceiling for a constant-rate output only, and FFmpeg refuses it beside any other
 * frame-rate mode, so the two cannot be combined.
 *
 * A negotiated selection states no refresh cadence, so the keyframe interval is plugin policy: `-g` and
 * `-keyint_min` are the negotiated rate doubled and scene-cut detection is off, which is a refresh every two
 * negotiated seconds and nothing between them. It is the only repair a live session has, because this output is
 * unretransmitted SRTP over UDP and nothing here asks the encoder for a picture out of cadence, so one lost in
 * transit persists until the next refresh. What the interval costs is in docs/architecture.md.
 *
 * A negotiated bit rate is a ceiling on what the accessory TRANSMITS, so the encoder is given the ceiling less
 * the transport its own packetization adds, and its VBV buffer holds one second of that budget rather than
 * two. A buffer is an allowance a window may exceed the rate by, so a two-second buffer owes a 45-second
 * session 4.4 percent over its ceiling on arithmetic alone, before any transport is counted. An encoder coding
 * inside its ceiling still transmits over it whenever the transport is unreserved, which is what the measured
 * overshoot was; the evidence is in docs/architecture.md.
 *
 * `superfast` is the cheapest `libx264` preset that retains CABAC, and therefore the cheapest one whose
 * coded stream can carry a negotiated Main or High profile; `ultrafast` drops CABAC and codes Constrained
 * Baseline whatever `-profile:v` asks for. `-tune zerolatency` pins the same `sliced_threads`, `bframes`
 * and `rc_lookahead` at either preset, so this costs computation rather than frame delay.
 *
 * `copy` sends an H.264 source as the camera coded it, with no encoder in the process. Nothing above then holds:
 * the geometry, frame rate, bit rate, profile and keyframe interval are the camera's own, not the negotiated
 * selection. Only the RTP output is the negotiated one. An H.265 source is transcoded either way.
 *
 * {@link CONSTANT_QUALITY} codes at {@link CONSTANT_QUALITY_CRF} with no rate control, so the negotiated bit rate is not
 * honoured: the output spends what the picture needs. A controller asks 299 kbps for 720p and does not raise it
 * during a session, which the ceiling above codes as a blurred, then blocky, picture.
 */
function videoArguments(
  codec: LiveVideoConfig['codec'],
  selection: NegotiatedLiveVideo,
  encoder: LiveVideoEncoder | 'copy',
  output: readonly string[],
): string[] {
  if (encoder === 'copy') {
    return [...commonArguments('h264'), '-an', '-c:v', 'copy', ...output];
  }
  return [...commonArguments(codec === 'h265' ? 'hevc' : codec), ...encodeArguments(encoder, selection), ...output];
}

/** What one encoder is given to code `selection`, between its input and its output, in a session and in qualification alike. */
function encodeArguments(encoder: LiveVideoEncoder, selection: NegotiatedLiveVideo): string[] {
  return [
    '-an',
    '-c:v',
    encoder.name,
    ...encoder.args(selection, `${videoBudgetInsideCeiling(selection)}k`),
    '-vf',
    `scale=${selection.width}:${selection.height}:force_original_aspect_ratio=decrease,pad=${selection.width}:${selection.height}:(ow-iw)/2:(oh-ih)/2${encoder.upload ?? ''}`,
    '-fpsmax',
    String(selection.fps),
    '-g',
    String(selection.fps * 2),
    '-keyint_min',
    String(selection.fps * 2),
    '-sc_threshold',
    '0',
  ];
}

/** FLV signature, version 1, the audio-only flag, header size 9, and the zero size of the tag before the first. */
const FLV_FILE_HEADER = Buffer.from([0x46, 0x4c, 0x56, 0x01, 0x04, 0x00, 0x00, 0x00, 0x09, 0x00, 0x00, 0x00, 0x00]);

/**
 * One FLV audio tag of an AAC elementary stream and its trailing size. The body is the AAC sound flags 0xaf, the AAC
 * packet type (0 for the AudioSpecificConfig, 1 for one access unit) and `payload` unchanged. The sound flags fix the
 * 44 kHz, 16-bit, stereo values the format requires; an AAC decoder takes the real parameters from the
 * AudioSpecificConfig. The timestamp, its extension and the stream id are zero: the stream carries no timeline of its
 * own, because its reader stamps every tag with the instant it arrived.
 */
function flvAacTag(packetType: 0 | 1, payload: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header[0] = 8;
  header.writeUIntBE(payload.length + 2, 1, 3);
  header[11] = 0xaf;
  header[12] = packetType;
  const previousTagSize = Buffer.alloc(4);
  previousTagSize.writeUInt32BE(13 + payload.length);
  return Buffer.concat([header, payload, previousTagSize]);
}

/**
 * Every access unit of one AAC elementary stream carried in FLV tags, in order. Bytes arrive in arbitrary pieces, so a
 * partial tag is held until the rest arrives; the sequence-header tag and non-AAC tags are skipped.
 */
class FlvAacReader {
  private held = Buffer.alloc(0);
  private headerSkipped = false;

  /** Feed the next bytes of the stream and return the access units they complete. */
  push(chunk: Buffer): Buffer[] {
    const bytes = this.held.length ? Buffer.concat([this.held, chunk]) : chunk;
    let at = 0;
    if (!this.headerSkipped) {
      if (bytes.length < FLV_FILE_HEADER.length) {
        this.held = Buffer.from(bytes);
        return [];
      }
      at = FLV_FILE_HEADER.length;
      this.headerSkipped = true;
    }
    const units: Buffer[] = [];
    while (bytes.length - at >= 11) {
      const size = bytes.readUIntBE(at + 1, 3);
      const end = at + 11 + size + 4;
      if (bytes.length < end) {
        break;
      }
      if (bytes[at] === 8 && size > 2 && bytes[at + 11] === 0xaf && bytes[at + 12] === 1) {
        units.push(Buffer.from(bytes.subarray(at + 13, at + 11 + size)));
      }
      at = end;
    }
    this.held = Buffer.from(bytes.subarray(at));
    return units;
  }
}

/**
 * The FFmpeg input format and input options for one source audio stream.
 *
 * A stream whose decoder config travels apart from its access units is framed as FLV, which states that config
 * once ahead of them, and is decoded by `libfdk_aac`, which decodes AAC-ELD in the config the SDK declares. Outside
 * such a config the SDK reports no sample rate or channel count, because a station sends neither;
 * 16 kHz mono is the assumption every Eufy client applies. Raw A-law carries nothing at all and must be told that
 * assumption, while an ADTS input states its own rate in every frame header and rejects the option outright, which
 * fails the process before it reads a byte.
 */
function audioInput(frame: LiveAudioFrame): [format: string, options: string[]] {
  if (frame.config) {
    return ['flv', ['-c:a', 'libfdk_aac']];
  }
  if (frame.codec === 'g711a') {
    return ['alaw', ['-ar', '16k', '-ac', '1']];
  }
  return ['aac', []];
}

/**
 * Adapts one source audio elementary stream to the negotiated AAC-ELD output, reading it as {@link audioInput}
 * describes.
 *
 * Asynchronous resampling is what makes this output honour the arrival clock its input is read on. An encoder
 * advances its output timeline by the samples in each coded frame it is handed, whatever timestamp arrived
 * with them, so the arrival stamp alone would move only where the timeline starts. The resampler resolves
 * every frame against that stamp instead, which bounds the output to real time however much content a source
 * hands over at once.
 *
 * It resolves an excess by DISCARDING it, so a source that hands over more audio than it has been running for
 * loses the excess permanently rather than being played back late. That is this session's policy and not an
 * accident of the filter: a live view owes its controller the newest audio, and audio which is already
 * seconds stale by the time it arrives cannot be presented beside a picture timestamped on arrival.
 *
 * The `libfdk_aac` encoder selects its transport from the requested output framing, and AAC-ELD cannot be carried in
 * ADTS, so without an explicit global header the encoder refuses to initialise at all.
 */
function audioArguments(
  frame: LiveAudioFrame,
  selection: NegotiatedLiveAudio,
  targetAddress: string,
  target: LiveMediaTarget,
): string[] {
  return [
    ...commonArguments(...audioInput(frame)),
    '-vn',
    '-c:a',
    'libfdk_aac',
    '-profile:a',
    'aac_eld',
    '-flags',
    '+global_header',
    '-af',
    'aresample=async=1',
    '-ar',
    `${selection.sampleRate}k`,
    '-ac',
    String(selection.channels),
    '-b:a',
    `${selection.maxBitRate}k`,
    ...outputArguments(targetAddress, target, selection.payloadType, selection.ssrc, 188),
  ];
}

/**
 * Decode HomeKit's controller-to-accessory AAC-ELD SRTP and emit both talkback inputs the SDK accepts: 16 kHz mono
 * AAC-LC in ADTS on stdout, and HomeKit's own AAC-ELD access units, copied unchanged, in FLV on fd 3. The opened
 * handle's `codec` names the one that is fed; the other is drained. The SDK owns frame validation, the 640-byte
 * limit and pacing, so FFmpeg produces byte streams rather than imposing another clock.
 */
function returnAudioArguments(): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-nostats',
    '-protocol_whitelist',
    'pipe,udp,rtp,crypto',
    '-f',
    'sdp',
    '-c:a',
    'libfdk_aac',
    '-i',
    'pipe:0',
    '-map',
    '0:a:0',
    '-vn',
    '-c:a',
    'libfdk_aac',
    '-profile:a',
    'aac_low',
    '-ar',
    '16k',
    '-ac',
    '1',
    '-b:a',
    '32k',
    '-f',
    'adts',
    'pipe:1',
    '-map',
    '0:a:0',
    '-vn',
    '-c:a',
    'copy',
    '-flvflags',
    'no_duration_filesize',
    '-f',
    'flv',
    'pipe:3',
  ];
}

/**
 * Describe the one return-audio RTP stream HomeKit negotiated. AAC-ELD at 16 kHz mono uses the
 * established MPEG4-GENERIC AAC-hbr configuration below; the crypto material is the audio endpoint key
 * HomeKit supplied during SetupEndpoints and no media or identity enters diagnostics.
 */
function returnAudioSdp(
  port: number,
  selection: NegotiatedLiveAudio,
  target: LiveMediaTarget,
  addressVersion: 'ipv4' | 'ipv6',
): string {
  const network = addressVersion === 'ipv6' ? 'IP6' : 'IP4';
  const address = addressVersion === 'ipv6' ? '::' : '0.0.0.0';
  const key = Buffer.concat([target.srtpKey, target.srtpSalt]).toString('base64');
  return [
    'v=0',
    `o=- 0 0 IN ${network} ${address}`,
    's=HomeKit Return Audio',
    `c=IN ${network} ${address}`,
    't=0 0',
    `m=audio ${port} RTP/AVP ${selection.payloadType}`,
    `b=AS:${selection.maxBitRate}`,
    `a=rtpmap:${selection.payloadType} MPEG4-GENERIC/16000/1`,
    `a=fmtp:${selection.payloadType} profile-level-id=1;mode=AAC-hbr;sizelength=13;indexlength=3;indexdeltalength=3; config=F8F0212C00BC00`,
    `a=crypto:1 ${target.srtpCryptoSuite} inline:${key}`,
    'a=rtcp-mux',
    '',
  ].join('\r\n');
}

function spawnLiveMediaProcess(executable: string, args: readonly string[]): MediaProcess {
  return spawn(executable, args, { stdio: ['pipe', 'ignore', 'pipe'] });
}

function spawnReturnAudioProcess(executable: string, args: readonly string[]): ReturnAudioProcess {
  const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
  return Object.assign(child, { eld: child.stdio[3] as Readable });
}

function reserveMediaPort(addressVersion: 'ipv4' | 'ipv6'): Promise<ReservedMediaPort> {
  return new Promise((resolve, reject) => {
    const socket = createSocket(addressVersion === 'ipv6' ? 'udp6' : 'udp4');
    socket.once('error', reject);
    socket.bind(0, () => {
      const address = socket.address();
      socket.removeListener('error', reject);
      let closing: Promise<void> | undefined;
      resolve({
        port: address.port,
        onMessage: (listener) => socket.on('message', listener),
        close: () =>
          (closing ??= new Promise<void>((done) => {
            socket.close(done);
          })),
      });
    });
  });
}
