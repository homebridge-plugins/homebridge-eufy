import { createConnection, type Socket } from 'node:net';

import {
  answeredDevice,
  answeredStatus,
  areRuntimeChannelDevices,
  FrameReader,
  isRuntimeChannelStatus,
  ownedSocket,
  RUNTIME_CHANNEL_CONNECT_TIMEOUT_MS,
  RUNTIME_CHANNEL_PROTOCOL,
  RUNTIME_CHANNEL_RESPONSE_TIMEOUT_MS,
  RUNTIME_CHANNEL_STAND_DOWN_TIMEOUT_MS,
  RUNTIME_DEVICES_PATH,
  RUNTIME_DIAGNOSTICS_PATH,
  RUNTIME_STAND_DOWN_PATH,
  RUNTIME_STATUS_PATH,
  type RuntimeChannelDevice,
  type RuntimeChannelEndpoint,
  type RuntimeChannelGreeting,
  type RuntimeChannelResponse,
  type RuntimeChannelStatus,
} from '../runtime/channel.js';

const STATUS_REQUEST = 1;
const DEVICES_REQUEST = 2;
const DIAGNOSTICS_REQUEST = 3;
const STAND_DOWN_REQUEST = 4;

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

/**
 * The runtime's immediate pickup of a diagnostics authorization, when a runtime is there to perform it.
 *
 * Declared beside its consumer. The persisted session file is the authority and remains the only thing that
 * survives a restart, so this reports nothing: a runtime that is absent, older, or unconvinced by the file all
 * leave the authorization exactly as the file states it.
 */
export interface RuntimeDiagnosticsChannel {
  notifyAuthorization(supportCaseId: string): Promise<void>;
}

/**
 * The runtime's willingness to release the account session, when a runtime is there to release it.
 *
 * Declared beside its consumer. The answer is the runtime's claim about itself, so a caller that needs the
 * session must still prove it holds the lease; this only says whether waiting for that is worth anything.
 */
export interface RuntimeStandDownChannel {
  requestStandDown(): Promise<boolean>;
}

interface RuntimeChannelClientOptions {
  connectTimeoutMs?: number;
  responseTimeoutMs?: number;
  standDownTimeoutMs?: number;
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
export class RuntimeChannelClient implements RuntimeStatusChannel, RuntimeDiagnosticsChannel, RuntimeStandDownChannel {
  private readonly connectTimeoutMs: number;
  private readonly responseTimeoutMs: number;
  private readonly standDownTimeoutMs: number;

  constructor(
    private readonly endpoint: RuntimeChannelEndpoint,
    options: RuntimeChannelClientOptions = {},
  ) {
    this.connectTimeoutMs = options.connectTimeoutMs ?? RUNTIME_CHANNEL_CONNECT_TIMEOUT_MS;
    this.responseTimeoutMs = options.responseTimeoutMs ?? RUNTIME_CHANNEL_RESPONSE_TIMEOUT_MS;
    this.standDownTimeoutMs = options.standDownTimeoutMs ?? RUNTIME_CHANNEL_STAND_DOWN_TIMEOUT_MS;
  }

  async read(): Promise<RuntimeChannelReading | undefined> {
    if (this.endpoint.shared && !(await ownedSocket(this.endpoint.path))) {
      return undefined;
    }
    let connection: Socket | undefined;
    try {
      connection = await this.connect();
      return await this.exchange(connection);
    } catch {
      return undefined;
    } finally {
      connection?.destroy();
    }
  }

  /**
   * Tells the runtime which authorized evidence window was written, so it reads the file now.
   *
   * Settles once the runtime has answered, so a caller's next step follows the pickup rather than racing it,
   * and settles within the same bounds a read observes for every way the channel cannot be used. Nothing is
   * reported either way: the file the runtime reads is the authority, and it decided before this was sent.
   */
  async notifyAuthorization(supportCaseId: string): Promise<void> {
    if (this.endpoint.shared && !(await ownedSocket(this.endpoint.path))) {
      return;
    }
    let connection: Socket | undefined;
    try {
      connection = await this.connect();
      await this.notified(connection, supportCaseId);
    } catch {
      return;
    } finally {
      connection?.destroy();
    }
  }

