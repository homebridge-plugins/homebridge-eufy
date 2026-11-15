import { createConnection, type Socket } from 'node:net';

import {
  answeredDevice,
  answeredDeviceSetting,
  answeredStatus,
  areRuntimeChannelDevices,
  areRuntimeChannelDeviceSettings,
  FrameReader,
  isRuntimeChannelStatus,
  LIVE_UNPLAYABLE,
  ownedSocket,
  RUNTIME_CHANNEL_CONNECT_TIMEOUT_MS,
  RUNTIME_CHANNEL_PROTOCOL,
  RUNTIME_DEVICE_LIVE_ADAPT_PATH,
  RUNTIME_CHANNEL_RESPONSE_TIMEOUT_MS,
  RUNTIME_CHANNEL_STAND_DOWN_TIMEOUT_MS,
  RUNTIME_CHANNEL_WRITE_TIMEOUT_MS,
  RUNTIME_DEVICE_LIVE_PATH,
  RUNTIME_DEVICE_SETTING_WRITE_PATH,
  RUNTIME_DEVICE_SETTINGS_PATH,
  RUNTIME_DEVICES_PATH,
  RUNTIME_DIAGNOSTICS_PATH,
  RUNTIME_RESTART_PATH,
  RUNTIME_STAND_DOWN_PATH,
  RUNTIME_STATUS_PATH,
  type RuntimeChannelDevice,
  type RuntimeChannelDeviceSetting,
  type RuntimeChannelDeviceSettingWrite,
  type RuntimeChannelEndpoint,
  type RuntimeChannelGreeting,
  type RuntimeChannelLiveCoding,
  type RuntimeChannelLivePreviewQuery,
  type RuntimeChannelResponse,
  type RuntimeChannelStatus,
} from '../runtime/channel.js';

const STATUS_REQUEST = 1;
const DEVICES_REQUEST = 2;
const DIAGNOSTICS_REQUEST = 3;
const DEPARTURE_REQUEST = 4;
const SETTINGS_REQUEST = 5;

/**
 * One answered read of the live runtime view.
 *
 * `devices` is absent where the runtime serves no observations, which is a runtime older than the path that
 * answers them. That is not the same as a runtime observing nothing about every device, which is a present but
 * empty list.
 */
export interface RuntimeChannelReading {
  ready: boolean;
  status: RuntimeChannelStatus;
  devices?: RuntimeChannelDevice[];
  /**
   * The plugin build the answering runtime loaded, when it says which.
   *
   * Absent from a runtime older than the greeting field, which is why a consumer treats absence as agreement
   * rather than as skew: an upgrade that cannot be proven is not worth interrupting anyone over.
   */
  version?: string;
  /** Which build of that version it loaded, when it says, so a rebuild without a version change still shows. */
  build?: string;
  /** Whether that runtime would be replaced rather than merely stopped, when it says. */
  restartable?: boolean;
}

/**
 * The live runtime status, when a runtime is there to state it.
 *
 * Declared beside its consumer, so the UI depends on the answer rather than on a transport. Absence is the
 * answer whenever the channel cannot be used.
 */
export interface RuntimeStatusChannel {
  read(): Promise<RuntimeChannelReading | undefined>;
}

interface RuntimeChannelClientOptions {
  connectTimeoutMs?: number;
  responseTimeoutMs?: number;
  standDownTimeoutMs?: number;
  writeTimeoutMs?: number;
}

/**
 * Speaks the channel the runtime serves while it owns the account session: reads, notifications, requests.
 *
 * Every failure resolves to absence rather than rejecting: an unreachable address, a refused connection, a
 * protocol this client does not speak, a bound endpoint that never answers within the response bound, a
 * frame larger than the bound, a malformed or unrecognised status, and a shared address that is not an
 * owner-only socket belonging to this user are one outcome, which is that there is no runtime to ask. A
 * refused request is not one of them: a path this runtime does not serve leaves its own answer out and the
 * rest of the reading stands.
 *
 * One connection per operation, its requests correlated by identity, closed once the operation settles.
 */
