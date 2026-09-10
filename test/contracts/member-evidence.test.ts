import type { CapabilityDescriptor, DeviceManifest } from '@mega-yfue/eufy-sdk';
import { describe, expect, it } from 'vitest';

import {
  indexDeviceEvidence,
  indexDeviceMemberEvidence,
  satisfiesMemberRequirements,
  satisfiesProductRequirement,
} from '../../src/device/member-evidence.js';
import { cameraEnablement, observesCameraEnablement } from '../../src/device/member-trust.js';

function manifest(details: CapabilityDescriptor[]): DeviceManifest {
  return {
    sn: 'synthetic-evidence',
    name: 'Synthetic evidence device',
    modelName: 'Synthetic model',
    codec: 'unknown',
    source: 'security',
    bound: true,
    capabilities: details.map(({ capability }) => capability),
    details,
  };
}

function contactDetail(writable = false): CapabilityDescriptor {
  return {
    capability: 'contact',
    accessor: 'contact',
    reads: [{ accessor: 'open', property: 'synthetic_contact_open', type: 'bool', writable }],
    actions: [],
    undescribedActions: [],
    events: ['contactState'],
  };
}

describe('device member evidence', () => {
  it('indexes semantic members without assigning HomeKit meaning', () => {
    const evidence = indexDeviceMemberEvidence(manifest([contactDetail()]));

    expect([...evidence.values()]).toEqual([
      {
        id: 'contact.open.read',
        kind: 'read',
        type: 'bool',
        writable: false,
        property: 'synthetic_contact_open',
      },
      { id: 'contact.contactState.event', kind: 'event' },
    ]);
    expect(
      satisfiesMemberRequirements(evidence, [{ id: 'contact.open.read', kind: 'read', type: 'bool', writable: false }]),
    ).toBe(true);
  });

  it('rejects conflicting duplicate semantic evidence', () => {
    expect(() => indexDeviceMemberEvidence(manifest([contactDetail(), contactDetail(true)]))).toThrow(
      'device manifest contains conflicting member evidence: contact.open.read',
    );
  });

  it('rejects one accessor the manifest maps to two flat property names', () => {
    const renamed = contactDetail();
    renamed.reads = [{ accessor: 'open', property: 'synthetic_contact_state', type: 'bool', writable: false }];

    expect(() => indexDeviceMemberEvidence(manifest([contactDetail(), renamed]))).toThrow(
      'device manifest contains conflicting member evidence: contact.open.read',
    );
  });

  it('matches a required member without constraining the flat property name it is announced under', () => {
    const evidence = indexDeviceMemberEvidence(manifest([contactDetail()]));

    expect(satisfiesMemberRequirements(evidence, [{ id: 'contact.open.read', kind: 'read', type: 'bool' }])).toBe(true);
    expect(evidence.get('contact.open.read')?.property).toBe('synthetic_contact_open');
  });

  it('rejects an SDK action form the plugin has not reviewed', () => {
    const detail = contactDetail();
    detail.actions.push({ name: 'synthetic', form: 'future-form' } as never);

    expect(() => indexDeviceMemberEvidence(manifest([detail]))).toThrow(
      'device manifest contains an unsupported action form: future-form',
    );
  });

  it('requires every fixed member and at least one declared alternative', () => {
    const evidence = indexDeviceMemberEvidence(manifest([contactDetail()]));
    const required = [{ id: 'contact.open.read', kind: 'read' as const }];

    expect(
      satisfiesMemberRequirements(evidence, required, [
        { id: 'motion.motion.event', kind: 'event' },
        { id: 'contact.contactState.event', kind: 'event' },
      ]),
    ).toBe(true);
    expect(
      satisfiesMemberRequirements(evidence, required, [
        { id: 'motion.motion.event', kind: 'event' },
        { id: 'doorbell.doorbellPress.event', kind: 'event' },
      ]),
    ).toBe(false);
  });

  it('indexes exact product evidence without inferring from display model or codec', () => {
    const candidate = manifest([contactDetail()]);
    candidate.model = 'T8531';
    candidate.modelName = 'Synthetic unrelated display model';
    candidate.codec = 'lock';

    expect(satisfiesProductRequirement(indexDeviceEvidence(candidate).product, { model: 'T8531' })).toBe(true);
    expect(satisfiesProductRequirement(indexDeviceEvidence(candidate).product, { model: 'T85D0' })).toBe(false);
    delete candidate.model;
    candidate.modelName = 'T8531';
    expect(satisfiesProductRequirement(indexDeviceEvidence(candidate).product, { model: 'T8531' })).toBe(false);
  });
});

