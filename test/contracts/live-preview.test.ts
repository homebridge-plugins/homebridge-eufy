import { EventEmitter } from 'node:events';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LiveStreamConsumer } from '@mega-yfue/eufy-sdk';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { LivePreviewAdaptation } from '../../src/configuration.js';
import type { AdaptationNotice } from '../../src/media/contracts.js';
import { LIVE_PREVIEW_PICTURE_MS, startLivePreview } from '../../src/media/live-preview.js';
import { FfmpegLiveMedia } from '../../src/media/live-stream.js';

/** The live encoder picker on a host where nothing qualified, so a preview is coded by libx264. */
const media = new FfmpegLiveMedia('/synthetic/ffmpeg');

/** The default settings and the Wi-Fi ask, and the selection a run coded with them states. */
const WIFI: LivePreviewAdaptation = {
  ask: 'wifi',
  smallVideoPackets: false,
  liveVideoPassthrough: false,
  hardwareVideoEncoder: true,
  ignoreHomeBitRate: false,
};
const IPHONE_SELECTION = { profile: 'high', level: '4.0', width: 1280, height: 720, fps: 30, maxBitRate: 299 };

/** A consumer the test drives, with the members a preview uses. */
function consumer() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, { stop: vi.fn(), pause: vi.fn(), resume: vi.fn() });
}

function frame(data: number[], keyframe: boolean, codec: 'h264' | 'h265' = 'h264') {
  return { keyframe, codec, width: 640, height: 360, data: Buffer.from(data) };
}

/** A preview of a driven consumer, recording its pictures as `side hex@encoder`, its runs, its end and its notices. */
function watch(executable: string, live = consumer()) {
  const pictures: string[] = [];
  const notices: AdaptationNotice[] = [];
  const onRun = vi.fn();
  const onEnd = vi.fn();
  const preview = startLivePreview(
    executable,
    media,
    { live: async () => live as unknown as LiveStreamConsumer },
    WIFI,
    (jpeg, coding) => pictures.push(`${coding.side} ${jpeg.toString('hex')}@${coding.encoder}`),
    onRun,
    onEnd,
    { report: (notice) => notices.push(notice) },
  );
  return { live, pictures, notices, onRun, onEnd, preview };
}

