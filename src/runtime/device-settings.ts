import type { Device } from '@mega-yfue/eufy-sdk';

import type { DeviceSettingName, RuntimeChannelDeviceSetting, RuntimeChannelDeviceSettingWrite } from './channel.js';

/** The capability and getter each setting is read through, which is also where `describe()` states it. */
const SETTING_MEMBERS: Readonly<Record<DeviceSettingName, { capability: 'motion' | 'camera'; accessor: string }>> = {
  motionDetection: { capability: 'motion', accessor: 'detectionEnabled' },
  nightVision: { capability: 'camera', accessor: 'nightVision' },
  notificationStyle: { capability: 'camera', accessor: 'notificationStyle' },
};

/** The value one setting states now through its typed getter, or nothing where the device states none. */
function settingValue(device: Device, setting: DeviceSettingName): boolean | number | undefined {
  switch (setting) {
    case 'motionDetection':
      return device.motion?.()?.detectionEnabled;
    case 'nightVision':
      return device.camera?.()?.nightVision;
    case 'notificationStyle':
      return device.camera?.()?.notificationStyle;
  }
}

/**
 * The settings one device states now, each with the labels and writability its own description gives.
 *
 * A setting the device does not state is left out. The capability accessors are calls into the SDK's binding and
 * can fault, which leaves that setting out rather than the whole answer.
 */
export function readDeviceSettings(device: Device): RuntimeChannelDeviceSetting[] {
  let details: ReturnType<Device['describe']>['details'] = [];
  try {
    details = device.describe().details;
  } catch {
    return [];
  }
  return (Object.keys(SETTING_MEMBERS) as DeviceSettingName[]).flatMap((setting) => {
    const member = SETTING_MEMBERS[setting];
    const read = details
      .find((detail) => detail.capability === member.capability)
      ?.reads.find((entry) => entry.accessor === member.accessor);
    let value: boolean | number | undefined;
    try {
      value = settingValue(device, setting);
    } catch {
      return [];
    }
    if (!read || value === undefined) {
      return [];
    }
    return [
      {
        setting,
        value,
        ...(read.labels === undefined ? {} : { labels: { ...read.labels } }),
        writable: read.writable,
      },
    ];
  });
}

/**
 * Writes one setting through its typed setter, reporting whether the SDK delivered it.
 *
 * False where the device offers no setter for it. Delivery is not convergence: the device's next statement of the
 * setting is what says it changed.
 */
export async function writeDeviceSetting(device: Device, write: RuntimeChannelDeviceSettingWrite): Promise<boolean> {
  switch (write.setting) {
    case 'motionDetection': {
      const motion = device.motion?.();
      if (typeof motion?.setDetection !== 'function' || typeof write.value !== 'boolean') return false;
      await motion.setDetection(write.value);
      return true;
    }
    case 'nightVision': {
      const camera = device.camera?.();
      if (typeof camera?.setNightVision !== 'function' || typeof write.value !== 'number') return false;
      await camera.setNightVision(write.value as Parameters<typeof camera.setNightVision>[0]);
      return true;
    }
    case 'notificationStyle': {
      const camera = device.camera?.();
      if (typeof camera?.setNotificationStyle !== 'function' || typeof write.value !== 'number') return false;
      await camera.setNotificationStyle(write.value as Parameters<typeof camera.setNotificationStyle>[0]);
      return true;
    }
  }
}
