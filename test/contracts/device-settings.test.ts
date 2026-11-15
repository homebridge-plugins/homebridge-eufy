import type { Device } from '@mega-yfue/eufy-sdk';
import { describe, expect, it, vi } from 'vitest';

import { readDeviceSettings, writeDeviceSetting } from '../../src/runtime/device-settings.js';

const NIGHT_VISION_LABELS = { '0': 'Off', '1': 'Infrared', '2': 'Full Color' };

/** A device whose surface states the given members, described the way the SDK describes them. */
function device(options: { setNightVision?: boolean; detectionEnabled?: boolean } = {}) {
  const setNightVision = vi.fn(async () => undefined);
  const setDetection = vi.fn(async () => undefined);
  const camera = {
    nightVision: 1,
    ...(options.setNightVision === false ? {} : { setNightVision }),
  };
  const motion = { detectionEnabled: options.detectionEnabled ?? true, setDetection };
  return {
    setNightVision,
    setDetection,
    device: {
      camera: () => camera,
      motion: () => motion,
      describe: () => ({
        details: [
          {
            capability: 'camera',
            reads: [
              {
                accessor: 'nightVision',
                labels: NIGHT_VISION_LABELS,
                writable: options.setNightVision !== false,
              },
              { accessor: 'notificationStyle', writable: true },
            ],
          },
          { capability: 'motion', reads: [{ accessor: 'detectionEnabled', writable: true }] },
        ],
      }),
    } as unknown as Device,
  };
}

describe('device settings', () => {
  /**
   * A setting is answered with the value its typed getter states and the labels and writability its description
   * gives. One the device describes but does not state, here the notification style, is left out.
   */
  it('reads each stated setting with its description', () => {
    expect(readDeviceSettings(device().device)).toEqual([
      { setting: 'motionDetection', value: true, writable: true },
      { setting: 'nightVision', value: 1, labels: NIGHT_VISION_LABELS, writable: true },
    ]);
  });

  /** A device whose description cannot be read answers no settings rather than a partial guess. */
  it('answers nothing where the device cannot describe itself', () => {
    const faulty = {
      describe: () => {
        throw new Error('synthetic fault');
      },
    } as unknown as Device;
    expect(readDeviceSettings(faulty)).toEqual([]);
  });

  /** A write goes through the typed setter it names, and is refused where the device offers none. */
  it('writes through the typed setter and refuses without one', async () => {
    const writable = device();
    await expect(
      writeDeviceSetting(writable.device, { serial: 'T8000P0000000000', setting: 'nightVision', value: 2 }),
    ).resolves.toBe(true);
    expect(writable.setNightVision).toHaveBeenCalledWith(2);
    await expect(
      writeDeviceSetting(writable.device, { serial: 'T8000P0000000000', setting: 'motionDetection', value: false }),
    ).resolves.toBe(true);
    expect(writable.setDetection).toHaveBeenCalledWith(false);

    const readOnly = device({ setNightVision: false });
    await expect(
      writeDeviceSetting(readOnly.device, { serial: 'T8000P0000000000', setting: 'nightVision', value: 2 }),
    ).resolves.toBe(false);
    await expect(
      writeDeviceSetting(readOnly.device, { serial: 'T8000P0000000000', setting: 'notificationStyle', value: 1 }),
    ).resolves.toBe(false);
  });
});
