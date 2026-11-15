import { describe, expect, it } from 'vitest';

import {
  parseAuthenticationAnswer,
  parseAuthenticationStart,
  parseDiagnosticsAuthorization,
  parseDeviceSettingWriteRequest,
  parseDiagnosticsUiEvent,
  parseSerialRequest,
} from '../../src/ui/server.js';

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
    expect(parseSerialRequest({ serial: 'T8410P00223SYNTH' }, 'Invalid device image request', 128)).toBe(
      'T8410P00223SYNTH',
    );

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
      expect(() => parseSerialRequest(value, 'Invalid device image request', 128)).toThrow(
        'Invalid device image request',
      );
      try {
        parseSerialRequest(value, 'Invalid device image request', 128);
      } catch (error) {
        expect((error as Error).message).not.toContain(SUBMITTED_SERIAL);
      }
    }
  });
});

describe('custom UI device settings input', () => {
  /** A settings read names one plausible serial and nothing else. */
  it('accepts a settings read for one serial only', () => {
    expect(parseSerialRequest({ serial: 'T8000P0000000000' }, 'Invalid device settings request', 64)).toBe(
      'T8000P0000000000',
    );
    for (const value of [undefined, {}, { serial: '../x' }, { serial: 'T8000P0000000000', extra: true }]) {
      expect(() => parseSerialRequest(value, 'Invalid device settings request', 64)).toThrow(
        'Invalid device settings request',
      );
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
