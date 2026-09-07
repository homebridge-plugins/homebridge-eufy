<div align="center">

<!-- The suffix names the mode: logo-dark.svg is the white glyph for dark backgrounds. -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/homebridge-plugins/homebridge-eufy/beta-5.0.0/homebridge-ui/public/assets/logo-dark.svg">
  <img src="https://raw.githubusercontent.com/homebridge-plugins/homebridge-eufy/beta-5.0.0/homebridge-ui/public/assets/logo.svg" alt="Homebridge Eufy" height="96">
</picture>

**Bring verified eufy device capabilities into Apple Home through Homebridge.**

[![npm](https://img.shields.io/npm/v/@homebridge-plugins/homebridge-eufy?logo=npm&color=cb3837)](https://www.npmjs.com/package/@homebridge-plugins/homebridge-eufy)
[![beta](https://img.shields.io/npm/v/@homebridge-plugins/homebridge-eufy/beta?label=beta)](https://www.npmjs.com/package/@homebridge-plugins/homebridge-eufy)
[![CI](https://github.com/homebridge-plugins/homebridge-eufy/actions/workflows/ci.yml/badge.svg?branch=beta-5.0.0)](https://github.com/homebridge-plugins/homebridge-eufy/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/@homebridge-plugins/homebridge-eufy?logo=nodedotjs)](./.nvmrc)
[![license](https://img.shields.io/npm/l/@homebridge-plugins/homebridge-eufy)](./LICENSE)

[Documentation](https://homebridge-plugins.github.io/homebridge-eufy/) · [Contributing](./CONTRIBUTING.md) · [Security](./SECURITY.md) · [Releases](https://github.com/homebridge-plugins/homebridge-eufy/releases)

</div>

---

> [!IMPORTANT]
> **V5 is a beta and not yet a replacement for the stable V4 plugin.** Every capability area is
> implemented and covered by the contract suite; qualification on real hardware is the remaining step.
>
> **V5 does not adopt V4 HomeKit accessories.** It registers its own, so expect to remove the V4
> accessories and reassign rooms, names, and automations once. A V4 configuration block is not loaded
> either. A device the SDK recognizes is not automatically represented in HomeKit: representation requires
> an explicit adapter for a primary-purpose member.

## What it is

Homebridge Eufy is a Homebridge 2 platform plugin for the eufy ecosystem. It maintains one persisted
eufy session, discovers the account's devices through
[`@mega-yfue/eufy-sdk`](https://github.com/mega-yfue/eufy-sdk), and maps verified SDK capabilities to
official HomeKit services through explicit capability adapters.

The SDK owns device and transport truth. This plugin owns Homebridge lifecycle, stable accessory
identity, HomeKit representation and policy, configuration, diagnostics, and media adaptation. It
does not infer HomeKit meaning from raw value shapes or manufacture controls that the SDK cannot
verify.

## Requirements

- [Homebridge](https://homebridge.io/) 2.0 or newer
- Node.js 24.5.0 or newer
- A dedicated guest eufy account with the relevant home and devices shared to it

Using a guest account keeps the personal eufy app and Homebridge from competing for one session. See
eufy's [sharing guide](https://support.eufylife.com/s/article/Share-Your-eufySecurity-Devices-With-Your-Family).

## Install

Install stable releases through the Homebridge UI by searching for **Homebridge Eufy**, or
from npm:

```bash
npm install -g @homebridge-plugins/homebridge-eufy
```

While V5 is a beta, it is published under the `beta` dist-tag rather than `latest`:

```bash
npm install -g @homebridge-plugins/homebridge-eufy@beta
```

## First-time setup

1. Create a dedicated guest eufy account and share the required home and devices with it.
2. Install the plugin and open its custom UI from Homebridge.
3. Enter the guest account details and complete captcha or two-factor verification if requested.
4. Wait for authentication and complete discovery to finish.
5. Restart Homebridge so the long-lived runtime can acquire the persisted session.

V5 uses the new `HomebridgeEufy` platform alias. A V4 block using `EufySecurity` is not loaded and must
be replaced with a fresh V5 configuration block.

Credentials are persisted in Homebridge/plugin configuration. Challenge answers stay inside the
temporary authentication flow, and the runtime never falls back to interactive login.

## Current V5 scope

| Area | Status |
|---|---|
| Interactive login, captcha, and two-factor continuation | Implemented |
| Persisted session restore and single runtime ownership | Implemented |
| Complete device discovery, runtime snapshot, and dashboard | Implemented |
| Contact sensors, motion, and doorbell presses | Implemented |
| Camera live video and audio, snapshots, and talkback | Implemented |
| HomeKit Secure Video recording | Implemented |
| Security system arming, locks, sirens, and lights | Implemented |
| Battery, charging, and low-battery enrichment | Implemented |
| Guided diagnostics and redacted support archives | Implemented |
| Qualification on real hardware, then public beta promotion | Remaining |

Support is capability-led rather than model-led, so capability evidence decides coverage instead of product
naming, and a newly recognized model that exposes an already-adapted capability works without an allowlist.
Of the 303 rows in the coverage matrix, 57 have an admitted HomeKit adapter, 230 remain diagnostic-only, and
16 are blocked by a declared SDK gap. Recognized devices therefore appear in the dashboard before, or
without, an explicit HomeKit adapter for their primary purpose.

## Documentation

The [documentation site](https://homebridge-plugins.github.io/homebridge-eufy/) contains the
current V5 contract and a clearly separated migration of useful legacy V4 wiki material. Current V5
work is tracked in the [beta issues](https://github.com/homebridge-plugins/homebridge-eufy/issues)
and release notes.

- [Installation](https://homebridge-plugins.github.io/homebridge-eufy/guide/installation)
- [Configuration](https://homebridge-plugins.github.io/homebridge-eufy/reference/configuration)
- [Troubleshooting](https://homebridge-plugins.github.io/homebridge-eufy/troubleshooting/)
- [Current releases](https://github.com/homebridge-plugins/homebridge-eufy/releases)
- [SDK documentation](https://mega-yfue.github.io/)

## Design

V5 uses one dependency direction:

```text
Homebridge lifecycle
  -> runtime and temporary authentication owners
  -> @mega-yfue/eufy-sdk
  -> canonical device registry and complete snapshot
  -> explicit capability and bundle adapters
  -> official HomeKit services and characteristics
```

Capability adapters are closed-world and semantic. Unsupported SDK capabilities remain visible as
diagnostics but do not receive a generic HomeKit fallback. The domain vocabulary lives in
[`CONTEXT.md`](./CONTEXT.md).

## Develop

```bash
nvm use
GITHUB_TOKEN="$(gh auth token)" npm install
npm run verify
```

For local SDK development, replace the SDK dependency with `file:../eufy-sdk` and run `npm install`
again. `npm run verify` is the complete repository gate: formatting, dependency guard, TypeScript
build, packed-artifact import, and contract tests.

## Contributing

Pull requests are welcome. [`CONTRIBUTING.md`](./CONTRIBUTING.md) covers setup and workflow;
[`AGENTS.md`](./AGENTS.md) defines the code and architecture rules. Report security issues through
[`SECURITY.md`](./SECURITY.md), never through a public issue.

## Funding and credits

Development is supported by [Lenoxys](https://github.com/sponsors/lenoxys). The project was founded by
[samemory](https://ko-fi.com/S6S24XCVJ). Earlier releases were built on bropat's
[`eufy-security-client`](https://github.com/bropat/eufy-security-client); V5 uses
[`@mega-yfue/eufy-sdk`](https://github.com/mega-yfue/eufy-sdk).

## License

[Apache-2.0](./LICENSE). Contributions are accepted under the same license.

## Disclaimer

Independent and unofficial, built for interoperability with eufy devices you own. **Not affiliated
with, endorsed by, or sponsored by Anker Innovations or eufy.** "eufy" and "Anker" are trademarks of
their respective owners and appear here only to identify compatible hardware. Use responsibly: rapid
or failed login attempts can trigger captcha challenges or temporary account cooldowns.
