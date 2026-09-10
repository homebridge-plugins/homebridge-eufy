import { createHash } from 'node:crypto';
import { chmod, lstat, unlink } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { posix } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import type { RuntimeState } from '../diagnostics.js';
import { isSupportCaseId } from '../diagnostics.js';
import type { RuntimeStatus } from './tracker.js';

/**
 * How many bytes `sockaddr_un.sun_path` holds, per platform, including the terminator.
 *
 * A platform not named here is measured against the smallest known limit.
 */
const SUN_PATH_BYTES: Partial<Record<NodeJS.Platform, number>> = { darwin: 104, linux: 108 };

const SMALLEST_SUN_PATH_BYTES = 104;

const SOCKET_NAME = 'runtime.sock';

/** How much of the storage root's digest names the endpoint, which separates hosts and nothing else. */
const SCOPE_DIGEST_LENGTH = 16;

/** The only mode a served socket carries, and the only one a shared address is connected to at. */
export const RUNTIME_CHANNEL_SOCKET_MODE = 0o600;

/** The wire contract's version. A client refuses to speak across a difference in it. */
export const RUNTIME_CHANNEL_PROTOCOL = 1;

/** How long a client waits for the endpoint to accept, after which the runtime is absent. */
export const RUNTIME_CHANNEL_CONNECT_TIMEOUT_MS = 1_000;

/** How long a client waits for one answer, after which the runtime is absent. */
export const RUNTIME_CHANNEL_RESPONSE_TIMEOUT_MS = 5_000;

/** How long a connection may say nothing before the server closes it. */
export const RUNTIME_CHANNEL_IDLE_TIMEOUT_MS = 30_000;

/**
 * The largest unterminated frame either side accepts, matching the persisted tracker's own read cap.
 *
 * Exceeding it closes the connection, so no peer can grow the receiver's memory past this bound.
 */
export const RUNTIME_CHANNEL_FRAME_BYTES = 1024 * 1024;

/** The path that answers the live runtime status. */
export const RUNTIME_STATUS_PATH = '/runtime/status';

/**
 * The path that answers the live per-device observations.
 *
 * A path is refused rather than fatal, so one added inside a protocol version is discovered by asking. A
 * client that asks a runtime which does not serve it reads the rest of its answer and nothing here.
 */
export const RUNTIME_DEVICES_PATH = '/runtime/devices';

/** The path a diagnostics authorization is notified on, so the runtime reads the file at once. */
export const RUNTIME_DIAGNOSTICS_PATH = '/diagnostics/authorization';

/** The path a stand-down is requested on, so another process may own the account session. */
export const RUNTIME_STAND_DOWN_PATH = '/runtime/stand-down';

/**
 * How long a client waits for a requested stand-down, measured from the request.
 *
 * It outlasts the runtime's own bounded shutdown, which is ten seconds, because a stand-down runs that shutdown
 * and the endpoint closes at the end of it. A client observes the closing, not the answer.
 */
export const RUNTIME_CHANNEL_STAND_DOWN_TIMEOUT_MS = 15_000;

/**
 * What a diagnostics notification carries: which authorized evidence window the sender wrote.
 *
 * The persisted session file remains the authority for whether that window is open, so this names one and
 * asserts nothing about it. A support case identifier is randomly generated and carries no account, device,
 * or host fact.
 */
export interface RuntimeChannelAuthorization {
  supportCaseId: string;
}

/**
 * The live runtime status: the persisted record's scalar fields, stated by the process that holds them.
 *
 * `updatedAt` is when the answering process stated the status, which for a live answer is when the reported
 * state was true. The complete device snapshot is not part of this contract.
 */
export interface RuntimeChannelStatus {
  state: RuntimeState;
  status: RuntimeStatus;
  generation?: string;
  complete: boolean;
  updatedAt: string;
}

/**
 * What the runtime observes about one device that its published inventory cannot state.
 *
 * A field is absent where nothing is observed, and never false: a camera whose reading may not be relied on is
 * unknown rather than switched off, and publishing unknown as off would withdraw a working camera. The serial
 * is the key an observation is attached by, and every serial already reaches a consumer in the published
 * inventory.
 */
export interface RuntimeChannelDevice {
  serial: string;
  availability?: 'available' | 'unavailable';
  enabled?: boolean;
}

