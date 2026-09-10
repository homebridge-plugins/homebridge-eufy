import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

import type { AvailabilityObservation, Device, DeviceManifest } from '@mega-yfue/eufy-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseConfig } from '../../src/configuration.js';
import { AccountOwnership } from '../../src/account/ownership.js';
import { createDiagnosticLogger, GuidedDiagnostics } from '../../src/diagnostics.js';
import {
  FrameReader,
  runtimeChannelEndpoint,
  runtimeChannelEndpointForHost,
  RuntimeChannelServer,
  RUNTIME_CHANNEL_CONNECT_TIMEOUT_MS,
  RUNTIME_CHANNEL_FRAME_BYTES,
  RUNTIME_CHANNEL_IDLE_TIMEOUT_MS,
  RUNTIME_CHANNEL_PROTOCOL,
  RUNTIME_CHANNEL_RESPONSE_TIMEOUT_MS,
  RUNTIME_CHANNEL_STAND_DOWN_TIMEOUT_MS,
  RUNTIME_DIAGNOSTICS_PATH,
  type RuntimeChannelAuthorization,
  type RuntimeChannelDevice,
  type RuntimeChannelEndpoint,
  type RuntimeChannelStatus,
} from '../../src/runtime/channel.js';
import { RuntimeOwner, type RuntimeChannelHost, type RuntimeLogger } from '../../src/runtime/owner.js';
import type { CompleteDeviceSnapshot } from '../../src/device/snapshot.js';
import type { RuntimeTrackerRecord } from '../../src/runtime/tracker.js';
import type { SdkClient } from '../../src/runtime/sdk-client.js';
import { readDashboard } from '../../src/ui/dashboard.js';
import { RuntimeChannelClient, type RuntimeStatusChannel } from '../../src/ui/runtime-channel-client.js';

function trackerRecord(update: Partial<RuntimeTrackerRecord> = {}): RuntimeTrackerRecord {
  return {
    version: 1,
    source: 'runtime',
    state: 'ready',
    updatedAt: '2026-08-13T12:00:00.000Z',
    complete: true,
    status: 'connected',
    snapshot: {
      version: 1,
      complete: true,
      devices: [
        {
          sn: 'synthetic-sensor',
          name: 'Synthetic Sensor',
          model: 'T8910',
          modelName: 'Synthetic Sensor',
          codec: 'sensor',
          source: 'inferred',
          bound: true,
          capabilities: ['contact'] as DeviceManifest['capabilities'],
          details: [
            {
              capability: 'contact',
              accessor: 'contact',
              reads: [{ accessor: 'open', property: 'synthetic', type: 'bool', writable: false }],
              actions: [],
              undescribedActions: [],
              events: [],
            },
          ],
        },
      ],
    },
    ...update,
  };
}

const ANSWERED_FIELDS = ['complete', 'generation', 'state', 'status', 'updatedAt'];

const SUBMITTED_PASSWORD = 'synthetic-password-must-never-be-answered';
const SUBMITTED_ANSWER = 'synthetic-challenge-answer-must-never-be-answered';

/** A support case identifier of the shape one is accepted in, naming no session any file holds. */
const SYNTHETIC_SUPPORT_CASE_ID = 'support-00000000-0000-4000-8000-000000000000';

const STORAGE_ROOT = '/var/lib/homebridge/homebridge-eufy';
const OTHER_STORAGE_ROOT = '/homebridge/homebridge-eufy';
const TEMPORARY = '/tmp';

/**
 * A root whose socket path is 104 bytes: one byte too long for macOS, which fits 104 including the
 * terminator, and comfortably inside Linux's 108. It is the only fixture that separates the two limits.
 */
const MACOS_ONLY_OVERLONG_ROOT = `/srv/${'m'.repeat(70)}/homebridge-eufy`;

/**
 * A root of 70 characters and 118 bytes, whose socket path is 131 bytes. Counting characters would admit it
 * on both platforms; counting the bytes the kernel copies rejects it on both.
 */
const MULTIBYTE_OVERLONG_ROOT = `/home/${'é'.repeat(48)}/homebridge-eufy`;

describe('runtime channel endpoint derivation', () => {
  /**
   * The endpoint is derived from the platform and the storage root both processes already resolve, so the UI
   * never discovers an address and the two sides cannot disagree about one.
   */
  it('derives a filesystem socket inside the storage root on macOS and Linux', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      expect(runtimeChannelEndpoint(STORAGE_ROOT, platform, TEMPORARY), platform).toEqual({
        path: '/var/lib/homebridge/homebridge-eufy/runtime.sock',
        transport: 'socket',
        shared: false,
      });
    }
  });

  /**
   * Windows has no filesystem socket, and a pipe name is scoped to the storage root so two Homebridge
   * instances on one host cannot collide on it.
   */
  it('derives a named pipe scoped to the storage root on Windows', () => {
    expect(runtimeChannelEndpoint(STORAGE_ROOT, 'win32', TEMPORARY)).toEqual({
      path: '\\\\.\\pipe\\homebridge-eufy-15b7d6e16c1f023d',
      transport: 'pipe',
      shared: false,
    });
    expect(runtimeChannelEndpoint(OTHER_STORAGE_ROOT, 'win32', TEMPORARY).path).toBe(
      '\\\\.\\pipe\\homebridge-eufy-e36d421e16876992',
    );
  });

  /**
   * `sun_path` is 104 bytes on macOS and 108 on Linux, both including the terminator, and exceeding it fails
   * at `listen` with a bare `EINVAL`. The same root therefore falls back on one platform and does not on the
   * other, which is why one shared limit would be wrong.
   */
  it('falls back to the temporary directory only on the platform whose limit the path exceeds', () => {
    expect(runtimeChannelEndpoint(MACOS_ONLY_OVERLONG_ROOT, 'darwin', TEMPORARY)).toEqual({
      path: '/tmp/homebridge-eufy-2fec175cd7360b41.sock',
      transport: 'socket',
      shared: true,
    });
    expect(runtimeChannelEndpoint(MACOS_ONLY_OVERLONG_ROOT, 'linux', TEMPORARY).path).toBe(
      `${MACOS_ONLY_OVERLONG_ROOT}/runtime.sock`,
    );
  });

  /**
   * The limit is bytes, not characters. An accented home directory is the ordinary way a path that looks
   * short crosses it.
   */
  it('measures the address in bytes rather than characters', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      expect(runtimeChannelEndpoint(MULTIBYTE_OVERLONG_ROOT, platform, TEMPORARY), platform).toEqual({
        path: '/tmp/homebridge-eufy-f3265180a226674d.sock',
        transport: 'socket',
        shared: true,
      });
    }
  });

  /**
   * The fallback lives where another local user can create an entry, so it is reported as shared and two
   * storage roots never resolve to one name.
   */
  it('names the shared fallback from the storage root so two instances cannot collide', () => {
    const first = runtimeChannelEndpoint(MULTIBYTE_OVERLONG_ROOT, 'darwin', TEMPORARY);
    const second = runtimeChannelEndpoint(MACOS_ONLY_OVERLONG_ROOT, 'darwin', TEMPORARY);

    expect(first.shared).toBe(true);
    expect(second.shared).toBe(true);
    expect(first.path).not.toBe(second.path);
  });

  /**
   * The derivation reads nothing but its arguments, so one runner asserts all three platforms and the
   * hashes above are values a reader can recompute rather than a repetition of the implementation.
   */
  it('is a pure function of platform, storage root, and temporary directory', () => {
    expect(createHash('sha256').update(STORAGE_ROOT).digest('hex').slice(0, 16)).toBe('15b7d6e16c1f023d');
    expect(runtimeChannelEndpoint(STORAGE_ROOT, 'linux', '/alternative')).toEqual(
      runtimeChannelEndpoint(STORAGE_ROOT, 'linux', TEMPORARY),
    );
    expect(runtimeChannelEndpoint(MULTIBYTE_OVERLONG_ROOT, 'linux', '/alternative').path).toBe(
      '/alternative/homebridge-eufy-f3265180a226674d.sock',
    );
  });
});

