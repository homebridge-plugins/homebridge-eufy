import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

import { readDeviceImage } from '../../src/ui/device-image.js';
import type { RuntimeStatusChannel } from '../../src/ui/runtime-channel-client.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0x02, 0xff, 0xd9]);

function channel(enabled?: boolean): RuntimeStatusChannel {
  return {
    read: async () => ({
      ready: true,
      status: { state: 'ready', status: 'connected', complete: true, updatedAt: '2026-09-10T12:00:00.000Z' },
      devices: [{ serial: 'synthetic-camera', ...(enabled === undefined ? {} : { enabled }) }],
    }),
  };
}

const absentChannel: RuntimeStatusChannel = { read: async () => undefined };

describe('retained device image for the dashboard', () => {
  /**
   * A camera that has served a snapshot has one retained image, and the interface ships it as base64 for a
   * `data:` URL, which is the one shape this plugin sends bytes to the browser in.
   */
  it('answers the retained image as base64', async () => {
    const images = { read: vi.fn(async () => JPEG) };

    await expect(readDeviceImage(images, channel(true), 'synthetic-camera')).resolves.toEqual({
      image: JPEG.toString('base64'),
    });
    expect(images.read).toHaveBeenCalledWith('synthetic-camera');
  });

  /**
   * A camera an admitted observation reports as switched off keeps its retained image and is never shown it: a
   * real frame from before the camera was switched off would misrepresent what it is doing now. The image is
   * not even read, so a withheld camera cannot leak through a later change of mind.
   */
  it('withholds the image of a camera observed as disabled', async () => {
    const images = { read: vi.fn(async () => JPEG) };

    await expect(readDeviceImage(images, channel(false), 'synthetic-camera')).resolves.toEqual({ image: null });
    expect(images.read).not.toHaveBeenCalled();
  });

  /**
   * An enablement nothing observes is not a disabled one. A runtime that is not running, a camera whose
   * reading the SDK declines to stand behind, and a device no observation mentions are all served, because
   * withholding on the unknown would blank a tile on every first setup and every stopped runtime.
   */
  it('serves an image whose enablement is unobserved', async () => {
    const images = { read: async () => JPEG };
    const expected = { image: JPEG.toString('base64') };

    await expect(readDeviceImage(images, channel(undefined), 'synthetic-camera')).resolves.toEqual(expected);
    await expect(readDeviceImage(images, absentChannel, 'synthetic-camera')).resolves.toEqual(expected);
    await expect(readDeviceImage(images, images && channel(false), 'synthetic-other')).resolves.toEqual(expected);
  });

  /**
   * A device with no retained image is answered with nothing to show rather than with an error, so the tile
   * keeps the packaged product photograph it already has.
   */
  it('answers nothing to show where no image is retained', async () => {
    await expect(readDeviceImage({ read: async () => undefined }, channel(true), 'synthetic-camera')).resolves.toEqual({
      image: null,
    });
  });
});

