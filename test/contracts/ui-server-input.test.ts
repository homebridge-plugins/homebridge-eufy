import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  EufyAuthenticationUiServer,
  parseAuthenticationAnswer,
  parseAuthenticationStart,
  parseDiagnosticsAuthorization,
  parseDeviceImageRequest,
  parseDeviceSettingsRequest,
  parseDeviceSettingWriteRequest,
  parseDiagnosticsUiEvent,
} from '../../src/ui/server.js';
import { resolveStorageRoot } from '../../src/storage.js';

const SUBMITTED_PASSWORD = 'synthetic-password-must-never-be-echoed';
const SUBMITTED_ANSWER = 'synthetic-challenge-answer-must-never-be-echoed';
const SUBMITTED_SERIAL = `T8410${'x'.repeat(200)}must-never-be-echoed`;

function startPayload(overrides: Record<string, unknown> = {}) {
  return {
    configuration: {
      platform: 'HomebridgeEufy',
      username: 'Guest@Example.Invalid',
      password: SUBMITTED_PASSWORD,
      country: 'us',
      trustedDeviceName: '  Synthetic Homebridge  ',
      ...overrides,
    },
  };
}

/** Asserts a rejection carries the generic message and never echoes the submitted value back. */
function expectRejection(parse: () => unknown, message: string, submitted: string) {
  let thrown: unknown;
  expect(() => {
    try {
      parse();
    } catch (error) {
      thrown = error;
      throw error;
    }
  }).toThrow(message);
  expect(JSON.stringify(thrown, Object.getOwnPropertyNames(thrown))).not.toContain(submitted);
}

describe('custom UI authentication input', () => {
  it('normalizes an accepted start payload without altering the submitted secret', () => {
    const parsed = parseAuthenticationStart(startPayload());

    expect(parsed.configuration.username).toBe('guest@example.invalid');
    expect(parsed.configuration.country).toBe('US');
    expect(parsed.configuration.trustedDeviceName).toBe('Synthetic Homebridge');
    expect(parsed.configuration.password).toBe(SUBMITTED_PASSWORD);
  });

  it('rejects a malformed start payload without echoing the submitted secret', () => {
    const rejected: unknown[] = [
      undefined,
      null,
      [],
      'string',
      {},
      { configuration: null },
      { configuration: [] },
      { configuration: 'string' },
      startPayload({ username: undefined }),
      startPayload({ username: '' }),
      startPayload({ username: `${'a'.repeat(311)}@example.invalid` }),
      startPayload({ password: undefined }),
      startPayload({ password: '' }),
      startPayload({ password: 'a'.repeat(1_025) }),
      startPayload({ password: 42 }),
      startPayload({ country: undefined }),
      startPayload({ country: 'USA' }),
      startPayload({ country: '1' }),
      startPayload({ trustedDeviceName: undefined }),
      startPayload({ trustedDeviceName: 'a'.repeat(129) }),
      startPayload({ platform: 'EufySecurity' }),
    ];

    for (const value of rejected) {
      expectRejection(() => parseAuthenticationStart(value), 'Invalid authentication request', SUBMITTED_PASSWORD);
    }
  });

  it('accepts one trimmed challenge answer per continuation field', () => {
    expect(parseAuthenticationAnswer({ answer: '  1234  ' }, 'answer')).toBe('1234');
    expect(parseAuthenticationAnswer({ code: '  654321  ' }, 'code')).toBe('654321');
  });

  it('rejects a malformed challenge continuation without echoing the submitted answer', () => {
    const rejected: unknown[] = [
      undefined,
      null,
      [],
      'string',
      {},
      { answer: '' },
      { answer: '   ' },
      { answer: 42 },
      { answer: SUBMITTED_ANSWER.repeat(4) },
      { code: '1234' },
    ];

    for (const value of rejected) {
      expectRejection(
        () => parseAuthenticationAnswer(value, 'answer'),
        'Invalid authentication continuation',
        SUBMITTED_ANSWER,
      );
    }
  });
});

