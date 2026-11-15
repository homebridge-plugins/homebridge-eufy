import { describe, expect, it } from 'vitest';

import { ADAPTER_REGISTRY } from '../../src/homekit/adapters/registry.js';
import { SDK_HAP_COVERAGE_MATRIX } from '../../src/homekit/coverage-matrix.js';

describe('SDK/HAP coverage matrix', () => {
  it('classifies the complete current SDK member surface', () => {
    expect(SDK_HAP_COVERAGE_MATRIX.length).toBeGreaterThan(0);
    expect(new Set(SDK_HAP_COVERAGE_MATRIX.map((row) => row.id)).size).toBe(SDK_HAP_COVERAGE_MATRIX.length);
  });

  it('records an adapter for every represented row', () => {
    for (const row of SDK_HAP_COVERAGE_MATRIX) {
      expect(row.id).toMatch(/\.(read|event|persistent-operation|momentary-action)$/);
      if (row.disposition === 'required-adapter') {
        expect(row.adapter, row.id).toBeTruthy();
      }
    }
  });

  it('admits only represented rows into the closed-world adapter registry', () => {
    const represented = [
      ...new Set(
        SDK_HAP_COVERAGE_MATRIX.filter((row) => row.disposition === 'required-adapter').map((row) => row.adapter!),
      ),
    ];

    expect(Object.keys(ADAPTER_REGISTRY).sort()).toEqual(represented.sort());
    expect(
      Object.values(ADAPTER_REGISTRY)
        .flatMap((adapter) => adapter.coverage)
        .sort(),
    ).toEqual(
      SDK_HAP_COVERAGE_MATRIX.filter((row) => row.disposition === 'required-adapter')
        .map((row) => row.id)
        .sort(),
    );
    expect(
      SDK_HAP_COVERAGE_MATRIX.filter((row) => row.disposition !== 'required-adapter').every(
        (row) => row.adapter === null,
      ),
    ).toBe(true);
  });

  it('distinguishes representation-establishing adapters from supplemental enrichment', () => {
    expect(ADAPTER_REGISTRY['contact.sensor']).toMatchObject({ role: 'primary-purpose' });
    expect(ADAPTER_REGISTRY['accessory.information']).toMatchObject({ role: 'supplemental' });
    expect(ADAPTER_REGISTRY['battery.status']).toMatchObject({ role: 'supplemental' });
    for (const adapter of Object.values(ADAPTER_REGISTRY)) {
      const coverage = new Set(adapter.coverage);
      expect(adapter.requires.every(({ id }) => coverage.has(id))).toBe(true);
      expect(adapter.requiresAny?.every(({ id }) => coverage.has(id)) ?? true).toBe(true);
      if (adapter.role === 'primary-purpose') {
        expect(adapter.requires.length + (adapter.requiresAny?.length ?? 0)).toBeGreaterThan(0);
      }
    }

    const informationRows = SDK_HAP_COVERAGE_MATRIX.filter(({ id }) => id.startsWith('info.'));
    expect(informationRows.filter(({ adapter }) => adapter === 'accessory.information')).toHaveLength(6);

    const representedBattery = SDK_HAP_COVERAGE_MATRIX.filter(({ adapter }) => adapter === 'battery.status');
    expect(representedBattery.map(({ id }) => id).sort()).toEqual(
      ['battery.level.read', 'battery.charging.read', 'battery.batteryAlert.event'].sort(),
    );

    const representedSiren = SDK_HAP_COVERAGE_MATRIX.filter(({ adapter }) => adapter === 'siren.test');
    expect(representedSiren.map(({ id }) => id).sort()).toEqual(
      ['siren.active.read', 'siren.test.momentary-action', 'siren.stop.momentary-action'].sort(),
    );

    const representedSmartLight = SDK_HAP_COVERAGE_MATRIX.filter(({ adapter }) => adapter === 'smart-light.lightbulb');
    expect(representedSmartLight.map(({ id }) => id).sort()).toEqual(
      [
        'smart_light.power.read',
        'smart_light.power.persistent-operation',
        'smart_light.brightness.read',
        'smart_light.brightness.persistent-operation',
        'smart_light.smartLightState.event',
        'smart_light.setColor.momentary-action',
      ].sort(),
    );

    const representedCameraControls = SDK_HAP_COVERAGE_MATRIX.filter(({ adapter }) => adapter === 'camera.controls');
    expect(representedCameraControls.map(({ id }) => id).sort()).toEqual(
      [
        'camera.enabled.read',
        'light.isOn.read',
        'light.isOn.persistent-operation',
        'light.brightness.read',
        'light.brightness.persistent-operation',
        'audio.microphone.read',
        'audio.microphone.persistent-operation',
        'audio.speaker.read',
        'audio.speaker.persistent-operation',
        'audio.volume.read',
        'audio.volume.persistent-operation',
      ].sort(),
    );

    const representedStreaming = SDK_HAP_COVERAGE_MATRIX.filter(({ adapter }) => adapter === 'camera.streaming');
    expect(representedStreaming.map(({ id }) => id).sort()).toEqual(
      [
        'camera.live.momentary-action',
        'camera.snapshotStored.momentary-action',
        'camera.snapshotLive.momentary-action',
        'camera.talkback.momentary-action',
        'camera.recordFragments.momentary-action',
        'camera.statusLed.read',
        'camera.statusLed.persistent-operation',
        'camera.nightVision.read',
        'camera.nightVision.persistent-operation',
        'camera.enabled.persistent-operation',
      ].sort(),
    );

    const representedLock = SDK_HAP_COVERAGE_MATRIX.filter(({ adapter }) => adapter === 'lock.mechanism');
    expect(representedLock.map(({ id }) => id).sort()).toEqual(
      [
        'lock.lock.momentary-action',
        'lock.unlock.momentary-action',
        'lock.lockState.event',
        'lock.locked.read',
        'lock.locked.persistent-operation',
      ].sort(),
    );

    const diagnosticOnlySiren = SDK_HAP_COVERAGE_MATRIX.filter(
      ({ id, disposition }) => id.startsWith('siren.') && disposition === 'diagnostic-only',
    );
    expect(diagnosticOnlySiren.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        'siren.alarmVolume.persistent-operation',
        'siren.alarmTone.read',
        'siren.alarmTone.persistent-operation',
        'siren.trigger.momentary-action',
      ]),
    );
    expect(diagnosticOnlySiren.every(({ adapter }) => adapter === null)).toBe(true);
  });
});