describe('live preview', () => {
  let directory: string;
  /**
   * An executable standing in for the three FFmpegs that writes one progress line and echoes its input, so the coded
   * stream is the bytes written in and the pictures out of either side are those bytes.
   */
  let echo: string;
  /** The same, except that the encoder codes everything into bytes that are no picture, so only the camera side shows. */
  let garbling: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'live-preview-'));
    echo = join(directory, 'ffmpeg');
    await writeFile(echo, "#!/bin/sh\necho 'bitrate= 287.0kbits/s' >&2\nexec cat\n");
    await chmod(echo, 0o755);
    garbling = join(directory, 'garbling');
    await writeFile(garbling, '#!/bin/sh\ncase "$*" in *libx264*) printf coded; cat >/dev/null ;; esac\nexec cat\n');
    await chmod(garbling, 0o755);
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  /**
   * Nothing is adapted before the first keyframe, each JPEG end marker closes one picture carrying its side and the
   * HomeKit side's encoder, the camera's bytes reach both sides, and the stop releases the SDK source and reports
   * the run, with the settings it was coded with, and the end exactly once. Each process is reported as a live
   * session's are, `started` and then its `output`, under its preview role.
   */
  it('hands on one picture per JPEG and side from the first keyframe, and stops once', async () => {
    const { live, pictures, notices, onRun, onEnd, preview } = watch(echo);
    await vi.waitFor(() => expect(live.listenerCount('video')).toBe(1));

    live.emit('video', frame([0xff, 0xd8, 0x00, 0xff, 0xd9], false));
    live.emit('video', frame([0xff, 0xd8, 0x01, 0xff, 0xd9, 0xff, 0xd8], true));
    live.emit('video', frame([0x02, 0xff, 0xd9], false));
    await vi.waitFor(() =>
      expect(pictures.sort()).toEqual([
        'homekit ffd801ffd9@libx264',
        'homekit ffd802ffd9@libx264',
        'raw ffd801ffd9@libx264',
        'raw ffd802ffd9@libx264',
      ]),
    );

    preview.stop();
    preview.stop();
    expect(live.stop).toHaveBeenCalledOnce();
    expect(onRun).toHaveBeenCalledExactlyOnceWith({
      outcome: 'picture',
      selection: IPHONE_SELECTION,
      ...WIFI,
      encoder: 'libx264',
      source: 'h264',
    });
    expect(onEnd).toHaveBeenCalledExactlyOnceWith(false);
    await vi.waitFor(() => expect(notices).toHaveLength(6));
    expect(notices.slice(0, 3)).toEqual([
      { role: 'preview-raw', event: 'started', cause: 'first', source: 'h264' },
      { role: 'preview-encode', event: 'started', cause: 'first', encoder: 'libx264', source: 'h264' },
      { role: 'preview-decode', event: 'started', cause: 'first', source: 'h264' },
    ]);
    expect(
      notices
        .slice(3)
        .map(({ role, event, stderr }) => `${role} ${event} ${stderr?.join()}`)
        .sort(),
    ).toEqual([
      'preview-decode output bitrate= 287.0kbits/s',
      'preview-encode output bitrate= 287.0kbits/s',
      'preview-raw output bitrate= 287.0kbits/s',
    ]);
  });

  /**
   * `adapt` ends the HomeKit run alone and starts the next with the new settings at the next keyframe: the source
   * and the camera side's FFmpeg are left as they are, and each run is reported with what it was coded with.
   */
  it('restarts only the HomeKit side, at the next keyframe, with the new settings', async () => {
    const { live, pictures, notices, onRun, onEnd, preview } = watch(echo);
    await vi.waitFor(() => expect(live.listenerCount('video')).toBe(1));
    live.emit('video', frame([0xff, 0xd8, 0x01, 0xff, 0xd9], true));
    await vi.waitFor(() => expect(pictures).toHaveLength(2));

    const cellular = { ...WIFI, ask: 'cellular', ignoreHomeBitRate: true } as const;
    preview.adapt(cellular);
    expect(onRun).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outcome: 'picture', ask: 'wifi' }));
    live.emit('video', frame([0xff, 0xd8, 0x02, 0xff, 0xd9], false));
    await vi.waitFor(() => expect(pictures).toContain('raw ffd802ffd9@libx264'));
    expect(pictures, 'a HomeKit run never starts between keyframes').not.toContain('homekit ffd802ffd9@libx264');
    live.emit('video', frame([0xff, 0xd8, 0x03, 0xff, 0xd9], true));
    await vi.waitFor(() => expect(pictures).toContain('homekit ffd803ffd9@libx264'));
    preview.stop();

    expect(live.stop, 'the source ran throughout').toHaveBeenCalledOnce();
    expect(notices.filter(({ event, role }) => event === 'started' && role === 'preview-raw')).toHaveLength(1);
    expect(notices.filter(({ event }) => event === 'started').map(({ role, cause }) => `${role} ${cause}`)).toEqual([
      'preview-raw first',
      'preview-encode first',
      'preview-decode first',
      'preview-encode controller-selection',
      'preview-decode controller-selection',
    ]);
    expect(onRun).toHaveBeenLastCalledWith({
      outcome: 'picture',
      selection: { ...IPHONE_SELECTION, width: 640, height: 360, maxBitRate: 132 },
      ...cellular,
      encoder: 'libx264',
      source: 'h264',
    });
    expect(onRun).toHaveBeenCalledTimes(2);
    expect(onEnd).toHaveBeenCalledExactlyOnceWith(false);
  });

  /**
   * Coded video that decodes to no picture within its bound, while the camera side shows, ends that HomeKit run
   * alone as unplayable with an empty HomeKit picture, and the camera side plays on until stopped.
   */
  it('ends the HomeKit run as unplayable when its coded video yields no picture', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { live, pictures, onRun, onEnd, preview } = watch(garbling);
      await vi.waitFor(() => expect(live.listenerCount('video')).toBe(1));

      live.emit('video', frame([0xff, 0xd8, 0x65, 0xff, 0xd9], true));
      await vi.waitFor(() => expect(pictures).toEqual(['raw ffd865ffd9@libx264']));
      await vi.waitFor(() => expect(vi.getTimerCount(), 'the picture bound arms on the first coded bytes').toBe(2));
      vi.advanceTimersByTime(LIVE_PREVIEW_PICTURE_MS);

      expect(onRun).toHaveBeenCalledExactlyOnceWith({
        outcome: 'unplayable',
        selection: IPHONE_SELECTION,
        ...WIFI,
        encoder: 'libx264',
        source: 'h264',
      });
      expect(pictures.at(-1)).toBe('homekit @libx264');
      live.emit('video', frame([0xff, 0xd8, 0x66, 0xff, 0xd9], true));
      await vi.waitFor(() => expect(pictures.at(-1), 'the camera plays on').toBe('raw ffd866ffd9@libx264'));
      expect(live.stop).not.toHaveBeenCalled();

      preview.stop();
      expect(onRun).toHaveBeenCalledOnce();
      expect(onEnd).toHaveBeenCalledExactlyOnceWith(true);
    } finally {
      vi.useRealTimers();
    }
  });

  /** A camera whose codec changes mid-stream ends the preview rather than feeding FFmpeg a second format. */
  it('ends on a codec change', async () => {
    const { live, onEnd } = watch(echo);
    await vi.waitFor(() => expect(live.listenerCount('video')).toBe(1));

    live.emit('video', frame([0x00], true));
    live.emit('video', frame([0x00], true, 'h265'));

    expect(onEnd).toHaveBeenCalledOnce();
    expect(live.stop).toHaveBeenCalledOnce();
  });

  /** A source that never opens ends the preview with no video, and a stop before any picture says it was stopped. */
  it('ends with no video when the source cannot open, and stopped when stopped first', async () => {
    const onRun = vi.fn();
    const live = async () => Promise.reject(new Error('synthetic refusal'));
    startLivePreview(
      echo,
      media,
      { live },
      WIFI,
      () => undefined,
      onRun,
      () => undefined,
    );
    await vi.waitFor(() =>
      expect(onRun).toHaveBeenCalledExactlyOnceWith({ outcome: 'no-video', selection: IPHONE_SELECTION, ...WIFI }),
    );

    const stopped = vi.fn();
    const pending = { live: () => new Promise<never>(() => undefined) };
    startLivePreview(
      echo,
      media,
      pending,
      WIFI,
      () => undefined,
      stopped,
      () => undefined,
    ).stop();
    expect(stopped).toHaveBeenCalledExactlyOnceWith({ outcome: 'stopped', selection: IPHONE_SELECTION, ...WIFI });
  });
});