function status(overrides: Partial<RuntimeChannelStatus> = {}): RuntimeChannelStatus {
  return {
    state: 'ready',
    status: 'connected',
    generation: 'synthetic-generation',
    complete: true,
    updatedAt: '2026-08-25T12:00:00.000Z',
    ...overrides,
  };
}

describe('runtime channel round trip', () => {
  let root: string;
  let servers: RuntimeChannelServer[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'homebridge-eufy-channel-'));
    servers = [];
  });

  afterEach(async () => {
    for (const server of servers) {
      server.close();
    }
    await rm(root, { force: true, recursive: true });
  });

  async function serve(read: () => RuntimeChannelStatus): Promise<RuntimeChannelClient> {
    const endpoint = runtimeChannelEndpoint(root, process.platform, tmpdir());
    const server = new RuntimeChannelServer(endpoint, read);
    servers.push(server);
    await server.open();
    return new RuntimeChannelClient(endpoint);
  }

  /**
   * The channel answers the live runtime state, which is the one thing the persisted tracker can be a
   * heartbeat behind, so a read that reaches the runtime is distinguishable from one that read the file.
   */
  it('greets a connection and answers the live runtime status', async () => {
    let current = status();
    const client = await serve(() => current);

    await expect(client.read()).resolves.toEqual({ ready: true, status: status() });

    current = status({ state: 'degraded', status: 'transport-degraded', complete: false, generation: undefined });

    await expect(client.read()).resolves.toEqual({
      ready: true,
      status: { state: 'degraded', status: 'transport-degraded', complete: false, updatedAt: status().updatedAt },
    });
  });

  /**
   * A runtime that holds the lease but has not finished starting answers, and says so. Refusing the
   * connection instead would make it indistinguishable from a runtime that is not there at all.
   */
  it('reports a bound but unstarted runtime as present and not ready', async () => {
    const client = await serve(() => status({ state: 'starting', status: 'starting', complete: false }));

    await expect(client.read()).resolves.toMatchObject({ ready: false, status: { state: 'starting' } });
  });

  /**
   * Every situation in which the channel cannot answer resolves to the same absence, because the UI's
   * behaviour for all of them is to use the files it already reads rather than to report a fault.
   */
  it('resolves to absent when no runtime is serving the endpoint', async () => {
    const client = new RuntimeChannelClient(runtimeChannelEndpoint(root, process.platform, tmpdir()));

    await expect(client.read()).resolves.toBeUndefined();
  });

  /**
   * After a package upgrade without a Homebridge restart the client is the new code and the server is the
   * old one. The version is what turns that into a silent degradation rather than an intermittent fault.
   */
  it('degrades to absent when the served protocol is not the one it speaks', async () => {
    const endpoint = runtimeChannelEndpoint(root, process.platform, tmpdir());
    const server = new RuntimeChannelServer(endpoint, () => status(), { protocol: RUNTIME_CHANNEL_PROTOCOL + 1 });
    servers.push(server);
    await server.open();

    await expect(new RuntimeChannelClient(endpoint).read()).resolves.toBeUndefined();
  });

  /**
   * Two configuration tabs are two clients, and one must not wait on the other.
   */
  it('serves more than one client at a time', async () => {
    const endpoint = runtimeChannelEndpoint(root, process.platform, tmpdir());
    const server = new RuntimeChannelServer(endpoint, () => status());
    servers.push(server);
    await server.open();

    await expect(
      Promise.all([
        new RuntimeChannelClient(endpoint).read(),
        new RuntimeChannelClient(endpoint).read(),
        new RuntimeChannelClient(endpoint).read(),
      ]),
    ).resolves.toEqual([
      { ready: true, status: status() },
      { ready: true, status: status() },
      { ready: true, status: status() },
    ]);
  });
});

