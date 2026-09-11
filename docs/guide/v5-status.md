# V5 beta status

V5 is a clean integration built on `@mega-yfue/eufy-sdk`; it is not a feature-for-feature port of V4.

```bash
npm install -g @homebridge-plugins/homebridge-eufy-security@beta
```

## Requirements

- **Homebridge 2** and **Node.js 24.5.0 or newer**. Neither is optional.
- The V5 platform alias is `HomebridgeEufy`. The V4 `EufySecurity` alias is not accepted.

## What has a HomeKit adapter

An adapter is the code that can give a device a HomeKit service:

| Area                                            | HomeKit service              |
| ----------------------------------------------- | ---------------------------- |
| Accessory identity and firmware information     | `AccessoryInformation`       |
| Cameras: streaming, snapshots, talkback, HKSV   | `CameraRecordingManagement`  |
| Camera controls                                 | per-control switches         |
| Motion                                          | `MotionSensor`               |
| Doorbell press                                  | `Doorbell`                   |
| Contact sensors                                 | `ContactSensor`              |
| Locks                                           | `LockMechanism`              |
| Security modes                                  | `SecuritySystem`             |
| Sirens                                          | `Switch`                     |
| Smart lights                                    | `Lightbulb`                  |
| Battery level and charging state                | `Battery`                    |

## Why your device may still show less than this table

**An adapter existing is not the same as your device getting it.** Three claims are distinct:

- **Recognized** — the SDK knows the device and the capabilities it evidenced.
- **Represented** — a primary-purpose member has an explicit adapter, and the device reported the
  evidence that adapter requires.
- **Controllable** — a verified operation is available, so HomeKit can write and not only read.

Capabilities are evidence-gated in the SDK: a device exposes exactly what it reported. An adapter
therefore attaches only when the backing evidence is there, and a member the SDK has not verified stays
diagnostic-only or blocked rather than being mapped on the strength of a matching value type.

Primitive type similarity never admits a mapping. A member whose HomeKit meaning is not established
produces a structured diagnostic instead of a generic fallback.

Accessory containers use the SDK entity serial as their physical identity input. Station, channel,
endpoint, and discovery order do not affect identity. Identity metadata supplements an already
represented accessory but cannot create one by itself.

## Reporting a gap

A device that is recognized but not represented, or represented but not controllable, is worth an
issue — include the plugin's diagnostic output, which is allowlisted and redacted.
