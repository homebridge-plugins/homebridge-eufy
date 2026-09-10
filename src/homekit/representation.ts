import type { DeviceManifest } from '@mega-yfue/eufy-sdk';

import {
  indexDeviceEvidence,
  satisfiesMemberRequirements,
  satisfiesProductRequirement,
  type DeviceEvidenceIndex,
} from '../device/member-evidence.js';
import type { HomeKitAdapter } from './adapter.js';
import { ADAPTER_REGISTRY } from './adapters/registry.js';

export type AdmittedHomeKitAdapter = readonly [key: string, adapter: HomeKitAdapter];

/** Applies the closed adapter registry to one complete SDK manifest. */
export function admittedHomeKitAdapters(
  manifest: DeviceManifest,
  evidence: DeviceEvidenceIndex = indexDeviceEvidence(manifest),
): AdmittedHomeKitAdapter[] {
  return (Object.entries(ADAPTER_REGISTRY) as Array<[string, HomeKitAdapter]>).filter(
    ([, adapter]) =>
      satisfiesProductRequirement(evidence.product, adapter.requiresProduct) &&
      satisfiesMemberRequirements(evidence.members, adapter.requires, adapter.requiresAny),
  );
}

/**
 * Summarizes the same HomeKit admission policy used by reconciliation.
 *
 * `services` names the adapters that will represent this device, in the registry's own order, so an interface can
 * say what the device becomes rather than only that it becomes something. Supplemental adapters are left out:
 * they accompany a representation rather than being one, and every accessory carries them.
 */
export function describeHomeKitRepresentation(manifest: DeviceManifest): {
  represented: boolean;
  controllable: boolean;
  services: string[];
} {
  const primary = admittedHomeKitAdapters(manifest).filter(([, adapter]) => adapter.role === 'primary-purpose');
  return {
    represented: primary.length > 0,
    controllable: primary.some(([, adapter]) =>
      adapter.coverage.some((id) => id.endsWith('.persistent-operation') || id.endsWith('.momentary-action')),
    ),
    services: primary.map(([key]) => key),
  };
}