describe('runtime channel bounds and payload', () => {
  let root: string;
  let servers: RuntimeChannelServer[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'homebridge-eufy-channel-bounds-'));
    servers = [];
  });

  afterEach(async () => {
    for (const server of servers) {
      server.close();
    }
    await rm(root, { force: true, recursive: true });
  });

  function endpointIn(directory: string): RuntimeChannelEndpoint {
    return runtimeChannelEndpoint(directory, process.platform, tmpdir());
  }

  /**
   * A frame larger than the cap is refused by dropping the connection, so a peer that writes without end
   * cannot grow the receiver's memory while it waits for a newline that never comes.
   */
  it('refuses an oversized frame rather than buffering it', async () => {
    const endpoint = endpointIn(root);
    const server = new RuntimeChannelServer(endpoint, () => status(), { frameBytes: 64 });
    servers.push(server);
    await server.open();

    const connection = createConnection(endpoint.path);
    await once(connection, 'connect');
    connection.resume();
    connection.write(`${'x'.repeat(256)}`);

    await expect(once(connection, 'close')).resolves.toBeDefined();
    connection.destroy();
  });

  /**
   * A bound endpoint that never answers is the same absence as no endpoint at all, reached at the response
   * bound instead of the connect bound.
   */
  it('gives up on a bound endpoint that never answers', async () => {
    const endpoint = endpointIn(root);
    const silent = createServer(() => undefined);
    await new Promise<void>((resolve) => silent.listen(endpoint.path, resolve));

    try {
      await expect(new RuntimeChannelClient(endpoint, { responseTimeoutMs: 50 }).read()).resolves.toBeUndefined();
    } finally {
      silent.close();
    }
  });

  /**
   * A socket left behind by a process killed with `SIGKILL` must not stop its successor binding. The endpoint
   * is opened only once the lease is held, so an entry found at a private address belongs to a process that
   * is gone.
   */
  it('binds over a socket a killed predecessor left behind', async () => {
    const endpoint = endpointIn(root);
    const abandoned = createServer(() => undefined);
    await new Promise<void>((resolve) => abandoned.listen(endpoint.path, resolve));
    abandoned.unref();

    const server = new RuntimeChannelServer(endpoint, () => status());
    servers.push(server);

    await expect(server.open()).resolves.toBe(true);
    await expect(new RuntimeChannelClient(endpoint).read()).resolves.toMatchObject({ ready: true });
  });

  /**
   * Closing the server removes the address, so a later process finds nothing rather than a socket nobody
   * answers.
   */
  it('removes the address when it stops serving', async () => {
    const endpoint = endpointIn(root);
    const server = new RuntimeChannelServer(endpoint, () => status());
    await server.open();
    await expect(stat(endpoint.path)).resolves.toBeDefined();

    server.close();
    expect(existsSync(endpoint.path)).toBe(false);
    await expect(new RuntimeChannelClient(endpoint).read()).resolves.toBeUndefined();
  });

  /**
   * A filesystem socket is owner-only, so the address is unreachable by another local user whatever the
   * directory it sits in permits.
   */
  it('serves an owner-only socket', async () => {
    const endpoint = endpointIn(root);
    const server = new RuntimeChannelServer(endpoint, () => status());
    servers.push(server);
    await server.open();

    expect((await stat(endpoint.path)).mode & 0o777).toBe(0o600);
  });

  /**
   * The wire payload is a closed set of scalar fields, asserted rather than described, because the socket
   * bypasses the import ban that keeps credentials out of the runtime process. The complete device snapshot
   * is excluded deliberately: the UI reads it from the tracker file and copying it here would make the
   * channel slower than the file it is meant to be fresher than.
   */
  it('answers a closed field set that carries no credential and no device snapshot', async () => {
    const endpoint = endpointIn(root);
    const server = new RuntimeChannelServer(endpoint, () =>
      Object.assign(status(), {
        password: SUBMITTED_PASSWORD,
        answer: SUBMITTED_ANSWER,
        snapshot: { version: 1, complete: true, devices: [] },
      }),
    );
    servers.push(server);
    await server.open();

    const connection = createConnection(endpoint.path);
    await once(connection, 'connect');
    const frames: string[] = [];
    connection.on('data', (chunk: Buffer) => frames.push(chunk.toString('utf8')));
    await once(connection, 'data');
    connection.write(`${JSON.stringify({ v: RUNTIME_CHANNEL_PROTOCOL, id: 1, path: '/runtime/status' })}\n`);
    await vi.waitFor(() => expect(frames.length).toBeGreaterThan(1));
    connection.destroy();

    const answered = JSON.parse(frames[1]!) as { data: Record<string, unknown> };
    expect(Object.keys(answered.data).sort()).toEqual(ANSWERED_FIELDS);
    expect(frames.join('')).not.toMatch(/password|credential|captcha|answer|authToken|cookie|secret/i);
  });

  /**
   * An unknown path is refused without closing the connection and without inventing an answer, so a newer
   * client asking an older runtime for something it does not serve degrades rather than faults.
   */
  it('refuses a path this protocol version does not serve', async () => {
    const endpoint = endpointIn(root);
    const server = new RuntimeChannelServer(endpoint, () => status());
    servers.push(server);
    await server.open();

    const connection = createConnection(endpoint.path);
    await once(connection, 'connect');
    const frames: string[] = [];
    connection.on('data', (chunk: Buffer) => frames.push(chunk.toString('utf8')));
    await once(connection, 'data');
    connection.write(`${JSON.stringify({ v: RUNTIME_CHANNEL_PROTOCOL, id: 7, path: '/runtime/devices' })}\n`);
    await vi.waitFor(() => expect(frames.length).toBeGreaterThan(1));
    connection.destroy();

    expect(JSON.parse(frames[1]!)).toEqual({ id: 7, ok: false });
  });
});

function runtimeConfig() {
  return parseConfig({
    platform: 'HomebridgeEufy',
    username: 'runtime@example.invalid',
    password: 'persisted-password',
  });
}

interface HarnessRegistry {
  snapshot: CompleteDeviceSnapshot;
  registry: ReadonlyMap<string, Device>;
  availability?: boolean;
  availabilityFor?: (serial: string) => AvailabilityObservation | undefined;
  storageRoot?: string;
  stopsSlowly?: boolean;
}

function ownerHarness(
  channel: RuntimeChannelHost | undefined,
  calls: string[],
  log: RuntimeLogger = { error: vi.fn(), warn: vi.fn() },
  view?: HarnessRegistry,
) {
  const config = runtimeConfig();
  const client: SdkClient = {
    start: vi.fn(async () => {
      calls.push('client:start');
      return {
        state: 'ready' as const,
        registry: view?.registry ?? new Map(),
        snapshot: view?.snapshot ?? { version: 1, complete: true, devices: [] },
      };
    }),
    stop: vi.fn(async () => {
      calls.push('client:stop');
      if (view?.stopsSlowly) {
        await new Promise<void>((resolve) => setTimeout(resolve, 400));
      }
    }),
    ...(view?.availability ? { deviceAvailability: (serial: string) => view.availabilityFor?.(serial) } : {}),
  };
  return new RuntimeOwner(log, config, () => client, {
    storageRoot: view?.storageRoot ?? '/synthetic-runtime',
    ...(channel ? { channel } : {}),
    ownership: {
      acquire: vi.fn(async () => {
        calls.push('acquire');
        return {
          state: 'owner' as const,
          recovered: false,
          lease: {
            release: vi.fn(async (onReleased?: () => void) => {
              calls.push('release');
              onReleased?.();
              return { state: 'stopped' as const };
            }),
          },
        };
      }),
    },
    persistence: {
      active: vi.fn(async () => ({
        account: 'runtime@example.invalid',
        generation: 'synthetic-generation',
        configuration: { load: () => config },
        session: {
          load: () => ({ userId: 'synthetic-user', authToken: 'synthetic-token', expiresAt: 1, domain: 'synthetic' }),
          save: vi.fn(),
          clear: vi.fn(),
        },
        push: { load: () => null, save: vi.fn(), clear: vi.fn() },
        snapshot: { load: () => null, save: vi.fn() },
      })),
    },
    statusPublisher: {
      start: vi.fn(() => {
        calls.push('status:starting');
        return true;
      }),
      update: vi.fn((state) => {
        calls.push(`status:${state}`);
        return true;
      }),
      stop: vi.fn(() => calls.push('status:stopped')),
    },
  });
}

