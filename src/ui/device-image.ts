import type { PersistedLastSuccessfulImages } from '../media/last-successful-image.js';
import type { RuntimeStatusChannel } from './runtime-channel-client.js';

/** One answer to a request for a device's retained image: the JPEG as base64, or nothing to show. */
export interface DeviceImage {
  image: string | null;
}

/**
 * The retained last successful image for one device, where it exists and may be shown.
 *
 * Withheld for a camera an admitted observation reports as disabled: a real frame from before the camera was
 * switched off would misrepresent what it is doing now. An enablement nothing observes is not a disabled one,
 * so a device on a runtime that is not running, and a camera whose reading the SDK declines to stand behind,
 * are served. Withholding on the unknown instead would blank a tile on every first setup and every stopped
 * runtime, which is the more common state by far.
 *
 * The image is answered as base64 for a `data:` URL, which is the one shape this interface ships bytes to the
 * browser in. Nothing here reaches a log or a support archive: these are plaintext camera images, and the
 * archive excludes their class permanently.
 */
export async function readDeviceImage(
  images: Pick<PersistedLastSuccessfulImages, 'read'>,
  channel: RuntimeStatusChannel,
  serial: string,
): Promise<DeviceImage> {
  const reading = await channel.read();
  if (reading?.devices?.find((device) => device.serial === serial)?.enabled === false) {
    return { image: null };
  }
  const jpeg = await images.read(serial);
  return { image: jpeg ? jpeg.toString('base64') : null };
}
