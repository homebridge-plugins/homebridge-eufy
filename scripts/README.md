# Maintainer scripts

Index of the tooling in this directory. `npm run verify` stays hermetic, so anything requiring a real
account, camera, or transport lives here instead of in `test/contracts/`.

Read a script's own header before running it. Headers state prerequisites, flags, and why the check
cannot be hermetic.

## What writes

No script in this directory reaches an installed plugin: `.npmignore` excludes the whole of it, and the
packed contract pins the shipped set as empty. Most are observation-only. These are not, so they belong only
to a host whose owner has approved a real-device write:

| Script                                | What it writes                                                      |
| ------------------------------------- | ------------------------------------------------------------------- |
| `eufy-camera-power.mjs`               | Moves one camera's enablement state                                 |
| `authentication-handoff-evidence.mjs` | Takes one ownership lease against a live storage root               |
| `qualify-authentication-handoff.sh`   | Provisions a throwaway Homebridge instance and replaces its account |

Real-device writes require the owner's explicit approval. Observation-only verification is the default.

## Index

The live HomeKit checks (`live-hap-*`, `live-hksv-check.mjs`, `live-talkback-check.mjs`) are indexed in
[live plugin validation](../docs/troubleshooting/live-plugin-validation.md#6-drive-the-same-paths-without-a-home-app).

| Script                                | Purpose                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `hap-live-harness.mjs`                | Controller session mechanics the `live-hap-*` scripts share              |
| `live-adaptation-delivery-check.mjs`  | Every fed access unit accounted for in the coded live output             |
| `eufy-camera-session.mjs`             | One typed SDK camera session against a copy of a storage root            |
| `eufy-camera-power.mjs`               | Reads and moves one camera's enablement                                  |
| `qualify-authentication-handoff.sh`   | Guided live authentication handoff, procedure in `docs/troubleshooting/` |
| `authentication-handoff-evidence.mjs` | The evidence behind each authentication handoff criterion                |
| `decrypt-diagnostics.mjs`             | Decrypts and extracts a support archive a user sent in                   |
| `sync-device-artwork.mjs`             | Regenerates bundled device artwork                                       |
| `guard-no-ecs.sh`                     | Repository gate: fails if `eufy-security-client` reappears               |
| `qualify-release.mjs`                 | Release gate: refuses a tree whose SDK or contents cannot be shipped     |

## Comparing two revisions

Pin the selection to what the accessory advertises, and read the advertisement in both runs rather than
assuming it held. Every script refuses a selection outside the advertisement. A comparison whose two halves
ran at different geometries measures the advertisement rather than the change, and the halves that refuse
measure nothing at all — an inconclusive run, which is reported as inconclusive rather than as a pass.

Prefer one downtime window containing both revisions over two windows separated in time: build the first
revision, run every camera, build the second, run them again, all against one storage copy taken once. That
removes the account and registry state drift between runs, and it is also less total downtime than two
windows, because the dedicated instance starts once per revision instead of once per run.
