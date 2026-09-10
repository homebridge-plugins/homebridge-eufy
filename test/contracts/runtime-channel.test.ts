import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

import type { DeviceManifest } from '@mega-yfue/eufy-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseConfig } from '../../src/configuration.js';
import { AccountOwnership } from '../../src/account/ownership.js';
import {
  FrameReader,
  runtimeChannelEndpoint,
  RuntimeChannelServer,
  RUNTIME_CHANNEL_CONNECT_TIMEOUT_MS,
  RUNTIME_CHANNEL_FRAME_BYTES,
  RUNTIME_CHANNEL_IDLE_TIMEOUT_MS,
  RUNTIME_CHANNEL_PROTOCOL,
  RUNTIME_CHANNEL_RESPONSE_TIMEOUT_MS,
  type RuntimeChannelEndpoint,
  type RuntimeChannelStatus,
} from '../../src/runtime/channel.js';
import { RuntimeOwner, type RuntimeChannelHost } from '../../src/runtime/owner.js';
import type { RuntimeTrackerRecord } from '../../src/runtime/tracker.js';
import type { SdkClient } from '../../src/runtime/sdk-client.js';
import { readDashboard } from '../../src/ui/dashboard.js';
import { RuntimeChannelClient } from '../../src/ui/runtime-channel-client.js';

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

function ownerHarness(channel: RuntimeChannelHost, calls: string[], log = { error: vi.fn(), warn: vi.fn() }) {
  const config = runtimeConfig();
  const client: SdkClient = {
    start: vi.fn(async () => {
      calls.push('client:start');
      return { state: 'ready' as const, registry: new Map(), snapshot: { version: 1, complete: true, devices: [] } };
    }),
    stop: vi.fn(async () => {
      calls.push('client:stop');
    }),
  };
  return new RuntimeOwner(log, config, () => client, {
    storageRoot: '/synthetic-runtime',
    channel,
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
