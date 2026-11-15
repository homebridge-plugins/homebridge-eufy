import { CAPABILITY_MODULES } from '@mega-yfue/eufy-sdk';

import { INFORMATION_SDK_ROWS } from './adapters/information.js';
import { ADAPTER_REGISTRY } from './adapters/registry.js';

const ADAPTER_BY_ROW = new Map(
  Object.entries(ADAPTER_REGISTRY).flatMap(([adapter, { coverage }]) => coverage.map((id) => [id, adapter] as const)),
);

const BLOCKED = new Set([
  'ptz.rotationSpeed.read',
  'camera.imageFlipped.persistent-operation',
  'leak.leakDetected.read',
  'smoke.smokeDetected.read',
  'co.coDetected.read',
  'keypad.batteryLow.read',
  'keypad.charging.read',
]);

/** Derives the current semantic member inventory directly from the pinned SDK contract. */
function currentSdkSurface(): string[] {
  const rows: string[] = [];
  for (const [capability, module] of Object.entries(CAPABILITY_MODULES)) {
    for (const [name, member] of Object.entries(module.members ?? {})) {
      if ('type' in member) {
        if (!member.writeOnly) {
          rows.push(`${capability}.${name}.read`);
        }
        if (member.write || member.unverified || member.writtenElsewhere) {
          rows.push(`${capability}.${name}.persistent-operation`);
        }
      } else if ('action' in member) {
        rows.push(`${capability}.${name}.momentary-action`);
      } else if ('method' in member || 'provided' in member) {
        rows.push(`${capability}.${name}.${member.answers ? 'read' : 'momentary-action'}`);
      } else {
        throw new TypeError(`unrecognized SDK member contract: ${capability}.${name}`);
      }
    }
    const events = new Set([...(module.events ?? []).map((event) => event.emit), ...(module.emits ?? [])]);
    for (const event of events) {
      rows.push(`${capability}.${event}.event`);
    }
  }
  rows.push(...INFORMATION_SDK_ROWS);
  return rows.sort();
}

function reviewedRows() {
  const surface = currentSdkSurface();
  const current = new Set(surface);
  const stalePolicy = [...BLOCKED].find((id) => !current.has(id));
  if (stalePolicy) {
    throw new TypeError(`coverage policy references a missing SDK member: ${stalePolicy}`);
  }
  return surface.map((id) => {
    const adapter = ADAPTER_BY_ROW.get(id) ?? null;
    const disposition = adapter ? 'required-adapter' : BLOCKED.has(id) ? 'blocked-sdk-gap' : 'diagnostic-only';
    return { id, adapter, disposition };
  });
}

/** Every SDK member classified against the adapter registry. */
export const SDK_HAP_COVERAGE_MATRIX = reviewedRows();
