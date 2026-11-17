import type { AnyDeviceEvent, LeakActions } from '@mega-yfue/eufy-sdk';

import {
  ownService,
  type AdapterAttachmentContext,
  type AdapterEventTrace,
  type AttachedAdapter,
  type HomeKitAdapter,
} from '../adapter.js';
import { observationReader } from '../device-control.js';

export const LEAK_ADAPTER_KEY = 'leak.sensor';
const LEAK_OWNERS = new WeakMap<object, symbol>();

const LEAK_DETECTED_REQUIREMENT = {
  id: 'leak.leakDetected.read',
  kind: 'read',
  type: 'bool',
  writable: false,
} as const;

/** Complete HomeKit policy for the water sensor's water-detected state. */
export const LEAK_ADAPTER = {
  key: LEAK_ADAPTER_KEY,
  role: 'primary-purpose',
  requires: [LEAK_DETECTED_REQUIREMENT],
  coverage: [LEAK_DETECTED_REQUIREMENT.id],
  attach: attachLeak,
} as const satisfies HomeKitAdapter;

/**
 * Attaches the SDK's water-detected read to one official HomeKit Leak Sensor service, answered fail-closed from the
 * device's own reading and pushed on the SDK's property announcement for the property the manifest names.
 */
function attachLeak(context: AdapterAttachmentContext): AttachedAdapter {
  const { accessory, hap } = context;
  const device = context.device as { leak?: () => LeakActions | undefined };
  const service = ownService(accessory, hap.Service.LeakSensor, accessory.displayName, LEAK_ADAPTER_KEY);
  const owner = Symbol('leak-owner');
  LEAK_OWNERS.set(service, owner);
  const announcedProperty = context.evidence.get(LEAK_DETECTED_REQUIREMENT.id)?.property;
  const readBoolean = observationReader(context, 'boolean', 'invalid-leak-observation');
  const hapValue = (leak: boolean): number =>
    leak ? hap.Characteristic.LeakDetected.LEAK_DETECTED : hap.Characteristic.LeakDetected.LEAK_NOT_DETECTED;

  service.getCharacteristic(hap.Characteristic.LeakDetected).onGet(() => {
    const leak = readBoolean('leak', 'leakDetected', () => device.leak?.()?.leakDetected);
    context.observed('invalid-leak-observation');
    return hapValue(leak);
  });

  return {
    event(event: AnyDeviceEvent): AdapterEventTrace | undefined {
      if (
        event.eventName !== 'propertyChanged' ||
        announcedProperty === undefined ||
        event.property !== announcedProperty
      ) {
        return undefined;
      }
      if (typeof event.value !== 'boolean') {
        return { event: 'leak-state', observation: event.value === undefined ? 'missing' : 'malformed' };
      }
      service.updateCharacteristic(hap.Characteristic.LeakDetected, hapValue(event.value));
      return { event: 'leak-state', observation: 'valid' };
    },
    detach(): void {
      if (LEAK_OWNERS.get(service) === owner) {
        LEAK_OWNERS.delete(service);
        accessory.removeService(service);
      }
    },
  };
}
