---
layout: home
hero:
  name: Homebridge Eufy
  text: Verified eufy capabilities in Apple Home
  tagline: A Homebridge 2 integration built on explicit device evidence, stable identity, and one safely owned account session.
  image:
    light: /logo.svg
    dark: /logo-dark.svg
    alt: Homebridge Eufy
  actions:
    - theme: brand
      text: V5 status
      link: /guide/v5-status
    - theme: sponsor
      text: First-time setup
      link: /guide/first-time-setup
    - theme: alt
      text: View on GitHub
      link: https://github.com/homebridge-plugins/homebridge-eufy
features:
  - title: One runtime owner
    details: One long-lived SDK owner restores the persisted session, maintains the canonical registry, and refuses concurrent ownership.
  - title: Capability-led HomeKit
    details: HomeKit representation is admitted through explicit semantic adapters, never guessed from a primitive value shape.
  - title: Complete discovery
    details: Configuration consumers receive a versioned complete snapshot; partial inventory never withdraws a device or capability.
---

::: warning V5 replaces V4
Needs Homebridge 2.5 and Node.js 24.5.0. V4 is frozen at `@4.7.2`.
:::

These guides replace the former GitHub wiki. Current V5 behavior is documented separately from
[legacy V4 guidance](/legacy/v4/) so old settings and workarounds are not mistaken for the new plugin
contract.

## Independent project

Homebridge Eufy is independent and unofficial. It is not affiliated with, endorsed by, or sponsored by
Anker Innovations or eufy. Use it only with devices and accounts you own or are authorized to access.
