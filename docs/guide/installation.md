# Installation

## Stable public release

Install through the Homebridge UI by searching for **Homebridge Eufy**, or install the scoped
package:

```bash
npm install -g @homebridge-plugins/homebridge-eufy
```

## V5

The plugin was `@homebridge-plugins/homebridge-eufy-security` up to 4.7.2. From 5.0.0 it is
`@homebridge-plugins/homebridge-eufy`, which covers eufy's whole range, not only security: install it and
remove the old plugin. Updates ship under the new name only.

V5 depends on `@mega-yfue/eufy-sdk`, published on npmjs, so nothing beyond a public registry is needed to
install it.

```bash
npm install -g @homebridge-plugins/homebridge-eufy
```

Developing from source:

```bash
nvm use
npm install
npm run verify
```