describe('runtime channel lifetime', () => {
  /**
   * The endpoint exists for exactly as long as the lease does: opened once this process is the account's
   * owner, and closed inside the release guard, before a successor can acquire. A bound endpoint therefore
   * always belongs to the process that owns the session, which is what makes removing a predecessor's socket
   * safe and what keeps the endpoint from ever implying ownership of its own.
   */
  it('opens the endpoint after acquiring the lease and closes it inside the release guard', async () => {
    const calls: string[] = [];
    const channel: RuntimeChannelHost = {
      open: vi.fn(async () => {
        calls.push('channel:open');
        return true;
      }),
      close: vi.fn(() => calls.push('channel:close')),
    };

    const runtime = ownerHarness(channel, calls);
    await runtime.start();
    await runtime.stop();

    expect(calls).toEqual([
      'acquire',
      'channel:open',
      'status:starting',
      'client:start',
      'status:ready',
      'status:stopping',
      'client:stop',
      'release',
      'channel:close',
      'status:stopped',
    ]);
  });

  /**
   * An endpoint that cannot be bound is an absent channel, which every consumer already handles, so it is
   * reported and the runtime starts anyway. Failing startup over it would trade a degraded interface for no
   * plugin at all.
   */
  it('starts the runtime and reports a notice when the endpoint cannot be served', async () => {
    const calls: string[] = [];
    const warn = vi.fn();
    const runtime = ownerHarness({ open: async () => false, close: vi.fn() }, calls, { error: vi.fn(), warn });

    await runtime.start();

    expect(runtime.currentState()).toBe('ready');
    expect(warn).toHaveBeenCalled();
    await runtime.stop();
  });
});

describe('dashboard reading with and without the channel', () => {
  const STALE_NOW = () => Date.parse('2026-08-13T12:10:00.000Z');
  const tracker = { read: async () => trackerRecord() };

  /**
   * The whole point of the read: a dashboard that tells a user to restart Homebridge while the plugin is
   * demonstrably running is a false alarm, and the live state is the one field the persisted record can be a
   * heartbeat behind. The devices still come from the last complete inventory, because that is what a
   * degraded or stale runtime is defined to retain.
   */
  it('prefers the live state over a stale record while keeping the retained devices', async () => {
    const dashboard = await readDashboard(
      tracker,
      STALE_NOW,
      {},
      {
        read: async () => ({ ready: true, status: status({ updatedAt: '2026-08-13T12:09:59.000Z' }) }),
      },
    );

    expect(dashboard.state).toBe('ready');
    expect(dashboard.updatedAt).toBe('2026-08-13T12:09:59.000Z');
    expect(dashboard.devices).toHaveLength(1);
  });

  /**
   * A live runtime that reports a degraded transport is reported as degraded rather than as stale, through
   * the same mapping the persisted record is classified by.
   */
  it('classifies a live status through the same mapping as a persisted one', async () => {
    await expect(
      readDashboard(
        tracker,
        STALE_NOW,
        {},
        {
          read: async () => ({
            ready: true,
            status: status({ state: 'degraded', status: 'transport-degraded', complete: false }),
          }),
        },
      ),
    ).resolves.toMatchObject({ state: 'degraded' });
  });

  /**
   * With no channel at all, and with a channel that cannot answer, the dashboard is the file's verdict alone,
   * for every record it can be asked about. A first setup, a runtime that will not start, a Homebridge
   * stopped on purpose and a package upgraded without a restart are all this case.
   */
  it('is unchanged for every record when no channel answers', async () => {
    const records: Array<[string, RuntimeTrackerRecord | null]> = [
      ['fresh', trackerRecord({ updatedAt: '2026-08-13T12:09:30.000Z' })],
      ['stale', trackerRecord()],
      ['degraded', trackerRecord({ state: 'degraded', status: 'transport-degraded', complete: false })],
      ['authentication-required', trackerRecord({ state: 'authentication-required' })],
      ['missing', null],
    ];

    for (const [name, record] of records) {
      const withoutChannel = await readDashboard({ read: async () => record }, STALE_NOW);
      const withAbsentChannel = await readDashboard(
        { read: async () => record },
        STALE_NOW,
        {},
        {
          read: async () => undefined,
        },
      );

      expect(withAbsentChannel, name).toEqual(withoutChannel);
    }

    await expect(readDashboard(tracker, STALE_NOW)).resolves.toMatchObject({
      state: 'stale',
      updatedAt: trackerRecord().updatedAt,
    });
  });

  /**
   * A record the runtime never wrote is nothing to render, whatever the channel says, because the devices a
   * dashboard shows only ever come from a published inventory.
   */
  it('reports a missing record as missing even when a runtime answers', async () => {
    await expect(
      readDashboard(
        { read: async () => null },
        STALE_NOW,
        {},
        {
          read: async () => ({ ready: true, status: status() }),
        },
      ),
    ).resolves.toEqual({ state: 'missing', devices: [], warmUpCandidates: [] });
  });
});