export class RuntimeChannelClient implements RuntimeStatusChannel {
  private readonly connectTimeoutMs: number;
  private readonly responseTimeoutMs: number;
  private readonly standDownTimeoutMs: number;
  private readonly writeTimeoutMs: number;

  constructor(
    private readonly endpoint: RuntimeChannelEndpoint,
    options: RuntimeChannelClientOptions = {},
  ) {
    this.connectTimeoutMs = options.connectTimeoutMs ?? RUNTIME_CHANNEL_CONNECT_TIMEOUT_MS;
    this.responseTimeoutMs = options.responseTimeoutMs ?? RUNTIME_CHANNEL_RESPONSE_TIMEOUT_MS;
    this.standDownTimeoutMs = options.standDownTimeoutMs ?? RUNTIME_CHANNEL_STAND_DOWN_TIMEOUT_MS;
    this.writeTimeoutMs = options.writeTimeoutMs ?? RUNTIME_CHANNEL_WRITE_TIMEOUT_MS;
  }

  /** A device's eufy settings, or undefined where no runtime answers them. */
  async readDeviceSettings(serial: string): Promise<RuntimeChannelDeviceSetting[] | undefined> {
    return this.over(undefined, (connection) =>
      this.converse<RuntimeChannelDeviceSetting[] | undefined>(
        connection,
        () => frame(SETTINGS_REQUEST, RUNTIME_DEVICE_SETTINGS_PATH, { serial }),
        (response, conclude) => {
          if (response?.id !== SETTINGS_REQUEST) return;
          conclude(
            response.ok && areRuntimeChannelDeviceSettings(response.data)
              ? response.data.map(answeredDeviceSetting)
              : undefined,
          );
        },
        () => undefined,
        this.responseTimeoutMs,
      ),
    );
  }

  /**
   * Writes one device setting, true where the runtime delivered it. Delivery is not the device changing: the next
   * read is what states that. An absent runtime refuses every write.
   */
  async writeDeviceSetting(write: RuntimeChannelDeviceSettingWrite): Promise<boolean> {
    return this.over(false, (connection) =>
      this.converse(
        connection,
        () => frame(SETTINGS_REQUEST, RUNTIME_DEVICE_SETTING_WRITE_PATH, write),
        answered,
        () => false,
        this.writeTimeoutMs,
      ),
    );
  }

  /**
   * Streams one camera's live preview as base64 JPEG pictures, each with its side and the live encoder and rate
   * of the HomeKit side, until it ends, the runtime is gone, or `signal` aborts. Settles once it has stopped, true
   * where the last HomeKit run yielded no picture; a runtime without the path, or with no preview to give, settles
   * at once.
   */
  async liveDevice(
    query: RuntimeChannelLivePreviewQuery,
    onPicture: (jpeg: string, coding: RuntimeChannelLiveCoding) => void,
    signal: AbortSignal,
  ): Promise<boolean> {
    return this.over(false, (connection) => {
      if (signal.aborted) connection.destroy();
      else signal.addEventListener('abort', () => connection.destroy(), { once: true });
      return this.converse(
        connection,
        () => frame(SETTINGS_REQUEST, RUNTIME_DEVICE_LIVE_PATH, query),
        (response, conclude) => {
          if (response?.id !== SETTINGS_REQUEST) return;
          if (!response.ok) return conclude(response.data === LIVE_UNPLAYABLE);
          const { side, encoder, kbps } = response.coding ?? {};
          if (typeof response.data !== 'string' || typeof encoder !== 'string') return conclude(false);
          if (side !== 'raw' && side !== 'homekit') return conclude(false);
          onPicture(response.data, typeof kbps === 'number' ? { side, encoder, kbps } : { side, encoder });
        },
        () => false,
      );
    });
  }

  /** Restarts the HomeKit side of the camera's running preview with other settings; false where none runs. */
  async adaptLive(query: RuntimeChannelLivePreviewQuery): Promise<boolean> {
    return this.over(false, (connection) =>
      this.converse(
        connection,
        () => frame(SETTINGS_REQUEST, RUNTIME_DEVICE_LIVE_ADAPT_PATH, query),
        answered,
        () => false,
        this.responseTimeoutMs,
      ),
    );
  }

