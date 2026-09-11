# Installation

## Stable public release

Install through the Homebridge UI by searching for **Homebridge Eufy**, or install the scoped
package:

```bash
npm install -g @homebridge-plugins/homebridge-eufy-security
```

## V5 beta

V5 is a prerelease. It depends on an `@mega-yfue/eufy-sdk` prerelease published on npmjs, so nothing
beyond a public registry is needed to install it.

```bash
npm install -g @homebridge-plugins/homebridge-eufy-security@beta
```

Developing from source:

```bash
nvm use
npm install
npm run verify
```