describe('runtime channel guarantees that must hold rather than be described', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'homebridge-eufy-channel-guards-'));
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  /**
   * The bounds are the ones the specification fixed. Every other contract here overrides them to run in
   * milliseconds, so without this the numbers the design was accepted with would be unasserted.
   */
  it('enforces the bounds the design was accepted with', () => {
    expect({
      connect: RUNTIME_CHANNEL_CONNECT_TIMEOUT_MS,
      response: RUNTIME_CHANNEL_RESPONSE_TIMEOUT_MS,
      idle: RUNTIME_CHANNEL_IDLE_TIMEOUT_MS,
      frame: RUNTIME_CHANNEL_FRAME_BYTES,
    }).toEqual({ connect: 1_000, response: 5_000, idle: 30_000, frame: 1024 * 1024 });
  });

  /**
   * A connection that says nothing is closed, so a client that connects and then stops cannot hold a
   * connection open for as long as the runtime lives.
   */
  it('closes a connection that says nothing', async () => {
    const endpoint = runtimeChannelEndpoint(root, process.platform, tmpdir());
    const server = new RuntimeChannelServer(endpoint, () => status(), { idleTimeoutMs: 30 });
    await server.open();

    const connection = createConnection(endpoint.path);
    await once(connection, 'connect');
    connection.resume();

    await expect(once(connection, 'close')).resolves.toBeDefined();
    server.close();
  });

  /**
   * The address in the shared temporary directory is the one another local user can create an entry at. An
   * entry that is not an owner-only socket belonging to this user is neither connected to nor removed, so a
   * user who created the name first is handed nothing and loses nothing.
   */
  it('refuses a shared address that is not an owner-only socket of this user', async () => {
    const squatted = join(root, 'squatted.sock');
    await writeFile(squatted, 'not a socket');
    const shared: RuntimeChannelEndpoint = { path: squatted, transport: 'socket', shared: true };

    await expect(new RuntimeChannelClient(shared).read()).resolves.toBeUndefined();
    await expect(new RuntimeChannelServer(shared, () => status()).open()).resolves.toBe(false);
    await expect(stat(squatted)).resolves.toBeDefined();
  });

  /**
   * A socket at a shared address whose mode admits another user is refused for the same reason, because the
   * mode is what makes the address owner-only once the directory does not.
   */
  it('refuses a shared socket whose mode admits another user', async () => {
    const endpoint = runtimeChannelEndpoint(root, process.platform, tmpdir());
    const server = new RuntimeChannelServer(endpoint, () => status());
    await server.open();
    await chmod(endpoint.path, 0o666);

    await expect(new RuntimeChannelClient({ ...endpoint, shared: true }).read()).resolves.toBeUndefined();
    await expect(new RuntimeChannelClient(endpoint).read()).resolves.toMatchObject({ ready: true });
    server.close();
  });

  /**
   * The endpoint grants nothing. A bound, answering channel does not make its process the account's owner,
   * so ownership is still decided only by the lease.
   */
  it('grants no ownership by being bound', async () => {
    const endpoint = runtimeChannelEndpoint(root, process.platform, tmpdir());
    const server = new RuntimeChannelServer(endpoint, () => status());
    await server.open();
    await expect(new RuntimeChannelClient(endpoint).read()).resolves.toMatchObject({ ready: true });

    const ownership = new AccountOwnership(join(root, 'ownership'));

    await expect(ownership.acquire('channel@example.invalid', 'temporary-authentication')).resolves.toMatchObject({
      state: 'owner',
    });
    server.close();
  });

  /**
   * A multi-byte character split across two chunks is one character, so a frame is read as it was written
   * whatever the boundaries the stream happened to deliver it on.
   */
  it('reads a frame split across chunks mid-character', () => {
    const reader = new FrameReader();
    const written = Buffer.from(`{"generation":"génération"}\n`, 'utf8');
    const split = written.indexOf(0xc3);

    expect(reader.accept(written.subarray(0, split + 1))).toEqual([]);
    expect(reader.accept(written.subarray(split + 1))).toEqual(['{"generation":"génération"}']);
  });

  /**
   * The bound is on what remains unterminated, not on what arrived, so frames that together exceed it are
   * still read while one frame that does is refused.
   */
  it('bounds an unterminated frame rather than an accepted chunk', () => {
    const reader = new FrameReader(16);

    expect(reader.accept(Buffer.from('"aaaa"\n"bbbb"\n"cccc"\n', 'utf8'))).toEqual(['"aaaa"', '"bbbb"', '"cccc"']);
    expect(reader.accept(Buffer.from('x'.repeat(17), 'utf8'))).toBeUndefined();
  });
});

describe('runtime channel device observations', () => {
  let root: string;
  let servers: RuntimeChannelServer[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'homebridge-eufy-channel-devices-'));
    servers = [];
  });

  afterEach(async () => {
    for (const server of servers) {
      server.close();
    }
    await rm(root, { force: true, recursive: true });
  });

  async function serveDevices(devices: () => RuntimeChannelDevice[]): Promise<RuntimeChannelClient> {
    const endpoint = runtimeChannelEndpoint(root, process.platform, tmpdir());
    const server = new RuntimeChannelServer(endpoint, () => status(), { devices });
    servers.push(server);
    await server.open();
    return new RuntimeChannelClient(endpoint);
  }

  /**
   * The observations the runtime holds and the file does not: whether a device is reachable, and whether a
   * camera reports itself switched on. Both arrive on the same connection as the status, correlated by
   * request identity rather than by order.
   */
  it('answers reachability and camera enablement alongside the status', async () => {
    const client = await serveDevices(() => [
      { serial: 'synthetic-camera', availability: 'available', enabled: true },
      { serial: 'synthetic-doorbell', availability: 'unavailable', enabled: false },
    ]);

    await expect(client.read()).resolves.toEqual({
      ready: true,
      status: status(),
      devices: [
        { serial: 'synthetic-camera', availability: 'available', enabled: true },
        { serial: 'synthetic-doorbell', availability: 'unavailable', enabled: false },
      ],
    });
  });

  /**
   * An unobserved field is absent, never false. A camera the SDK declines to stand behind and a device whose
   * reachability nothing has reported are both unknown, and reporting either as `false` would publish a
   * working camera as switched off.
   */
  it('omits an unobserved field rather than answering false', async () => {
    const client = await serveDevices(() => [{ serial: 'synthetic-sensor' }]);

    const reading = await client.read();

    expect(reading?.devices).toEqual([{ serial: 'synthetic-sensor' }]);
    expect(Object.keys(reading!.devices![0]!)).toEqual(['serial']);
  });

  /**
   * A newer client asking an older runtime for observations it does not serve is the upgrade-without-restart
   * case at the grain of one path. The refusal leaves the reading without observations and the status intact,
   * so a path added inside one protocol version needs no version of its own.
   */
  it('reads the status from a runtime that serves no observations', async () => {
    const endpoint = runtimeChannelEndpoint(root, process.platform, tmpdir());
    const server = new RuntimeChannelServer(endpoint, () => status());
    servers.push(server);
    await server.open();

    await expect(new RuntimeChannelClient(endpoint).read()).resolves.toEqual({
      ready: true,
      status: status(),
    });
  });

  /**
   * The observations are projected onto their own closed field set, so nothing a provider carries beside them
   * reaches the wire. A serial is the key an observation is attached by and already reaches the UI in the
   * persisted snapshot; an address, an account identifier and anything credential-shaped do not.
   */
  it('answers a closed device field set and nothing beside it', async () => {
    const client = await serveDevices(() => [
      Object.assign(
        { serial: 'synthetic-camera', availability: 'available' as const, enabled: true },
        { address: '10.0.0.9', userId: 'synthetic-user', authToken: SUBMITTED_PASSWORD },
      ),
    ]);

    const reading = await client.read();

    expect(Object.keys(reading!.devices![0]!).sort()).toEqual(['availability', 'enabled', 'serial']);
    expect(JSON.stringify(reading)).not.toMatch(/password|credential|captcha|answer|authToken|cookie|secret/i);
  });
});