describe('custom UI diagnostics input', () => {
  it('accepts only current and cached authorize payloads', () => {
    expect(parseDiagnosticsAuthorization({ profile: 'dashboard-ui' })).toEqual({
      profile: 'dashboard-ui',
      reproductionMode: 'now',
    });
    expect(parseDiagnosticsAuthorization({ profile: 'control-state', reproductionMode: 'intermittent' })).toEqual({
      profile: 'control-state',
      reproductionMode: 'intermittent',
    });

    for (const value of [
      undefined,
      [],
      { profile: 'dashboard-ui', extra: true },
      { profile: 'dashboard-ui', reproductionMode: undefined },
      { profile: 'dashboard-ui', reproductionMode: 'later' },
      { profile: 'unknown' },
      { reproductionMode: 'now' },
    ]) {
      expect(() => parseDiagnosticsAuthorization(value)).toThrow('Invalid diagnostics request');
    }
  });

  /**
   * The devices a reporter names cross a trust boundary and are persisted, so the field is accepted only as the
   * word for all of them or as a bounded list of non-empty strings. An unbounded one would be written to the
   * session as supplied.
   */
  it('accepts the affected devices as all of them or a bounded list', () => {
    expect(
      parseDiagnosticsAuthorization({
        profile: 'live-media',
        reproductionMode: 'now',
        affectedDevices: 'all',
      }),
    ).toEqual({ profile: 'live-media', reproductionMode: 'now', affectedDevices: 'all' });
    expect(
      parseDiagnosticsAuthorization({
        profile: 'live-media',
        reproductionMode: 'now',
        affectedDevices: ['T8410P0000000000'],
      }),
    ).toEqual({ profile: 'live-media', reproductionMode: 'now', affectedDevices: ['T8410P0000000000'] });

    for (const affectedDevices of [
      'every',
      [''],
      ['T8410P0000000000', 42],
      [{ serial: 'T8410P0000000000' }],
      Array.from({ length: 65 }, (_, index) => `T8410P${String(index).padStart(10, '0')}`),
      ['x'.repeat(65)],
      null,
    ]) {
      expect(() =>
        parseDiagnosticsAuthorization({ profile: 'live-media', reproductionMode: 'now', affectedDevices }),
      ).toThrow('Invalid diagnostics request');
    }
  });

  it('accepts only one allowlisted UI event field', () => {
    expect(parseDiagnosticsUiEvent({ event: 'dashboard-opened' })).toBe('dashboard-opened');

    for (const value of [
      undefined,
      [],
      {},
      { event: 'future-event' },
      { event: 'issue-observed' },
      { event: 'dashboard-opened', detail: 'must not cross the boundary' },
    ]) {
      expect(() => parseDiagnosticsUiEvent(value)).toThrow('Invalid diagnostics UI event');
    }
  });
});

describe('custom UI device image input', () => {
  /**
   * The serial names which retained image is asked for, and it arrives from the browser, so it is validated at
   * the boundary like every other submitted field. Rejection is generic and never repeats what was sent.
   */
  it('accepts one plausible serial and rejects anything else without echoing it', () => {
    expect(parseDeviceImageRequest({ serial: 'T8410P00223SYNTH' })).toBe('T8410P00223SYNTH');

    for (const value of [
      undefined,
      [],
      {},
      { serial: '' },
      { serial: 42 },
      { serial: ' T8410 ' },
      { serial: '../../../etc/passwd' },
      { serial: 'T8410P00223SYNTH', extra: true },
      { serial: SUBMITTED_SERIAL },
    ]) {
      expect(() => parseDeviceImageRequest(value)).toThrow('Invalid device image request');
      try {
        parseDeviceImageRequest(value);
      } catch (error) {
        expect((error as Error).message).not.toContain(SUBMITTED_SERIAL);
      }
    }
  });
});

