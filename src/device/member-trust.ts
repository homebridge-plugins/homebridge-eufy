import type { BatteryActions, CameraActions } from '@mega-yfue/eufy-sdk';
import { unreflectedMembers } from '@mega-yfue/eufy-sdk';

import { satisfiesMemberRequirements, type DeviceMemberEvidence } from './member-evidence.js';

/**
 * The exact enablement observation a reading is admitted against.
 *
 * The coverage row for this member belongs to the camera controls bundle, which requires it writable because
 * it presents a switch. This is the reading alone, admitted only where the manifest reports it as a boolean
 * read, because no other member shape carries that meaning.
 */
export const CAMERA_ENABLED_READ: DeviceMemberEvidence = {
  id: 'camera.enabled.read',
  kind: 'read',
  type: 'bool',
};

/**
 * Whether the SDK declines to stand behind one of this surface's readings on this device family.
 *
 * A member named there reports a value that does not track its own setter, so it may neither be presented nor
 * written: publishing it would state something the SDK does not, and writing it would leave a consumer unable
 * to tell whether the write landed. The statement is read off the bound capability surface itself, so a
 * surface that answers that read by throwing has stated nothing that may be relied on and is declined too.
 */
export function untrusted(camera: CameraActions, member: string): boolean {
  try {
    return unreflectedMembers(camera).includes(member);
  } catch {
    return true;
  }
}

/**
 * Whether a camera's enablement reading may be relied on: the device reports it, and the SDK stands behind it.
 *
 * Both halves are required, and this is the one place they are put together, so a presentation, a live
 * admission and a dashboard cannot reach different conclusions about the same camera.
 */
export function observesCameraEnablement(
  camera: CameraActions,
  evidence: ReadonlyMap<string, DeviceMemberEvidence>,
): boolean {
  return satisfiesMemberRequirements(evidence, [CAMERA_ENABLED_READ]) && !untrusted(camera, 'enabled');
}

/**
 * A reader of what a camera's enablement reading says, where it may be relied on, gated once.
 *
 * The gate is a statement about a device family and its manifest, neither of which changes while one surface
 * is bound, so it is answered when the reader is made. Nothing is read for a surface the gate declines, and
 * nothing is answered for a value that is absent, that is not a boolean, or whose read faults: unobserved is
 * not disabled, and treating it as disabled would withdraw a working camera.
 */
export function cameraEnablementReader(
  camera: CameraActions,
  evidence: ReadonlyMap<string, DeviceMemberEvidence>,
): () => boolean | undefined {
  if (!observesCameraEnablement(camera, evidence)) {
    return () => undefined;
  }
  return () => {
    try {
      return typeof camera.enabled === 'boolean' ? camera.enabled : undefined;
    } catch {
      return undefined;
    }
  };
}

/**
 * The exact battery-level observation a reading is admitted against.
 *
 * A device reporting a level at all is what proves it is battery powered, so this one requirement carries both
 * that fact and the admission of the reading itself.
 */
export const BATTERY_LEVEL_READ: DeviceMemberEvidence = {
  id: 'battery.level.read',
  kind: 'read',
  type: 'number',
  writable: false,
};

/** Whether a value is a battery level: a percentage, which is the only shape this reading is accepted in. */
export function isBatteryLevel(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

/**
 * What a battery-level reading says, where the device reports one.
 *
 * Nothing is answered for a value that is absent, that is not a percentage, or whose read faults: unobserved is
 * not empty, and presenting it as empty would report a fault the device never reported. HomeKit tells those
 * three apart because it must answer a characteristic either way; a consumer that may simply say nothing
 * does not.
 */
export function batteryLevel(
  battery: BatteryActions,
  evidence: ReadonlyMap<string, DeviceMemberEvidence>,
): number | undefined {
  if (!satisfiesMemberRequirements(evidence, [BATTERY_LEVEL_READ])) {
    return undefined;
  }
  try {
    return isBatteryLevel(battery.level) ? battery.level : undefined;
  } catch {
    return undefined;
  }
}