  /**
   * Reads the greeting, the status, and the observations.
   *
   * The status is one answer and the observations are another, so a runtime that answers the first and then says
   * nothing, closes, or overruns the frame bound concludes with the status alone. Only a read with no status at
   * all, an unreadable frame, or an answer this client cannot use is absence.
   */
  async read(): Promise<RuntimeChannelReading | undefined> {
    let greeting: RuntimeChannelGreeting;
    let status: RuntimeChannelStatus | undefined;
    let devices: RuntimeChannelDevice[] | undefined;
    let devicesSettled = false;
    const reading = (): RuntimeChannelReading | undefined =>
      status && {
        ready: greeting.ready,
        status,
        ...(devices === undefined ? {} : { devices }),
        ...(greeting.version === undefined ? {} : { version: greeting.version }),
        ...(greeting.build === undefined ? {} : { build: greeting.build }),
        ...(greeting.restartable === undefined ? {} : { restartable: greeting.restartable }),
      };
    return this.over(undefined, (connection) =>
      this.converse<RuntimeChannelReading | undefined>(
        connection,
        (opened) => {
          if (typeof opened.ready !== 'boolean') return undefined;
          greeting = opened;
          return frame(STATUS_REQUEST, RUNTIME_STATUS_PATH) + frame(DEVICES_REQUEST, RUNTIME_DEVICES_PATH);
        },
        (response, conclude) => {
          if (response?.id === STATUS_REQUEST) {
            if (!response.ok || !isRuntimeChannelStatus(response.data)) return conclude(undefined);
            status = answeredStatus(response.data);
          } else if (response?.id === DEVICES_REQUEST) {
            devicesSettled = true;
            if (response.ok) {
              if (!areRuntimeChannelDevices(response.data)) return conclude(undefined);
              devices = response.data.map(answeredDevice);
            }
          }
          if (status && devicesSettled) conclude(reading());
        },
        (ending) => (ending === 'fault' ? undefined : reading()),
        this.responseTimeoutMs,
      ),
    );
  }

  /**
   * Tells the runtime which authorized evidence window was written, so it reads the file now.
   *
   * Settles once the runtime has answered, within the same bounds a read observes. Nothing is reported either
   * way: the file the runtime reads is the authority, and it decided before this was sent.
   */
  async notifyAuthorization(supportCaseId: string): Promise<void> {
    return this.over(undefined, (connection) =>
      this.converse<void>(
        connection,
        () => frame(DIAGNOSTICS_REQUEST, RUNTIME_DIAGNOSTICS_PATH, { supportCaseId }),
        (response, conclude) => {
          if (response?.id === DIAGNOSTICS_REQUEST) conclude();
        },
        () => undefined,
        this.responseTimeoutMs,
      ),
    );
  }

  /**
   * Asks the runtime to release the account session, reporting whether it stood down.
   *
   * True means the request was sent and the endpoint then closed without refusing it. A runtime closes it inside
   * the ownership release guard, so the lease is released, but this remains a claim about another process and
   * never proof: only acquiring the lease is that. False is every other outcome — an explicit refusal, a runtime
   * that is absent or speaks another protocol, and one that did not finish within the bound — and they are one
   * answer, which is that the session was not freed.
   */
  async requestStandDown(): Promise<boolean> {
    return this.over(false, (connection) => this.departed(connection, RUNTIME_STAND_DOWN_PATH));
  }

  /**
   * Asks the runtime to end itself so Homebridge brings up the installed build, reporting whether it accepted.
   *
   * A runtime that does not serve the path, or refuses because ending it would not replace it, is a false rather
   * than a failure, so a caller never has to tell an old runtime apart from an unwilling one. Whether the
   * replacement came up is read from the next greeting.
   */
  async requestRestart(): Promise<boolean> {
    return this.over(false, (connection) => this.departed(connection, RUNTIME_RESTART_PATH));
  }

