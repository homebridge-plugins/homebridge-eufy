import type { AnyDeviceEvent } from '@mega-yfue/eufy-sdk';

import type { AdapterAttachmentContext, AdapterEventTrace, AttachedAdapter, HomeKitAdapter } from '../adapter.js';

export const PACKAGE_SENSOR_ADAPTER_KEY = 'doorbell.package';

interface PackagePresence {
  detected: boolean;
  owner?: symbol;
}
const PACKAGE_PRESENCE = new WeakMap<object, PackagePresence>();

const PACKAGE_DELIVERED_REQUIREMENT = { id: 'doorbell.packageDelivered.event', kind: 'event' } as const;
const PACKAGE_TAKEN_REQUIREMENT = { id: 'doorbell.packageTaken.event', kind: 'event' } as const;

/** Whether each admitted package event leaves a package waiting. */
const PACKAGE_EVENTS: Readonly<Partial<Record<AnyDeviceEvent['eventName'], boolean>>> = {
  packageDelivered: true,
  packageStranded: true,
  packageTaken: false,
};

/**
 * Complete HomeKit policy for package events: one Occupancy Sensor that reads detected while a package waits.
 *
 * Admission needs both the delivery and the pickup, because a sensor that can be set but never cleared would
 * report a package forever.
 */
export const PACKAGE_SENSOR_ADAPTER = {
  key: PACKAGE_SENSOR_ADAPTER_KEY,
  role: 'supplemental',
  requires: [PACKAGE_DELIVERED_REQUIREMENT, PACKAGE_TAKEN_REQUIREMENT],
  coverage: [PACKAGE_DELIVERED_REQUIREMENT.id, PACKAGE_TAKEN_REQUIREMENT.id, 'doorbell.packageStranded.event'],
  attach: attachPackageSensor,
} as const satisfies HomeKitAdapter;

/**
 * Attaches package events to one Occupancy Sensor service.
 *
 * The state is derived from events alone, as the device offers no read of it: a delivery or a stranded package
 * sets it, a pickup clears it. It is held for the life of the process, across reattachment, and starts not
 * detected in a new process, since a delivery announced while the plugin was not running cannot be observed.
 */
function attachPackageSensor(context: AdapterAttachmentContext): AttachedAdapter {
  const { accessory, hap } = context;
  const service =
    accessory.getServiceById(hap.Service.OccupancySensor, PACKAGE_SENSOR_ADAPTER_KEY) ??
    accessory.addService(hap.Service.OccupancySensor, 'Package', PACKAGE_SENSOR_ADAPTER_KEY);
  const presence = PACKAGE_PRESENCE.get(service) ?? { detected: false };
  PACKAGE_PRESENCE.set(service, presence);
  const owner = Symbol('package-sensor-owner');
  presence.owner = owner;
  const update = (): void => {
    service.updateCharacteristic(
      hap.Characteristic.OccupancyDetected,
      presence.detected
        ? hap.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
        : hap.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
    );
  };
  update();

  return {
    event(event: AnyDeviceEvent): AdapterEventTrace | undefined {
      const detected = PACKAGE_EVENTS[event.eventName];
      if (detected === undefined) {
        return undefined;
      }
      presence.detected = detected;
      update();
      return { event: 'package-presence', observation: 'valid' };
    },
    detach(): void {
      if (presence.owner === owner) {
        presence.owner = undefined;
        accessory.removeService(service);
      }
    },
  };
}