interface HarnessImage {
  alt: string;
  attributes: Record<string, string>;
  hidden: boolean;
  src: string;
  listeners: Record<string, () => void>;
  addEventListener(event: string, listener: () => void, options: { once: true }): void;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

interface HarnessTile {
  dataset: { serial: string };
  attributes: Record<string, string>;
  art?: {
    images: HarnessImage[];
    querySelector(selector: string): HarnessImage | null;
    appendChild(image: HarnessImage): void;
  };
  querySelector(selector: string): unknown;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/**
 * One created `img`, behaving as a browser's does for what the walk asks of it.
 *
 * `addEventListener` retains the listener so a test can settle the decode the way a browser settles it, because
 * the tile's scene attribute is set from that callback and not from the assignment to `src`.
 */
function harnessImage(packaged?: string): HarnessImage {
  return {
    alt: 'packaged',
    attributes: packaged === undefined ? {} : { src: packaged },
    hidden: false,
    src: packaged ?? '',
    listeners: {},
    addEventListener(event, listener) {
      this.listeners[event] = listener;
    },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
}

function harnessTile(serial: string, options: { art?: boolean; packaged?: string } = {}): HarnessTile {
  const existing = options.packaged === undefined ? [] : [harnessImage(options.packaged)];
  const art =
    options.art === false
      ? undefined
      : {
          images: existing,
          querySelector: (selector: string) =>
            selector.includes('data-device-artwork') ? (art!.images[0] ?? null) : null,
          appendChild(image: HarnessImage) {
            art!.images.push(image);
          },
        };
  return {
    dataset: { serial },
    attributes: {},
    art,
    querySelector: (selector: string) => (selector === '.device-art' ? (art ?? null) : null),
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
  };
}

function dashboardModule(tiles: HarnessTile[]) {
  const created: HarnessImage[] = [];
  const context = {
    window: {} as {
      HomebridgeEufyDashboard?: { applyDeviceImages(elements: unknown, request: unknown): Promise<void> };
    },
    document: {
      createElement: () => {
        const image = harnessImage();
        image.alt = '';
        created.push(image);
        return image;
      },
    },
  };
  runInNewContext(
    readFileSync(
      join(fileURLToPath(new URL('../..', import.meta.url)), 'homebridge-ui', 'public', 'js', 'dashboard.js'),
      'utf8',
    ),
    context,
  );
  return {
    created,
    apply: (request: (serial: string) => Promise<{ image: string | null } | undefined>) =>
      context.window.HomebridgeEufyDashboard!.applyDeviceImages({ groups: { querySelectorAll: () => tiles } }, request),
  };
}

describe('the dashboard putting a retained image on a camera tile', () => {
  /**
   * One request per camera tile and one at a time, because an image is up to ten megabytes as base64 and asking
   * for the whole grid at once would hold all of it in the page before any of it is shown.
   */
  it('asks for one camera at a time, in the order the tiles appear', async () => {
    const order: string[] = [];
    let inFlight = 0;
    const module = dashboardModule([harnessTile('synthetic-first'), harnessTile('synthetic-second')]);

    await module.apply(async (serial) => {
      order.push(serial);
      expect(++inFlight).toBe(1);
      await Promise.resolve();
      inFlight -= 1;
      return { image: 'c3ludGhldGlj' };
    });

    expect(order).toEqual(['synthetic-first', 'synthetic-second']);
  });

  /**
   * The packaged product photograph stays until the browser has decoded the answer, so the tile is never blank
   * and never shows a frame the decoder rejected.
   */
  it('marks the tile a scene only once the answer has decoded', async () => {
    const tile = harnessTile('synthetic-camera', { packaged: 'assets/devices/security/security-T8410.webp' });
    const module = dashboardModule([tile]);

    await module.apply(async () => ({ image: 'c3ludGhldGlj' }));

    const image = tile.art!.images[0]!;
    expect(image.src).toBe('data:image/jpeg;base64,c3ludGhldGlj');
    expect(tile.attributes['data-artwork-scene']).toBeUndefined();
    image.listeners.load!();
    expect(tile.attributes['data-artwork-scene']).toBe('');
  });

  /**
   * An answer the browser cannot decode restores the packaged photograph rather than leaving a broken image, and
   * a tile that never had one is hidden instead.
   */
  it('restores the packaged photograph when the answer will not decode', async () => {
    const packaged = harnessTile('synthetic-packaged', { packaged: 'assets/devices/security/security-T8410.webp' });
    const bare = harnessTile('synthetic-bare');
    const module = dashboardModule([packaged, bare]);

    await module.apply(async () => ({ image: 'not-an-image' }));

    const restored = packaged.art!.images[0]!;
    restored.listeners.error!();
    expect(restored.src).toBe('assets/devices/security/security-T8410.webp');
    expect(restored.hidden).toBe(false);
    expect(packaged.attributes['data-artwork-scene']).toBeUndefined();

    const created = bare.art!.images[0]!;
    created.listeners.error!();
    expect(created.hidden).toBe(true);
  });

  /**
   * A camera whose request fails or answers nothing to show leaves its tile exactly as it was, and does not stop
   * the cameras after it from being asked.
   */
  it('skips a camera that answers nothing and keeps going', async () => {
    const failing = harnessTile('synthetic-failing');
    const withheld = harnessTile('synthetic-withheld');
    const served = harnessTile('synthetic-served');
    const module = dashboardModule([failing, withheld, served]);

    await module.apply(async (serial) => {
      if (serial === 'synthetic-failing') throw new Error('synthetic request failure');
      return serial === 'synthetic-withheld' ? { image: null } : { image: 'c3ludGhldGlj' };
    });

    expect(failing.art!.images).toEqual([]);
    expect(withheld.art!.images).toEqual([]);
    expect(served.art!.images[0]!.src).toBe('data:image/jpeg;base64,c3ludGhldGlj');
  });

  /**
   * A tile with no artwork container is left alone rather than given one, because where the image belongs is the
   * renderer's decision and not this pass's.
   */
  it('leaves a tile with no artwork container alone', async () => {
    const request = vi.fn(async () => ({ image: 'c3ludGhldGlj' }));
    const module = dashboardModule([harnessTile('synthetic-artless', { art: false })]);

    await module.apply(request);

    expect(request).not.toHaveBeenCalled();
    expect(module.created).toEqual([]);
  });
});