/** What one connection is told before it may ask anything. */
export interface RuntimeChannelGreeting {
  protocol: number;
  ready: boolean;
  state: RuntimeState;
  generation?: string;
}

/** One client request. `v` is the protocol the client speaks; `id` correlates the answer on one connection. */
export interface RuntimeChannelRequest {
  v: number;
  id: number;
  path: string;
  body?: RuntimeChannelAuthorization;
}

/** One answer, correlated by `id`. */
export interface RuntimeChannelResponse {
  id: number;
  ok: boolean;
  data?: RuntimeChannelStatus | RuntimeChannelDevice[];
}

/** The address the runtime channel is served and consumed on, and what its location implies. */
export interface RuntimeChannelEndpoint {
  /** The address `net` binds and connects. */
  path: string;
  transport: 'pipe' | 'socket';
  /**
   * Whether the address sits somewhere another local user can create an entry.
   *
   * True only of the temporary-directory fallback. An existing entry at a shared address is proven to be an
   * owner-only socket belonging to this user before it is connected to or removed.
   */
  shared: boolean;
}

/**
 * Derives the runtime channel's address from the platform and the storage root.
 *
 * Pure in its arguments. Windows resolves to a named pipe scoped by the storage root's digest, which has no
 * filesystem entry. Every other platform resolves to a socket inside the storage root, or to one in the
 * temporary directory under the same digest when the storage root's path would exceed `sun_path`. The
 * measurement is bytes, which is what the kernel copies.
 */
export function runtimeChannelEndpoint(
  storageRoot: string,
  platform: NodeJS.Platform,
  temporaryDirectory: string,
): RuntimeChannelEndpoint {
  const scope = createHash('sha256').update(storageRoot).digest('hex').slice(0, SCOPE_DIGEST_LENGTH);
  if (platform === 'win32') {
    return { path: `\\\\.\\pipe\\homebridge-eufy-${scope}`, transport: 'pipe', shared: false };
  }
  const preferred = posix.join(storageRoot, SOCKET_NAME);
  if (Buffer.byteLength(preferred) + 1 <= (SUN_PATH_BYTES[platform] ?? SMALLEST_SUN_PATH_BYTES)) {
    return { path: preferred, transport: 'socket', shared: false };
  }
  return {
    path: posix.join(temporaryDirectory, `homebridge-eufy-${scope}.sock`),
    transport: 'socket',
    shared: true,
  };
}

/**
 * The address for this host, resolved once for both processes that use it.
 *
 * The two sides derive the same address from the same host facts through this one function, so neither can
 * hold an address the other does not.
 */
export function runtimeChannelEndpointForHost(storageRoot: string): RuntimeChannelEndpoint {
  return runtimeChannelEndpoint(storageRoot, process.platform, tmpdir());
}

/**
 * Whether an existing filesystem entry is an owner-only socket belonging to this user.
 *
 * Only a shared address is subject to this. A socket another user owns is theirs: connecting to it would
 * send this process's answers to whoever created it, and removing it would deny them their own.
 */
export async function ownedSocket(path: string): Promise<boolean> {
  try {
    const entry = await lstat(path);
    return entry.isSocket() && entry.uid === process.getuid?.() && (entry.mode & 0o777) === RUNTIME_CHANNEL_SOCKET_MODE;
  } catch {
    return false;
  }
}

/**
 * Reads newline-terminated frames out of a stream, bounded by the largest frame either side accepts.
 *
 * A chunk is decoded incrementally, so a multi-byte character split across two of them is one character and
 * not two replacements. A chunk that arrives already decoded, from a stream given an encoding, is taken as
 * it is. The bound applies to what remains unterminated after every complete frame has been taken, which is
 * the only quantity a peer can grow without end. Undefined states that the bound was exceeded, and the
 * caller closes the connection.
 */
export class FrameReader {
  private readonly decoder = new StringDecoder('utf8');
  private pending = '';

  constructor(private readonly frameBytes: number = RUNTIME_CHANNEL_FRAME_BYTES) {}

  accept(chunk: Buffer | string): string[] | undefined {
    this.pending += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    const frames: string[] = [];
    let boundary = this.pending.indexOf('\n');
    while (boundary >= 0) {
      frames.push(this.pending.slice(0, boundary));
      this.pending = this.pending.slice(boundary + 1);
      boundary = this.pending.indexOf('\n');
    }
    return Buffer.byteLength(this.pending) > this.frameBytes ? undefined : frames;
  }
}