/**
 * A camera surface answering the SDK's out-of-band trust statement for its enablement member.
 *
 * `unreflectedMembers` reads a symbol-keyed statement only the SDK's own binding attaches, and no camera
 * family reports one today, so a proxy answering every symbol read is the only way to exercise a member the
 * SDK declines to stand behind.
 */
function unreflectedCamera(camera: object): object {
  return new Proxy(camera, {
    get(inner, property, receiver) {
      return typeof property === 'symbol' ? Object.freeze(['enabled']) : Reflect.get(inner, property, receiver);
    },
  });
}

function cameraDetail(): CapabilityDescriptor {
  return {
    capability: 'camera' as CapabilityDescriptor['capability'],
    accessor: 'camera',
    reads: [{ accessor: 'enabled', property: 'synthetic', type: 'bool', writable: true }],
    actions: [],
    undescribedActions: [],
    events: [],
  };
}

describe('camera enablement trust', () => {
  const observing = indexDeviceEvidence(manifest([cameraDetail()])).members;
  const blind = indexDeviceEvidence(manifest([])).members;

  /**
   * One owner answers whether the SDK stands behind a camera's enablement reading, for every consumer that
   * asks. The evidence half and the trust half are both required, so a device that reports the member and a
   * device the SDK declines to stand behind are distinguished.
   */
  it('observes enablement only where the device reports it and the SDK stands behind it', () => {
    expect(observesCameraEnablement({ enabled: true } as never, observing)).toBe(true);
    expect(observesCameraEnablement({ enabled: true } as never, blind)).toBe(false);
    expect(observesCameraEnablement(unreflectedCamera({ enabled: true }) as never, observing)).toBe(false);
  });

  /**
   * The reading is gated by the same question, so a caller cannot read a value it was not entitled to, and a
   * reading that is absent, of the wrong type, or that faults is unobserved rather than disabled.
   */
  it('answers nothing rather than disabled for a reading it may not rely on', () => {
    expect(cameraEnablement({ enabled: false } as never, observing)).toBe(false);
    expect(cameraEnablement({ enabled: true } as never, observing)).toBe(true);
    expect(cameraEnablement({ enabled: true } as never, blind)).toBeUndefined();
    expect(cameraEnablement(unreflectedCamera({ enabled: false }) as never, observing)).toBeUndefined();
    expect(cameraEnablement({ enabled: 'yes' } as never, observing)).toBeUndefined();
    expect(
      cameraEnablement(
        {
          get enabled(): boolean {
            throw new Error('surface faults');
          },
        } as never,
        observing,
      ),
    ).toBeUndefined();
  });

  /**
   * A surface whose trust statement itself faults has stated nothing that may be relied on.
   */
  it('declines a surface whose trust statement faults', () => {
    const faulting = new Proxy(
      { enabled: true },
      {
        get(inner, property, receiver) {
          if (typeof property === 'symbol') {
            throw new Error('statement faults');
          }
          return Reflect.get(inner, property, receiver);
        },
      },
    );

    expect(observesCameraEnablement(faulting as never, observing)).toBe(false);
    expect(cameraEnablement(faulting as never, observing)).toBeUndefined();
  });
});