describe('custom UI device settings input', () => {
  /** A settings read names one plausible serial and nothing else. */
  it('accepts a settings read for one serial only', () => {
    expect(parseDeviceSettingsRequest({ serial: 'T8000P0000000000' })).toBe('T8000P0000000000');
    for (const value of [undefined, {}, { serial: '../x' }, { serial: 'T8000P0000000000', extra: true }]) {
      expect(() => parseDeviceSettingsRequest(value)).toThrow('Invalid device settings request');
    }
  });

  /**
   * A write reaches a real device, so it names exactly a serial, one setting of the closed set and a value of the
   * type that setting takes, and anything else is refused before it leaves the custom-UI process.
   */
  it('accepts a write of one known setting with a value of its type only', () => {
    expect(
      parseDeviceSettingWriteRequest({ serial: 'T8000P0000000000', setting: 'motionDetection', value: false }),
    ).toEqual({ serial: 'T8000P0000000000', setting: 'motionDetection', value: false });
    for (const value of [
      undefined,
      { serial: 'T8000P0000000000', setting: 'motionDetection' },
      { serial: 'T8000P0000000000', setting: 'motionDetection', value: 1 },
      { serial: 'T8000P0000000000', setting: 'nightVision', value: 1.5 },
      { serial: 'T8000P0000000000', setting: 'privacy', value: true },
      { serial: '../x', setting: 'nightVision', value: 1 },
      { serial: 'T8000P0000000000', setting: 'nightVision', value: 1, extra: true },
    ]) {
      expect(() => parseDeviceSettingWriteRequest(value)).toThrow('Invalid device setting write');
    }
  });
});

describe('custom UI encoder probe endpoints', () => {
  /**
   * The read endpoint answers what host.json records and runs nothing; the probe endpoint runs the probe over the
   * hardware encoders that failed `bytes` with the recorded binary, stores its outcome beside host.json, and
   * answers with it.
   */
  it('probes the encoders turned down for size with the recorded binary', async () => {
    const storage = mkdtempSync(join(tmpdir(), 'homebridge-eufy-ui-'));
    const diagnostics = join(resolveStorageRoot(storage), 'diagnostics');
    mkdirSync(diagnostics, { recursive: true });
    const qualification = {
      h264_videotoolbox: { 'main@3.1': ['bytes', 442_368, 336_375] },
      h264_qsv: { 'main@3.1': 'encode' },
    };
    writeFileSync(
      join(diagnostics, 'host.json'),
      JSON.stringify({
        version: 2,
        ffmpeg: { path: join(storage, 'missing-ffmpeg'), source: 'configured', encoders: qualification },
      }),
    );
    const events = ['message', 'disconnect', 'SIGHUP', 'SIGINT', 'SIGTERM'] as const;
    const before = new Map(events.map((event) => [event, process.rawListeners(event)]));
    const sent: Array<{ payload?: { requestId?: string; data?: unknown } }> = [];
    const send = process.send;
    process.send = (message: (typeof sent)[number]) => sent.push(message) > 0;
    vi.stubEnv('HOMEBRIDGE_STORAGE_PATH', storage);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const request = async (path: string) => {
      process.emit('message', { action: 'request', requestId: path, path } as never);
      await vi.waitFor(() => expect(sent.some(({ payload }) => payload?.requestId === path)).toBe(true));
      return sent.find(({ payload }) => payload?.requestId === path)!.payload!.data;
    };

    try {
      new EufyAuthenticationUiServer();
      expect(await request('/diagnostics/encoders')).toEqual({ qualification, probeable: ['h264_videotoolbox'] });
      const encode = Object.fromEntries(
        ['as-is', 'qmax-51', 'constant-bit-rate', 'smptebars', '10s'].map((variant) => [variant, 'encode']),
      );
      expect(await request('/diagnostics/encoders/probe')).toEqual({
        qualification,
        probeable: ['h264_videotoolbox'],
        probe: { h264_videotoolbox: encode },
      });
      expect(JSON.parse(readFileSync(join(diagnostics, 'encoder-probe.json'), 'utf8'))).toEqual({
        version: 1,
        encoders: { h264_videotoolbox: encode },
      });
    } finally {
      for (const event of events) {
        for (const listener of process.rawListeners(event)) {
          if (!before.get(event)!.includes(listener)) process.removeListener(event, listener as () => void);
        }
      }
      process.send = send;
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      rmSync(storage, { force: true, recursive: true });
    }
  });
});