describe('runtime observations taken from the live registry', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'homebridge-eufy-channel-registry-'));
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  function surfaceManifest(serial: string, codec: DeviceManifest['codec'], accessor: string): DeviceManifest {
    return {
      sn: serial,
      name: `Synthetic ${codec}`,
      model: codec === 'camera' ? 'T8410' : 'T8910',
      modelName: `Synthetic ${codec}`,
      codec,
      source: 'security',
      bound: true,
      capabilities: [accessor] as DeviceManifest['capabilities'],
      details: [
        {
          capability: accessor as DeviceManifest['details'][number]['capability'],
          accessor,
          reads: [
            {
              accessor: accessor === 'camera' ? 'enabled' : 'open',
              property: 'synthetic',
              type: 'bool',
              writable: accessor === 'camera',
            },
          ],
          actions: [],
          undescribedActions: [],
          events: [],
        },
      ],
    };
  }

  /**
   * The whole chain, through the endpoint a real runtime binds: the observations are taken from the registry
   * the runtime already holds and the evidence its own published manifest carries, answered through the one
   * owner of the enablement trust gate, and read back by the client the UI uses. No second capability model is
   * built, and the UI opens no SDK client to learn any of it.
   *
   * The camera reports itself switched off and its reachability is unavailable, so both are answered. The
   * contact sensor beside it has no enablement to report and nothing has observed its reachability, so it is
   * answered with its serial alone: unobserved is neither unreachable nor switched off.
   */
  it('answers what it observes and no more, over the endpoint a runtime binds', async () => {
    const calls: string[] = [];
    const camera = surfaceManifest('synthetic-camera', 'camera', 'camera');
    const sensor = surfaceManifest('synthetic-sensor', 'sensor', 'contact');
    const observed: AvailabilityObservation = {
      entity: { kind: 'device', sn: 'synthetic-camera' },
      availability: 'unavailable',
      source: { transport: 'smqtt', signal: 'state-info' },
      scope: 'device',
      receivedAt: 1,
    };

    const runtime = ownerHarness(undefined, calls, undefined, {
      storageRoot: root,
      snapshot: { version: 1, complete: true, devices: [camera, sensor] },
      registry: new Map([
        ['synthetic-camera', { describe: () => camera, camera: () => ({ enabled: false }) } as unknown as Device],
        ['synthetic-sensor', { describe: () => sensor } as unknown as Device],
      ]),
      availability: true,
      availabilityFor: (serial) => (serial === 'synthetic-camera' ? observed : undefined),
    });
    await runtime.start();

    const reading = await new RuntimeChannelClient(runtimeChannelEndpointForHost(root)).read();

    expect(reading?.devices).toEqual([
      { serial: 'synthetic-camera', availability: 'unavailable', enabled: false },
      { serial: 'synthetic-sensor' },
    ]);
    await runtime.stop();
  });
});

describe('dashboard devices with and without observations', () => {
  const NOW = () => Date.parse('2026-08-13T12:00:30.000Z');

  function reading(devices?: RuntimeChannelDevice[]): RuntimeStatusChannel {
    return { read: async () => ({ ready: true, status: status(), ...(devices ? { devices } : {}) }) };
  }

  /**
   * An observation reaches the tile it belongs to, keyed by the serial the published inventory already carries.
   */
  it('attaches an observation to the device it belongs to', async () => {
    const dashboard = await readDashboard(
      { read: async () => trackerRecord() },
      NOW,
      {},
      reading([{ serial: 'synthetic-sensor', availability: 'unavailable', enabled: false }]),
    );

    expect(dashboard.devices[0]).toMatchObject({
      serial: 'synthetic-sensor',
      availability: 'unavailable',
      enabled: false,
    });
  });

  /**
   * A device no observation mentions, and every device when the runtime serves no observations at all, carry
   * no observed field rather than a false one. A tile must not read as unreachable or switched off because
   * nothing was asked.
   */
  it('leaves an unobserved device without observed fields', async () => {
    const unmentioned = await readDashboard({ read: async () => trackerRecord() }, NOW, {}, reading([]));
    const unserved = await readDashboard({ read: async () => trackerRecord() }, NOW, {}, reading());
    const unchanneled = await readDashboard({ read: async () => trackerRecord() }, NOW);

    for (const dashboard of [unmentioned, unserved, unchanneled]) {
      expect(dashboard.devices[0]).not.toHaveProperty('availability');
      expect(dashboard.devices[0]).not.toHaveProperty('enabled');
    }
    expect(unserved.devices).toEqual(unchanneled.devices);
  });
});

