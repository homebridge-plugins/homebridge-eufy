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
