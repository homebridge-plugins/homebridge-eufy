import { createConnection, type Socket } from 'node:net';

import {
  answeredStatus,
  FrameReader,
  isRuntimeChannelStatus,
  ownedSocket,
  RUNTIME_CHANNEL_CONNECT_TIMEOUT_MS,
  RUNTIME_CHANNEL_PROTOCOL,
  RUNTIME_CHANNEL_RESPONSE_TIMEOUT_MS,
  RUNTIME_STATUS_PATH,
  type RuntimeChannelEndpoint,
  type RuntimeChannelGreeting,
  type RuntimeChannelResponse,
  type RuntimeChannelStatus,
} from '../runtime/channel.js';

/** One answered read: whether the runtime has finished starting, and the status it reported. */
export interface RuntimeChannelReading {
  ready: boolean;
  status: RuntimeChannelStatus;
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
 * frame larger than the bound, a malformed or unrecognised answer, and a shared address that is not an
 * owner-only socket belonging to this user are one outcome, which is that there is no runtime to ask.
 *
 * One connection per read, closed once the answer arrives.
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
      const settle = setTimeout(() => reject(new Error('runtime channel response timed out')), this.responseTimeoutMs);
      settle.unref();
      const reader = new FrameReader();
      let greeting: RuntimeChannelGreeting | undefined;
      const fail = (message: string): void => {
        clearTimeout(settle);
        reject(new Error(message));
      };
      connection.once('error', () => fail('runtime channel faulted'));
      connection.once('close', () => fail('runtime channel closed before answering'));
      connection.on('data', (chunk) => {
        const frames = reader.accept(chunk);
        if (!frames) {
          connection.destroy();
          return;
        }
        for (const frame of frames) {
          const answered = this.consume(connection, frame, greeting);
          if (answered === undefined) {
            fail('runtime channel sent an answer this client cannot use');
            return;
          }
          if ('reading' in answered) {
            clearTimeout(settle);
            resolve(answered.reading);
            return;
          }
          greeting = answered.greeting;
        }
      });
    });
  }

  /**
   * Interprets one frame as the greeting a connection opens with, or as the answer that follows it.
   *
   * Undefined states that the exchange cannot continue: an unreadable frame, a protocol this client does not
   * speak, a refusal, or an answer whose shape is not the one this protocol version carries.
   */
  private consume(
    connection: Socket,
    frame: string,
    greeting: RuntimeChannelGreeting | undefined,
  ): { greeting: RuntimeChannelGreeting } | { reading: RuntimeChannelReading } | undefined {
    let parsed: unknown;
    try {
      parsed = JSON.parse(frame);
    } catch {
      return undefined;
    }
    if (!greeting) {
      const opened = parsed as RuntimeChannelGreeting;
      if (opened?.protocol !== RUNTIME_CHANNEL_PROTOCOL || typeof opened.ready !== 'boolean') {
        return undefined;
      }
      connection.write(`${JSON.stringify({ v: RUNTIME_CHANNEL_PROTOCOL, id: 1, path: RUNTIME_STATUS_PATH })}\n`);
      return { greeting: opened };
    }
    const response = parsed as RuntimeChannelResponse;
    if (!response?.ok || !isRuntimeChannelStatus(response.data)) {
      return undefined;
    }
    return { reading: { ready: greeting.ready, status: answeredStatus(response.data) } };
  }
}
