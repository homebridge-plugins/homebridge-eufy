import type { CameraActions } from '@mega-yfue/eufy-sdk';
import { unreflectedMembers } from '@mega-yfue/eufy-sdk';

import {
  satisfiesMemberRequirements,
  type DeviceMemberEvidence,
  type DeviceMemberRequirement,
} from './member-evidence.js';

/**
 * The exact enablement observation a reading is admitted against.
 *
 * The coverage row for this member belongs to the camera controls bundle, which requires it writable because
 * it presents a switch. This is the reading alone, admitted only where the manifest reports it as a boolean
 * read, because no other member shape carries that meaning.
 */
export const CAMERA_ENABLED_READ: DeviceMemberRequirement = {
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
 * What the reading says, for a surface already admitted.
 *
 * Nothing is answered for a value that is absent, that is not a boolean, or whose read faults: unobserved is
 * not disabled, and treating it as disabled would withdraw a working camera.
 */
function readEnablement(camera: CameraActions): boolean | undefined {
  try {
    return typeof camera.enabled === 'boolean' ? camera.enabled : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What a camera's enablement reading says, where it may be relied on.
 *
 * Gated by the same question it is answered under, so a caller cannot read a value it was not entitled to.
 */
export function cameraEnablement(
  camera: CameraActions,
  evidence: ReadonlyMap<string, DeviceMemberEvidence>,
): boolean | undefined {
  return observesCameraEnablement(camera, evidence) ? readEnablement(camera) : undefined;
}

/**
 * A reader for a surface whose admission is settled once.
 *
 * For a caller that reads the same surface repeatedly. The gate is a statement about a device family and its
 * manifest, neither of which changes while one surface is bound, so answering it per read would spend an SDK
 * call on a question already answered.
 */
export function cameraEnablementReader(
  camera: CameraActions,
  evidence: ReadonlyMap<string, DeviceMemberEvidence>,
): () => boolean | undefined {
  if (!observesCameraEnablement(camera, evidence)) {
    return () => undefined;
  }
  return () => readEnablement(camera);
}
