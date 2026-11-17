import type { AnyDeviceEvent, SmokeActions } from '@mega-yfue/eufy-sdk';

import {
  ownService,
  type AdapterAttachmentContext,
  type AdapterEventTrace,
  type AttachedAdapter,
  type HomeKitAdapter,
} from '../adapter.js';
import { observationReader } from '../device-control.js';

export const SMOKE_ADAPTER_KEY = 'smoke.sensor';
const SMOKE_OWNERS = new WeakMap<object, symbol>();

const SMOKE_DETECTED_REQUIREMENT = {
  id: 'smoke.smokeDetected.read',
  kind: 'read',
  type: 'bool',
  writable: false,
} as const;

/** Complete HomeKit policy for the smoke alarm's smoke-detected state. */
export const SMOKE_ADAPTER = {
  key: SMOKE_ADAPTER_KEY,
  role: 'primary-purpose',
  requires: [SMOKE_DETECTED_REQUIREMENT],
  coverage: [SMOKE_DETECTED_REQUIREMENT.id],
  attach: attachSmoke,
} as const satisfies HomeKitAdapter;

/**
 * Attaches the SDK's smoke-detected read to one official HomeKit Smoke Sensor service, answered fail-closed from the
 * device's own reading and pushed on the SDK's property announcement for the property the manifest names.
 */
function attachSmoke(context: AdapterAttachmentContext): AttachedAdapter {
  const { accessory, hap } = context;
  const device = context.device as { smoke?: () => SmokeActions | undefined };
  const service = ownService(accessory, hap.Service.SmokeSensor, accessory.displayName, SMOKE_ADAPTER_KEY);
  const owner = Symbol('smoke-owner');
  SMOKE_OWNERS.set(service, owner);
  const announcedProperty = context.evidence.get(SMOKE_DETECTED_REQUIREMENT.id)?.property;
  const readBoolean = observationReader(context, 'boolean', 'invalid-smoke-observation');
  const hapValue = (smoke: boolean): number =>
    smoke ? hap.Characteristic.SmokeDetected.SMOKE_DETECTED : hap.Characteristic.SmokeDetected.SMOKE_NOT_DETECTED;

  service.getCharacteristic(hap.Characteristic.SmokeDetected).onGet(() => {
    const smoke = readBoolean('smoke', 'smokeDetected', () => device.smoke?.()?.smokeDetected);
    context.observed('invalid-smoke-observation');
    return hapValue(smoke);
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
        return { event: 'smoke-state', observation: event.value === undefined ? 'missing' : 'malformed' };
      }
      service.updateCharacteristic(hap.Characteristic.SmokeDetected, hapValue(event.value));
      return { event: 'smoke-state', observation: 'valid' };
    },
    detach(): void {
      if (SMOKE_OWNERS.get(service) === owner) {
        SMOKE_OWNERS.delete(service);
        accessory.removeService(service);
      }
    },
  };
}
