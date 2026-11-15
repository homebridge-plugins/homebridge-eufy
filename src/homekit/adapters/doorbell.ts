import type { AnyDeviceEvent } from '@mega-yfue/eufy-sdk';

import {
  ownService,
  type AdapterAttachmentContext,
  type AdapterEventTrace,
  type AttachedAdapter,
  type HomeKitAdapter,
} from '../adapter.js';

export const DOORBELL_ADAPTER_KEY = 'doorbell.press';
const DOORBELL_OWNERS = new WeakMap<object, symbol>();

const DOORBELL_PRESS_REQUIREMENT = {
  id: 'doorbell.doorbellPress.event',
  kind: 'event',
} as const;

/** The event name a press arrives under, named once so a consumer does not restate it. */
export const DOORBELL_PRESS_EVENT = 'doorbellPress';

/** Whether a device reports the physical press event this adapter admits. */
export function hasAdmittedDoorbellPress(evidence: AdapterAttachmentContext['evidence']): boolean {
  return evidence.has(DOORBELL_PRESS_REQUIREMENT.id);
}

/** Complete HomeKit policy for admitted physical doorbell presses. */
export const DOORBELL_ADAPTER = {
  key: DOORBELL_ADAPTER_KEY,
  role: 'primary-purpose',
  requires: [DOORBELL_PRESS_REQUIREMENT],
  coverage: [DOORBELL_PRESS_REQUIREMENT.id],
  attach: attachDoorbell,
} as const satisfies HomeKitAdapter;

/** Attaches verified SDK press events to one official HomeKit Doorbell service. */
function attachDoorbell(context: AdapterAttachmentContext): AttachedAdapter {
  const { accessory, hap } = context;
  const service = ownService(accessory, hap.Service.Doorbell, accessory.displayName, DOORBELL_ADAPTER_KEY);
  const owner = Symbol('doorbell-owner');
  DOORBELL_OWNERS.set(service, owner);
  const characteristic = service.getCharacteristic(hap.Characteristic.ProgrammableSwitchEvent);

  return {
    event(event: AnyDeviceEvent): AdapterEventTrace | undefined {
      if (event.eventName !== DOORBELL_PRESS_EVENT) {
        return undefined;
      }
      characteristic.sendEventNotification(hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);
      return { event: 'doorbell-press', observation: 'valid' };
    },
    detach(): void {
      if (DOORBELL_OWNERS.get(service) === owner) {
        DOORBELL_OWNERS.delete(service);
        accessory.removeService(service);
      }
    },
  };
}