describe('runtime channel refuses rather than propagates', () => {
  let root: string;
  let servers: RuntimeChannelServer[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'homebridge-eufy-channel-faults-'));
    servers = [];
  });

  afterEach(async () => {
    for (const server of servers) {
      server.close();
    }
    await rm(root, { force: true, recursive: true });
  });

  /**
   * A provider reaches into the runtime's own registry and manifest evidence, either of which may throw, and
   * it runs inside a socket's data listener. No read of this channel may end the process that owns the Eufy
   * session, so a fault is a refusal and the rest of the answer stands.
   */
  it('answers a refusal when a provider faults, and does not propagate it', async () => {
    const endpoint = runtimeChannelEndpoint(root, process.platform, tmpdir());
    const server = new RuntimeChannelServer(endpoint, () => status(), {
      devices: () => {
        throw new Error('registry faulted');
      },
    });
    servers.push(server);
    await server.open();
    const uncaught = vi.fn();
    process.once('uncaughtException', uncaught);

    await expect(new RuntimeChannelClient(endpoint).read()).resolves.toEqual({ ready: true, status: status() });

    process.off('uncaughtException', uncaught);
    expect(uncaught).not.toHaveBeenCalled();
  });

  /**
   * A runtime that answers its status and then says nothing costs one answer, not both. The status and the
   * observations are separate answers, so only a read that produced no status at all is an absence.
   */
  it('concludes with the status alone when the observations never settle', async () => {
    const endpoint = runtimeChannelEndpoint(root, process.platform, tmpdir());
    const silent = createServer((connection) => {
      connection.write(`${JSON.stringify({ protocol: RUNTIME_CHANNEL_PROTOCOL, ready: true, state: 'ready' })}\n`);
      connection.once('data', () => {
        connection.write(`${JSON.stringify({ id: 1, ok: true, data: status() })}\n`);
      });
    });
    await new Promise<void>((resolve) => silent.listen(endpoint.path, resolve));

    try {
      await expect(new RuntimeChannelClient(endpoint, { responseTimeoutMs: 60 }).read()).resolves.toEqual({
        ready: true,
        status: status(),
      });
    } finally {
      silent.close();
    }
  });

  /**
   * A surface belonging to a stopped SDK client states nothing about a device now, so a read taken while the
   * runtime is shutting down but its endpoint is still bound observes nothing rather than a retained value.
   */
  it('observes nothing once the SDK client is gone', async () => {
    const calls: string[] = [];
    const manifest: DeviceManifest = {
      sn: 'synthetic-camera',
      name: 'Synthetic Camera',
      model: 'T8410',
      modelName: 'Synthetic Camera',
      codec: 'camera',
      source: 'security',
      bound: true,
      capabilities: ['camera'] as DeviceManifest['capabilities'],
      details: [
        {
          capability: 'camera' as DeviceManifest['details'][number]['capability'],
          accessor: 'camera',
          reads: [{ accessor: 'enabled', property: 'synthetic', type: 'bool', writable: true }],
          actions: [],
          undescribedActions: [],
          events: [],
        },
      ],
    };
    const runtime = ownerHarness(undefined, calls, undefined, {
      storageRoot: root,
      snapshot: { version: 1, complete: true, devices: [manifest] },
      registry: new Map([
        ['synthetic-camera', { describe: () => manifest, camera: () => ({ enabled: true }) } as unknown as Device],
      ]),
      stopsSlowly: true,
    });
    await runtime.start();
    const client = new RuntimeChannelClient(runtimeChannelEndpointForHost(root));

    await expect(client.read()).resolves.toMatchObject({
      devices: [{ serial: 'synthetic-camera', enabled: true }],
    });

    const stopping = runtime.stop();
    await vi.waitFor(async () => await expect(client.read()).resolves.toMatchObject({ devices: [] }));
    await stopping;
  });
});

describe('diagnostics authorization notified over the channel', () => {
  let root: string;
  let servers: RuntimeChannelServer[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'homebridge-eufy-channel-diagnostics-'));
    servers = [];
  });

  afterEach(async () => {
    for (const server of servers) {
      server.close();
    }
    await rm(root, { force: true, recursive: true });
  });

  function serve(pickUp: (notice: RuntimeChannelAuthorization) => boolean): RuntimeChannelClient {
    const endpoint = runtimeChannelEndpoint(root, process.platform, tmpdir());
    const server = new RuntimeChannelServer(endpoint, () => status(), { authorization: pickUp });
    servers.push(server);
    return new RuntimeChannelClient(endpoint);
  }

  /**
   * The notification carries the identity of the session the sender wrote and nothing else, projected onto
   * that one field on the way in, because a request arriving on this channel is untrusted input in the
   * process that owns the Eufy session.
   */
  it('carries the session identity the protocol declares and no other field', async () => {
    const picked: RuntimeChannelAuthorization[] = [];
    const client = serve((notice) => {
      picked.push(notice);
      return true;
    });
    await servers[0]!.open();

    await client.notifyAuthorization(SYNTHETIC_SUPPORT_CASE_ID);

    expect(picked).toEqual([{ supportCaseId: SYNTHETIC_SUPPORT_CASE_ID }]);
  });

  /**
   * A body that does not carry a support case identifier is refused without reaching the pickup, so no
   * supplied string becomes a path, a filter, or a record inside the runtime process.
   */
  it('refuses a body that carries no session identity this protocol accepts', async () => {
    const picked: RuntimeChannelAuthorization[] = [];
    const endpoint = runtimeChannelEndpoint(root, process.platform, tmpdir());
    const server = new RuntimeChannelServer(endpoint, () => status(), {
      authorization: (notice) => {
        picked.push(notice);
        return true;
      },
    });
    servers.push(server);
    await server.open();

    const connection = createConnection(endpoint.path);
    await once(connection, 'connect');
    let received = '';
    connection.on('data', (chunk: Buffer) => (received += chunk.toString('utf8')));
    await once(connection, 'data');
    for (const body of [undefined, { supportCaseId: '../../etc/passwd' }, { supportCaseId: 42 }, []]) {
      connection.write(
        `${JSON.stringify({ v: RUNTIME_CHANNEL_PROTOCOL, id: 3, path: RUNTIME_DIAGNOSTICS_PATH, body })}\n`,
      );
    }
    await vi.waitFor(() => expect(received.trimEnd().split('\n')).toHaveLength(5));
    connection.destroy();

    expect(
      received
        .trimEnd()
        .split('\n')
        .slice(1)
        .map((frame) => JSON.parse(frame)),
    ).toEqual([
      { id: 3, ok: false },
      { id: 3, ok: false },
      { id: 3, ok: false },
      { id: 3, ok: false },
    ]);
    expect(picked).toEqual([]);
  });

  /**
   * A notification the file does not confirm is refused, and a refusal is not a client error: the file is the
   * authority, so the sender learns nothing new and the UI behaves as it does without the channel.
   */
  it('resolves when the runtime refuses the notification', async () => {
    const client = serve(() => false);
    await servers[0]!.open();

    await expect(client.notifyAuthorization(SYNTHETIC_SUPPORT_CASE_ID)).resolves.toBeUndefined();
  });

  /**
   * Absence is the one outcome for every way the channel cannot be used, and a notification is delivered on
   * the same terms as a read: there is nothing to tell, and nothing to report.
   */
  it('resolves when no runtime is there to notify', async () => {
    const client = new RuntimeChannelClient(runtimeChannelEndpoint(root, process.platform, tmpdir()));

    await expect(client.notifyAuthorization(SYNTHETIC_SUPPORT_CASE_ID)).resolves.toBeUndefined();
  });

  /**
   * The pickup reads a file and writes a record, either of which may throw, and it runs inside a socket data
   * listener in the process that owns the Eufy session. A refusal is the answer instead.
   */
  it('refuses rather than propagates a pickup that faults', async () => {
    const client = serve(() => {
      throw new Error('synthetic pickup failure');
    });
    await servers[0]!.open();

    await expect(client.notifyAuthorization(SYNTHETIC_SUPPORT_CASE_ID)).resolves.toBeUndefined();
    await expect(client.read()).resolves.toMatchObject({ ready: true });
  });

  /**
   * A runtime older than this path serves no pickup at all, which is a refusal and not a fault, so an
   * upgrade without a Homebridge restart notifies a runtime that ignores it and nothing surfaces.
   */
  it('resolves against a runtime that serves no pickup', async () => {
    const endpoint = runtimeChannelEndpoint(root, process.platform, tmpdir());
    const server = new RuntimeChannelServer(endpoint, () => status());
    servers.push(server);
    await server.open();

    await expect(
      new RuntimeChannelClient(endpoint).notifyAuthorization(SYNTHETIC_SUPPORT_CASE_ID),
    ).resolves.toBeUndefined();
  });
});