/** Whether the runtime has finished starting. A degraded runtime retains its registry view and is ready. */
function ready(state: RuntimeState): boolean {
  return state === 'ready' || state === 'degraded';
}

/**
 * Projects runtime status onto the closed set of fields this protocol carries.
 *
 * The only writer of an answer's fields. Nothing a provider or a peer adds to the object reaches the wire or
 * a consumer, which is what re-states at the wire the import ban that keeps the runtime's own data out of
 * the UI's reach.
 */
export function answeredStatus(status: RuntimeChannelStatus): RuntimeChannelStatus {
  return {
    state: status.state,
    status: status.status,
    ...(status.generation === undefined ? {} : { generation: status.generation }),
    complete: status.complete,
    updatedAt: status.updatedAt,
  };
}

/**
 * Projects one device's observations onto the closed set of fields this protocol carries.
 *
 * The only writer of an observation's fields onto the wire. An unobserved field is left out rather than
 * written false, so a provider that states `undefined` and one that states nothing are one answer.
 */
export function answeredDevice(device: RuntimeChannelDevice): RuntimeChannelDevice {
  return {
    serial: device.serial,
    ...(device.availability === undefined ? {} : { availability: device.availability }),
    ...(device.enabled === undefined ? {} : { enabled: device.enabled }),
  };
}

/**
 * Projects a notified body onto the closed set of fields this protocol carries inbound, or nothing.
 *
 * The only reader of a request body. A body arriving here is untrusted input in the process that owns the Eufy
 * session, so it is narrowed to one identifier of a known shape and nothing beside it crosses into the
 * runtime. Nothing is the answer for a body that carries no such identifier.
 */
export function noticedAuthorization(value: unknown): RuntimeChannelAuthorization | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  return isSupportCaseId(candidate.supportCaseId) ? { supportCaseId: candidate.supportCaseId } : undefined;
}

/** Whether a value is the device observations this protocol version carries, each with its declared shape. */
export function areRuntimeChannelDevices(value: unknown): value is RuntimeChannelDevice[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        return false;
      }
      const candidate = entry as Record<string, unknown>;
      return (
        typeof candidate.serial === 'string' &&
        (candidate.availability === undefined ||
          candidate.availability === 'available' ||
          candidate.availability === 'unavailable') &&
        (candidate.enabled === undefined || typeof candidate.enabled === 'boolean')
      );
    })
  );
}

/**
 * Whether a value is a status this protocol version carries, with every field the shape it declares.
 *
 * Applied by a consumer to what a peer sent. A shared address is one another local user can create an entry
 * at, so an answer arriving on this channel is untrusted input.
 */
export function isRuntimeChannelStatus(value: unknown): value is RuntimeChannelStatus {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.state === 'string' &&
    typeof candidate.status === 'string' &&
    typeof candidate.complete === 'boolean' &&
    typeof candidate.updatedAt === 'string' &&
    (candidate.generation === undefined || typeof candidate.generation === 'string')
  );
}

interface RuntimeChannelServerOptions {
  protocol?: number;
  idleTimeoutMs?: number;
  frameBytes?: number;
  devices?: () => RuntimeChannelDevice[];
  diagnostics?: (notice: RuntimeChannelAuthorization) => boolean;
  standDown?: () => boolean;
}

/**
 * Serves the runtime channel for as long as this process holds the account ownership lease.
 *
 * The endpoint is opened once the lease is held and removed inside the release guard, so a bound address
 * belongs to the process that owns the session and an entry found at a private address belongs to a process
 * that is gone. The endpoint is not evidence of ownership.
 *
 * A socket is narrowed to owner-only once it exists, because the mode `bind` produces is the process umask
 * and the umask is global. Inside the storage root no other user can reach the address at any mode.
 */
export class RuntimeChannelServer {
  private server?: Server;
  private readonly connections = new Set<Socket>();
  private readonly protocol: number;
  private readonly idleTimeoutMs: number;
  private readonly frameBytes: number;
  private readonly devices?: () => RuntimeChannelDevice[];
  private readonly diagnostics?: (notice: RuntimeChannelAuthorization) => boolean;
  private readonly standDown?: () => boolean;

