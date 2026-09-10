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
  RUNTIME_DEVICES_PATH,
  RUNTIME_STATUS_PATH,
  type RuntimeChannelDevice,
  type RuntimeChannelEndpoint,
  type RuntimeChannelGreeting,
  type RuntimeChannelResponse,
  type RuntimeChannelStatus,
} from '../runtime/channel.js';

const STATUS_REQUEST = 1;
const DEVICES_REQUEST = 2;

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

interface RuntimeChannelClientOptions {
  connectTimeoutMs?: number;
  responseTimeoutMs?: number;
}

/**
 * Reads the live runtime status over the channel the runtime serves while it owns the account session.
 *
 * Every failure resolves to absence rather than rejecting: an unreachable address, a refused connection, a
 * protocol this client does not speak, a bound endpoint that never answers within the response bound, a
 * frame larger than the bound, a malformed or unrecognised status, and a shared address that is not an
 * owner-only socket belonging to this user are one outcome, which is that there is no runtime to ask. A
 * refused request is not one of them: a path this runtime does not serve leaves its own answer out and the
 * rest of the reading stands.
 *
 * One connection per read, carrying both requests correlated by identity, closed once both are answered.
 */
export class RuntimeChannelClient implements RuntimeStatusChannel {
  private readonly connectTimeoutMs: number;
  private readonly responseTimeoutMs: number;

  constructor(
    private readonly endpoint: RuntimeChannelEndpoint,
    options: RuntimeChannelClientOptions = {},
  ) {
    this.connectTimeoutMs = options.connectTimeoutMs ?? RUNTIME_CHANNEL_CONNECT_TIMEOUT_MS;
    this.responseTimeoutMs = options.responseTimeoutMs ?? RUNTIME_CHANNEL_RESPONSE_TIMEOUT_MS;
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