  /**
   * Sends one departure request and reports whether the endpoint then closed without refusing it.
   *
   * A runtime that releases its session or ends for replacement closes its endpoint at the end of its own bounded
   * shutdown, so the closing is the completion this waits for and an explicit refusal is the one answer that ends
   * it early. Acceptance is not waited for, because a runtime that closes the connection may not have flushed it.
   */
  private departed(connection: Socket, path: string): Promise<boolean> {
    return this.converse(
      connection,
      () => frame(DEPARTURE_REQUEST, path),
      (response, conclude) => {
        if (response?.id === DEPARTURE_REQUEST && !response.ok) conclude(false);
      },
      (ending) => ending === 'closed',
      this.standDownTimeoutMs,
    );
  }

  /**
   * Runs one operation over its own connection, answering `absent` wherever the endpoint could not be used.
   *
   * The connection is closed however the operation ends. A shared address is proven to be an owner-only socket of
   * this user before it is connected to, because an address another local user can create an entry at is one they
   * could be answering at.
   */
  private async over<T>(absent: T, operation: (connection: Socket) => Promise<T>): Promise<T> {
    if (this.endpoint.shared && !(await ownedSocket(this.endpoint.path))) {
      return absent;
    }
    let connection: Socket | undefined;
    try {
      connection = await this.connect();
      return await operation(connection);
    } catch {
      return absent;
    } finally {
      connection?.destroy();
    }
  }

  private connect(): Promise<Socket> {
    return new Promise<Socket>((resolve, reject) => {
      const connection = createConnection(this.endpoint.path);
      const settle = setTimeout(() => {
        connection.destroy();
        reject(new Error('runtime channel connect timed out'));
      }, this.connectTimeoutMs);
      settle.unref();
      connection.once('error', (error) => {
        clearTimeout(settle);
        reject(error);
      });
      connection.once('connect', () => {
        clearTimeout(settle);
        resolve(connection);
      });
    });
  }

  /**
   * Holds one conversation: writes what `request` makes of the greeting, then hands each response to `onResponse`
   * until it concludes, and answers every other ending with `unanswered`.
   *
   * Everything before the request is written is a `fault`: a greeting naming another protocol or one `request`
   * refuses is never sent the request, so a runtime running older code is never handed a frame it would read as
   * something else. An unreadable frame is a `fault` too. After the request, the endpoint closing is `closed`, and
   * `timeoutMs` passing or a frame beyond the frame bound is `lapsed`.
   */
  private converse<T>(
    connection: Socket,
    request: (greeting: RuntimeChannelGreeting) => string | undefined,
    onResponse: (response: RuntimeChannelResponse, conclude: (value: T) => void) => void,
    unanswered: (ending: 'fault' | 'closed' | 'lapsed') => T,
    timeoutMs?: number,
  ): Promise<T> {
    return new Promise<T>((resolve) => {
      let requested = false;
      let done = false;
      const conclude = (value: T): void => {
        done = true;
        clearTimeout(settle);
        resolve(value);
      };
      const end = (ending: 'fault' | 'closed' | 'lapsed'): void => {
        if (!done) conclude(unanswered(requested ? ending : 'fault'));
      };
      const settle = timeoutMs === undefined ? undefined : setTimeout(() => end('lapsed'), timeoutMs);
      settle?.unref();
      const reader = new FrameReader();
      connection.once('error', () => end('closed'));
      connection.once('close', () => end('closed'));
      connection.on('data', (chunk) => {
        const frames = reader.accept(chunk);
        if (!frames) return end('lapsed');
        for (const text of frames) {
          if (done) return;
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            return end('fault');
          }
          if (requested) {
            onResponse(parsed as RuntimeChannelResponse, conclude);
            continue;
          }
          const greeting = parsed as RuntimeChannelGreeting;
          const written = greeting?.protocol === RUNTIME_CHANNEL_PROTOCOL ? request(greeting) : undefined;
          if (written === undefined) return end('fault');
          requested = true;
          connection.write(written);
        }
      });
    });
  }
}

/** One request frame of this protocol. */
function frame(id: number, path: string, body?: unknown): string {
  return `${JSON.stringify({ v: RUNTIME_CHANNEL_PROTOCOL, id, path, ...(body === undefined ? {} : { body }) })}\n`;
}

/** Concludes on the settings request's answer: true where accepted, false where refused. */
function answered(response: RuntimeChannelResponse, conclude: (value: boolean) => void): void {
  if (response?.id === SETTINGS_REQUEST) conclude(!!response.ok);
}
