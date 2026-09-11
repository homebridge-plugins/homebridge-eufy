# Supported capabilities

V5 distinguishes three claims:

- **Recognized**: the SDK knows the device and its evidenced capabilities.
- **Represented**: at least one primary-purpose member has an explicit HomeKit adapter.
- **Controllable**: at least one verified operation is available through HomeKit.

## Current implementation status

| Area                                          | Status                                            |
| --------------------------------------------- | ------------------------------------------------- |
| Account and device discovery                  | Runtime available                                 |
| Accessory identity and firmware information   | Adapter registered                                |
| Cameras, streaming, snapshots, talkback, HKSV | Adapter registered                                |
| Camera controls                               | Adapter registered                                |
| Motion                                        | Adapter registered                                |
| Doorbell press                                | Adapter registered                                |
| Contact sensors                               | Adapter registered, published from registry snapshots |
| Locks                                         | Adapter registered                                |
| Security modes                                | Adapter registered                                |
| Sirens                                        | Adapter registered                                |
| Smart lights                                  | Adapter registered                                |
| Battery level and charging state              | Adapter registered                                |

A registered adapter attaches only where the device reported the evidence it requires, so this table
states what the plugin can represent and not what any one account will show.

Primitive type similarity never admits a mapping. Unsupported members remain diagnostic-only or blocked
until verified SDK evidence and a semantic HomeKit contract both exist.

Accessory containers use the SDK entity serial as their physical identity input. Station, channel,
endpoint, and discovery order do not affect identity. Identity metadata supplements an already
represented accessory but cannot create one by itself.