  /**
   * Asks the runtime to release the account session, reporting whether it stood down.
   *
   * True means the runtime accepted and its endpoint then closed, which happens inside the ownership release
   * guard, so the lease was released. It is still a claim about another process: a caller that needs the session
   * proves it by acquiring the lease. False is every other outcome — a refusal, a runtime that is absent or
   * speaks another protocol, and one that did not finish within the bound — and each leaves the caller reporting
   * exactly what it reports without this channel.
   */
  async requestStandDown(): Promise<boolean> {
    if (this.endpoint.shared && !(await ownedSocket(this.endpoint.path))) {
      return false;
    }
    let connection: Socket | undefined;
    try {
      connection = await this.connect();
      return await this.stoodDown(connection);
    } catch {
      return false;
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
   * Sends one notification after the greeting and concludes when it is answered.
   *
   * Concludes rather than fails on every other outcome, because there is nothing a caller could do with any of
   * them. A protocol this client does not speak concludes without sending, so a runtime running older code is
   * never handed a frame it would read as something else.
   */
  private notified(connection: Socket, supportCaseId: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const settle = setTimeout(resolve, this.responseTimeoutMs);
      settle.unref();
      const conclude = (): void => {
        clearTimeout(settle);
        resolve();
      };
      const reader = new FrameReader();
      let greeted = false;
      connection.once('error', conclude);
      connection.once('close', conclude);
      connection.on('data', (chunk) => {
        const frames = reader.accept(chunk);
        if (!frames) {
          conclude();
          return;
        }
        for (const frame of frames) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(frame);
          } catch {
            conclude();
            return;
          }
          if (greeted) {
            if ((parsed as RuntimeChannelResponse)?.id === DIAGNOSTICS_REQUEST) {
              conclude();
              return;
            }
            continue;
          }
          if ((parsed as RuntimeChannelGreeting)?.protocol !== RUNTIME_CHANNEL_PROTOCOL) {
            conclude();
            return;
          }
          greeted = true;
          connection.write(
            `${JSON.stringify({
              v: RUNTIME_CHANNEL_PROTOCOL,
              id: DIAGNOSTICS_REQUEST,
              path: RUNTIME_DIAGNOSTICS_PATH,
              body: { supportCaseId },
            })}\n`,
          );
        }
      });
    });
  }

  /**
   * Sends one stand-down request after the greeting and reports what became of it.
   *
   * A runtime standing down closes its endpoint at the end of its own bounded shutdown, so the closing is the
   * completion this waits for and an explicit refusal is the one answer that ends it early. A protocol this
   * client does not speak is never sent the request, because a frame an older runtime reads as something else
   * could take a session down that nothing asked for.
   */
  private stoodDown(connection: Socket): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const settle = setTimeout(() => resolve(false), this.standDownTimeoutMs);
      settle.unref();
      const conclude = (stoodDown: boolean): void => {
        clearTimeout(settle);
        resolve(stoodDown);
      };
      const reader = new FrameReader();
      let requested = false;
      connection.once('error', () => conclude(requested));
      connection.once('close', () => conclude(requested));
      connection.on('data', (chunk) => {
        const frames = reader.accept(chunk);
        if (!frames) {
          conclude(false);
          return;
        }
        for (const frame of frames) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(frame);
          } catch {
            conclude(false);
            return;
          }
          if (!requested) {
            if ((parsed as RuntimeChannelGreeting)?.protocol !== RUNTIME_CHANNEL_PROTOCOL) {
              conclude(false);
              return;
            }
            requested = true;
            connection.write(
              `${JSON.stringify({ v: RUNTIME_CHANNEL_PROTOCOL, id: STAND_DOWN_REQUEST, path: RUNTIME_STAND_DOWN_PATH })}\n`,
            );
            continue;
          }
          const response = parsed as RuntimeChannelResponse;
          if (response?.id === STAND_DOWN_REQUEST && !response.ok) {
            conclude(false);
            return;
          }
        }
      });
    });
  }

  private exchange(connection: Socket): Promise<RuntimeChannelReading> {
    return new Promise<RuntimeChannelReading>((resolve, reject) => {
      const settle = setTimeout(() => concludeOrFail('runtime channel response timed out'), this.responseTimeoutMs);
      settle.unref();
      const reader = new FrameReader();
      let greeting: RuntimeChannelGreeting | undefined;
      const fail = (message: string): void => {
        clearTimeout(settle);
        reject(new Error(message));
      };
      /**
       * Concludes with the status alone where the observations never settled.
       *
       * The status is one answer and the observations are another, so a runtime that answers the first and
       * then says nothing must not cost both. Only a read with no status at all is a failure.
       */
      const concludeOrFail = (message: string): void => {
        if (greeting && answeredStatusValue) {
          devicesSettled = true;
          settleIfComplete();
          return;
        }
        fail(message);
      };
      connection.once('error', () => concludeOrFail('runtime channel faulted'));
      connection.once('close', () => concludeOrFail('runtime channel closed before answering'));
      let answeredStatusValue: RuntimeChannelStatus | undefined;
      let answeredDevices: RuntimeChannelDevice[] | undefined;
      let devicesSettled = false;
      const settleIfComplete = (): void => {
        if (!greeting || !answeredStatusValue || !devicesSettled) {
          return;
        }
        clearTimeout(settle);
        resolve({
          ready: greeting.ready,
          status: answeredStatusValue,
          ...(answeredDevices === undefined ? {} : { devices: answeredDevices }),
        });
      };
      connection.on('data', (chunk) => {
        const frames = reader.accept(chunk);
        if (!frames) {
          connection.destroy();
          return;
        }
        for (const frame of frames) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(frame);
          } catch {
            fail('runtime channel sent an unreadable frame');
            return;
          }
          if (!greeting) {
            const opened = parsed as RuntimeChannelGreeting;
            if (opened?.protocol !== RUNTIME_CHANNEL_PROTOCOL || typeof opened.ready !== 'boolean') {
              fail('runtime channel speaks another protocol');
              return;
            }
            greeting = opened;
            connection.write(
              `${JSON.stringify({ v: RUNTIME_CHANNEL_PROTOCOL, id: STATUS_REQUEST, path: RUNTIME_STATUS_PATH })}\n` +
                `${JSON.stringify({ v: RUNTIME_CHANNEL_PROTOCOL, id: DEVICES_REQUEST, path: RUNTIME_DEVICES_PATH })}\n`,
            );
            continue;
          }
          const response = parsed as RuntimeChannelResponse;
          if (response?.id === STATUS_REQUEST) {
            if (!response.ok || !isRuntimeChannelStatus(response.data)) {
              fail('runtime channel answered no status this client can use');
              return;
            }
            answeredStatusValue = answeredStatus(response.data);
          } else if (response?.id === DEVICES_REQUEST) {
            devicesSettled = true;
            if (response.ok) {
              if (!areRuntimeChannelDevices(response.data)) {
                fail('runtime channel answered no observations this client can use');
                return;
              }
              answeredDevices = response.data.map(answeredDevice);
            }
          }
          settleIfComplete();
        }
      });
    });
  }
}