  constructor(
    private readonly endpoint: RuntimeChannelEndpoint,
    private readonly status: () => RuntimeChannelStatus,
    options: RuntimeChannelServerOptions = {},
  ) {
    this.protocol = options.protocol ?? RUNTIME_CHANNEL_PROTOCOL;
    this.idleTimeoutMs = options.idleTimeoutMs ?? RUNTIME_CHANNEL_IDLE_TIMEOUT_MS;
    this.frameBytes = options.frameBytes ?? RUNTIME_CHANNEL_FRAME_BYTES;
    this.devices = options.devices;
    this.diagnostics = options.diagnostics;
    this.standDown = options.standDown;
  }

  /** Binds the endpoint, reporting whether it bound. An unbound channel is an absent one. */
  async open(): Promise<boolean> {
    if (this.server) {
      return true;
    }
    try {
      await this.clearStaleAddress();
      const server = createServer((connection) => this.serve(connection));
      server.unref();
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(this.endpoint.path, () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      server.on('error', () => undefined);
      if (this.endpoint.transport === 'socket') {
        await chmod(this.endpoint.path, RUNTIME_CHANNEL_SOCKET_MODE);
      }
      this.server = server;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Stops serving and drops every connection.
   *
   * Synchronous throughout, including the removal of a filesystem socket's entry, so the address is gone
   * before this returns. It is called from inside the ownership release guard, which is synchronous.
   */
  close(): void {
    const server = this.server;
    this.server = undefined;
    for (const connection of this.connections) {
      connection.destroy();
    }
    this.connections.clear();
    server?.close();
  }

  /**
   * Answers one request, refusing rather than propagating a provider that faults.
   *
   * A provider reaches into the runtime's own registry and manifest evidence, or reads a file and writes a
   * record, any of which may throw. This runs inside a socket's data listener, where a thrown error is an
   * uncaught exception in the process that owns the Eufy session, so no request on this channel may be able to
   * end it. A refusal is a state every consumer already handles.
   */
  private answered(request: RuntimeChannelRequest): RuntimeChannelResponse {
    try {
      if (request.path === RUNTIME_STATUS_PATH) {
        return { id: request.id, ok: true, data: answeredStatus(this.status()) };
      }
      if (request.path === RUNTIME_DEVICES_PATH && this.devices) {
        return { id: request.id, ok: true, data: this.devices().map(answeredDevice) };
      }
      if (request.path === RUNTIME_DIAGNOSTICS_PATH && this.diagnostics) {
        const notice = noticedAuthorization(request.body);
        return { id: request.id, ok: notice !== undefined && this.diagnostics(notice) };
      }
      if (request.path === RUNTIME_STAND_DOWN_PATH && this.standDown) {
        return { id: request.id, ok: this.standDown() };
      }
    } catch {
      return { id: request.id, ok: false };
    }
    return { id: request.id, ok: false };
  }

  private async clearStaleAddress(): Promise<void> {
    if (this.endpoint.transport !== 'socket') {
      return;
    }
    if (this.endpoint.shared && !(await ownedSocket(this.endpoint.path))) {
      return;
    }
    await unlink(this.endpoint.path).catch(() => undefined);
  }

  private serve(connection: Socket): void {
    this.connections.add(connection);
    connection.setTimeout(this.idleTimeoutMs, () => connection.destroy());
    connection.on('error', () => connection.destroy());
    connection.on('close', () => this.connections.delete(connection));
    const current = this.status();
    const greeting: RuntimeChannelGreeting = {
      protocol: this.protocol,
      ready: ready(current.state),
      state: current.state,
      ...(current.generation === undefined ? {} : { generation: current.generation }),
    };
    connection.write(`${JSON.stringify(greeting)}\n`);
    const reader = new FrameReader(this.frameBytes);
    connection.on('data', (chunk) => {
      const frames = reader.accept(chunk);
      if (!frames) {
        connection.destroy();
        return;
      }
      for (const frame of frames) {
        this.answer(connection, frame);
      }
    });
  }

  private answer(connection: Socket, frame: string): void {
    let request: RuntimeChannelRequest;
    try {
      request = JSON.parse(frame) as RuntimeChannelRequest;
    } catch {
      connection.destroy();
      return;
    }
    if (typeof request?.id !== 'number' || request.v !== this.protocol) {
      connection.destroy();
      return;
    }
    connection.write(`${JSON.stringify(this.answered(request))}\n`);
  }
}
