import { type ChildProcess, spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

import type { LiveStreamConsumer, LiveVideoFrame } from '@mega-yfue/eufy-sdk';

import type { LivePreviewAdaptation } from '../configuration.js';
import type { AdaptationDiagnostics, AdaptationRole, LiveMediaSource, NegotiatedLiveVideo } from './contracts.js';
import {
  adaptationReporter,
  AdaptationStderr,
  commonArguments,
  type FfmpegLiveMedia,
  stopProcess,
} from './live-stream.js';

/** How long one preview runs before it ends on its own, so a page left open does not hold a camera. */
const LIVE_PREVIEW_MAX_MS = 3 * 60_000;

/** How long coded video may flow without decoding to a picture before the HomeKit side ends as unplayable. */
export const LIVE_PREVIEW_PICTURE_MS = 10_000;

/** The most bytes one picture may reach before FFmpeg's output is taken as no longer pictures. */
const MAX_PICTURE_BYTES = 1024 * 1024;

const JPEG_END = Buffer.from([0xff, 0xd9]);

/** The JPEG output both preview sides are decoded into: five pictures a second, 640 pixels wide, on stdout. */
const STILLS = ['-an', '-vf', 'fps=5,scale=640:-2', '-q:v', '8', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'];

/** Which picture a preview still shows: the camera's own, or the camera coded as HomeKit receives it. */
type LivePreviewSide = 'raw' | 'homekit';

/**
 * How one run of a preview's HomeKit side ended, and what it was coded with: `picture` showed at least one
 * HomeKit picture, `stopped` was stopped or restarted before one, `unplayable` showed the camera but no HomeKit
 * picture, and `no-video` ended without even a camera picture.
 */
interface LivePreviewResult extends LivePreviewAdaptation {
  outcome: 'picture' | 'unplayable' | 'no-video' | 'stopped';
  selection: Pick<NegotiatedLiveVideo, 'profile' | 'level' | 'width' | 'height' | 'fps' | 'maxBitRate'>;
  encoder?: string;
  source?: LiveVideoFrame['codec'];
  kbps?: number;
}

/** What an iPhone asks a camera for, on Wi-Fi and on cellular: High 4.0 at 30 fps over a 1378-byte MTU. */
const IPHONE = { fps: 30, profile: 'high', level: '4.0', payloadType: 99, ssrc: 1, mtu: 1378, rtcpInterval: 0.5 } as const;
const IPHONE_ASKS: Record<LivePreviewAdaptation['ask'], NegotiatedLiveVideo> = {
  wifi: { ...IPHONE, width: 1280, height: 720, maxBitRate: 299 },
  cellular: { ...IPHONE, width: 640, height: 360, maxBitRate: 132 },
};

/** One run of a preview's HomeKit side: its encoder and decoder, what it coded with, and the pictures it showed. */
interface HomeKitRun {
  processes: ChildProcess[];
  coding: { encoder: string; kbps?: number };
  pictures: number;
  pictureless?: ReturnType<typeof setTimeout>;
}

/**
 * A camera's live video as JPEG pictures for the settings page, five a second and 640 pixels wide, on two sides:
 * `raw` decoded straight from the camera, and `homekit` coded as a live session configured with `adaptation`
 * codes it for that iPhone ask, and decoded again.
 *
 * Each picture carries its side, the encoder of the HomeKit side and, once that has written for a second, the
 * kilobits a second it wrote.
 *
 * The SDK source is fanned out to two FFmpegs: one decodes it into the `raw` pictures, one runs the session's own
 * encoder and argument list and writes the coded H.264 elementary stream, which a third decodes into the
 * `homekit` pictures. The camera side starts at the first keyframe, and each HomeKit run at a keyframe too. No
 * audio. A write either refuses holds the SDK source until it drains, so the SDK's keyframe-aware queue is the
 * only one, and the HomeKit decoder holds the encoder the same way.
 *
 * `adapt` ends the HomeKit run and starts the next with other settings at the next keyframe, leaving the source
 * and the camera side running. A HomeKit run that fails, or yields no picture within
 * {@link LIVE_PREVIEW_PICTURE_MS}, ends alone with an empty `homekit` picture while the camera side showed, and
 * no other starts until `adapt`. `onRun` is called once with each run's result, and with one result where none
 * started. A codec change, a source or camera side failure, the time limit and `stop` end the whole preview, and
 * `onEnd` is called exactly once, saying whether the last run was unplayable. `diagnostics` receives each
 * process's `started` and `output` notices as a live session's do, under the `preview-raw`, `preview-encode` and
 * `preview-decode` roles.
 */
export function startLivePreview(
  executable: string,
  media: Pick<FfmpegLiveMedia, 'videoAdaptation'>,
  source: LiveMediaSource,
  adaptation: LivePreviewAdaptation,
  onPicture: (jpeg: Buffer, coding: { side: LivePreviewSide; encoder: string; kbps?: number }) => void,
  onRun: (result: LivePreviewResult) => void,
  onEnd: (unplayable: boolean) => void,
  diagnostics?: AdaptationDiagnostics,
): { stop(): void; adapt(next: LivePreviewAdaptation): void } {
  const report = adaptationReporter(diagnostics);
  const abandonment = new AbortController();
  let live: LiveStreamConsumer | undefined;
  let raw: ChildProcess | undefined;
  let rawPictures = 0;
  let codec: LiveVideoFrame['codec'] | undefined;
  let homekit: HomeKitRun | undefined;
  let latest: HomeKitRun | undefined;
  let wanted = true;
  let last: LivePreviewResult | undefined;
  let ended = false;
  const finish = (stopped: boolean): void => {
    const run = homekit;
    homekit = undefined;
    clearTimeout(run?.pictureless);
    run?.processes.forEach(stopProcess);
    const { profile, level, width, height, fps, maxBitRate } = IPHONE_ASKS[adaptation.ask];
    last = {
      outcome: run?.pictures ? 'picture' : stopped ? 'stopped' : rawPictures ? 'unplayable' : 'no-video',
      selection: { profile, level, width, height, fps, maxBitRate },
      ...adaptation,
      ...(run ? { encoder: run.coding.encoder } : {}),
      ...(codec ? { source: codec } : {}),
      ...(run?.coding.kbps === undefined ? {} : { kbps: run.coding.kbps }),
    };
    onRun(last);
  };
  const end = (stopped = false): void => {
    if (ended) return;
    ended = true;
    clearTimeout(deadline);
    abandonment.abort();
    try {
      live?.stop();
    } catch {
      live = undefined;
    }
    if (homekit || !last) finish(stopped);
    if (raw) stopProcess(raw);
    onEnd(last?.outcome === 'unplayable');
  };
  const fail = (): void => {
    if (!rawPictures) return end();
    const encoder = homekit!.coding.encoder;
    finish(false);
    onPicture(Buffer.alloc(0), { side: 'homekit', encoder });
  };
  const deadline = setTimeout(() => end(), LIVE_PREVIEW_MAX_MS);
  deadline.unref();

  const spawnRole = (role: AdaptationRole, args: string[]): ChildProcess => {
    const process = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stderr = new AdaptationStderr();
    const lost = (): void => {
      if (process === raw) end();
      else if (homekit?.processes.includes(process)) fail();
    };
    process.stderr!.on('data', (chunk: Buffer) => stderr.observe(chunk));
    process.once('error', lost);
    process.once('exit', (code, signal) => {
      report(role, 'output', stderr, code, signal);
      lost();
    });
    process.stdin!.on('error', lost);
    return process;
  };

  const stills = (output: Readable, side: LivePreviewSide, run?: HomeKitRun): void => {
    let pending = Buffer.alloc(0);
    output.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      for (let at = pending.indexOf(JPEG_END); at !== -1; at = pending.indexOf(JPEG_END)) {
        if (run && run !== homekit) return;
        if (run) {
          clearTimeout(run.pictureless);
          run.pictures += 1;
        } else rawPictures += 1;
        onPicture(pending.subarray(0, at + JPEG_END.length), { side, ...(run ?? latest)!.coding });
        pending = pending.subarray(at + JPEG_END.length);
      }
      if (pending.length > MAX_PICTURE_BYTES) end();
    });
  };

  const startHomeKit = (input: LiveVideoFrame['codec']): HomeKitRun => {
    const ask = IPHONE_ASKS[adaptation.ask];
    const { encoder, args } = media.videoAdaptation(input, ask, ['-f', 'h264', 'pipe:1'], adaptation);
    const cause = last ? 'controller-selection' : 'first';
    diagnostics?.report({ role: 'preview-encode', event: 'started', cause, encoder, source: input });
    const encoding = spawnRole('preview-encode', args);
    diagnostics?.report({ role: 'preview-decode', event: 'started', cause, source: 'h264' });
    const decoding = spawnRole('preview-decode', [...commonArguments('h264'), ...STILLS]);
    const run: HomeKitRun = { processes: [encoding, decoding], coding: { encoder }, pictures: 0 };
    let firstCodedAt: number | undefined;
    let countedBytes = 0;
    encoding.stdout!.on('data', (chunk: Buffer) => {
      const now = Date.now();
      if (firstCodedAt === undefined) {
        firstCodedAt = now;
        run.pictureless = setTimeout(() => run === homekit && fail(), LIVE_PREVIEW_PICTURE_MS);
        run.pictureless.unref();
        return;
      }
      countedBytes += chunk.length;
      if (now - firstCodedAt >= 1_000) run.coding.kbps = Math.round((countedBytes * 8) / (now - firstCodedAt));
    });
    encoding.stdout!.pipe(decoding.stdin!);
    stills(decoding.stdout!, 'homekit', run);
    return (latest = run);
  };

  source.live({ signal: abandonment.signal }).then(
    (consumer) => {
      if (ended) {
        consumer.stop();
        return;
      }
      live = consumer;
      consumer.on('error', () => end());
      consumer.on('stop', () => end());
      consumer.on('budget', (notice) => notice.extend());
      let held = 0;
      const feed = (stdin: Writable, data: Buffer): void => {
        if (stdin.write(data)) return;
        held += 1;
        consumer.pause();
        const release = (): void => {
          stdin.off('drain', release).off('close', release);
          if (--held === 0) consumer.resume();
        };
        stdin.on('drain', release).on('close', release);
      };
      consumer.on('video', (frame: LiveVideoFrame) => {
        if (ended) return;
        if (!raw) {
          if (!frame.keyframe) return;
          codec = frame.codec;
          diagnostics?.report({ role: 'preview-raw', event: 'started', cause: 'first', source: codec });
          raw = spawnRole('preview-raw', [...commonArguments(codec === 'h265' ? 'hevc' : codec), ...STILLS]);
          stills(raw.stdout!, 'raw');
        }
        if (frame.codec !== codec) return end();
        if (wanted && frame.keyframe) {
          wanted = false;
          homekit = startHomeKit(codec);
        }
        feed(raw.stdin!, frame.data);
        if (homekit) feed(homekit.processes[0]!.stdin!, frame.data);
      });
    },
    () => end(),
  );
  return {
    stop: () => end(true),
    adapt: (next) => {
      if (ended) return;
      if (homekit) finish(true);
      adaptation = next;
      wanted = true;
    },
  };
}