describe('a runtime picking up an authorization it is notified of', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'homebridge-eufy-channel-pickup-'));
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  async function records(): Promise<Record<string, unknown>[]> {
    return (await readFile(join(root, 'logs', 'homebridge-eufy.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  /**
   * The whole chain the latency change exists for: the UI writes the file, notifies over the channel, and the
   * runtime reads the file it was told about at once rather than whenever an unrelated record next arrives.
   * The record the runtime writes is the evidence that the window opened in the process the evidence comes
   * from.
   */
  it('reads the file at once and records the window it opened', async () => {
    const authorized = await new GuidedDiagnostics(root).authorize('startup-authentication', 'now');
    const log = createDiagnosticLogger({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }, root);
    const runtime = ownerHarness(undefined, [], log, {
      storageRoot: root,
      snapshot: { version: 1, complete: true, devices: [] },
      registry: new Map(),
    });
    await runtime.start();

    await new RuntimeChannelClient(runtimeChannelEndpointForHost(root)).notifyAuthorization(authorized.supportCaseId!);
    await vi.waitFor(async () => {
      await log.flush?.();
      expect(await records()).toEqual([
        expect.objectContaining({ scope: 'runtime-notice', level: 'info', code: 'diagnostics-authorization-armed' }),
      ]);
    });
    await runtime.stop();
  });

  /**
   * The file is the authority. A notification naming a session it does not hold changes nothing, which is
   * what keeps a shared address from letting another local process open an evidence window.
   */
  it('changes nothing when the file does not confirm the session', async () => {
    await new GuidedDiagnostics(root).authorize('startup-authentication', 'now');
    const log = createDiagnosticLogger({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }, root);
    const runtime = ownerHarness(undefined, [], log, {
      storageRoot: root,
      snapshot: { version: 1, complete: true, devices: [] },
      registry: new Map(),
    });
    await runtime.start();

    await new RuntimeChannelClient(runtimeChannelEndpointForHost(root)).notifyAuthorization(SYNTHETIC_SUPPORT_CASE_ID);
    await log.flush?.();

    expect(existsSync(join(root, 'logs', 'homebridge-eufy.jsonl'))).toBe(false);
    await runtime.stop();
  });
});

describe('a stand-down requested over the channel', () => {
  let root: string;
  let servers: RuntimeChannelServer[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'homebridge-eufy-channel-stand-down-'));
    servers = [];
  });

  afterEach(async () => {
    for (const server of servers) {
      server.close();
    }
    await rm(root, { force: true, recursive: true });
  });

  /**
   * The runtime answers that it accepted the request and then closes the endpoint inside its release guard, so
   * the closing is what a client observes. Acceptance is a claim; only the lease is evidence, and this reports
   * the claim so a caller knows whether to wait for the lease at all.
   */
  it('reports a stand-down the runtime accepted and then completed', async () => {
    const endpoint = runtimeChannelEndpoint(root, process.platform, tmpdir());
    const server = new RuntimeChannelServer(endpoint, () => status(), {
      standDown: () => {
        setTimeout(() => server.close(), 5);
        return true;
      },
    });
    servers.push(server);
    await server.open();

    await expect(new RuntimeChannelClient(endpoint).requestStandDown()).resolves.toBe(true);
  });

  /**
   * A runtime that holds no lease has nothing to release and refuses, which the caller must distinguish from a
   * stand-down, because the manual instruction still applies.
   */
  it('reports a refusal as no stand-down', async () => {
    const endpoint = runtimeChannelEndpoint(root, process.platform, tmpdir());
    const server = new RuntimeChannelServer(endpoint, () => status(), { standDown: () => false });
    servers.push(server);
    await server.open();

    await expect(new RuntimeChannelClient(endpoint).requestStandDown()).resolves.toBe(false);
  });

  /**
   * A runtime running code older than this path serves no stand-down and answers a refusal, and one that is not
   * there answers nothing. Both are the behaviour without the channel.
   */
  it('reports no stand-down from a runtime that serves none, or none at all', async () => {
    const endpoint = runtimeChannelEndpoint(root, process.platform, tmpdir());
    const server = new RuntimeChannelServer(endpoint, () => status());
    servers.push(server);

    await expect(new RuntimeChannelClient(endpoint).requestStandDown()).resolves.toBe(false);
    await server.open();
    await expect(new RuntimeChannelClient(endpoint).requestStandDown()).resolves.toBe(false);
  });

  /**
   * A protocol this client does not speak is never sent a stand-down, because a frame read as something else by
   * an older runtime could take a session down without anything asking it to.
   */
  it('sends nothing to a runtime that speaks another protocol', async () => {
    const endpoint = runtimeChannelEndpoint(root, process.platform, tmpdir());
    const standDown = vi.fn(() => true);
    const server = new RuntimeChannelServer(endpoint, () => status(), {
      protocol: RUNTIME_CHANNEL_PROTOCOL + 1,
      standDown,
    });
    servers.push(server);
    await server.open();

    await expect(new RuntimeChannelClient(endpoint).requestStandDown()).resolves.toBe(false);
    expect(standDown).not.toHaveBeenCalled();
  });

  /**
   * The bound outlasts the runtime's own bounded shutdown, because the endpoint closes at the end of it.
   */
  it('waits longer for a stand-down than the runtime shutdown deadline it must outlast', () => {
    expect(RUNTIME_CHANNEL_STAND_DOWN_TIMEOUT_MS).toBeGreaterThan(10_000);
  });
});
