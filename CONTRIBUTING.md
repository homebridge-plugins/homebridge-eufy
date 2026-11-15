# Contributing

Thanks for helping. This file covers setup, development workflow, and pull requests. Architecture and
code rules are in [AGENTS.md](./AGENTS.md); read them before changing the plugin.

## License

The project is licensed under [Apache-2.0](./LICENSE). By opening a pull request, you agree that your
contribution is provided under the same license.

## Setup

```bash
nvm use
npm install
npm run verify
```

Node 24.5.0 or newer is required. `npm run verify` runs the same local quality gate expected before a
pull request: formatting, the guard against restoring `eufy-security-client`, the build, and the
hermetic Vitest contracts.

## Development workflow

- Start from the active `beta-X.Y.Z` branch and open the pull request against that branch unless a
  maintainer says otherwise.
- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`).
- Keep each change focused and run `npm run verify` before requesting review.
- Run one test suite at a time on a development host. Every Vitest worker is a full Node process, so two
  concurrent suites can exhaust the memory of a host that also runs Homebridge; it swaps instead of
  failing, and the cost appears as an unexplained stall in unrelated software rather than as a test
  error. Comparing two revisions is done sequentially for the same reason: concurrent runs contend for
  the same cores, so their timings measure the contention and not the change.

### Live qualification

`npm run verify` stays hermetic, so anything needing a real account, camera, or transport is
qualified by a script in [scripts/](./scripts/). Its index,
[scripts/README.md](./scripts/README.md), says which scripts write; each script's header is its procedure.

## Pull requests

Keep the body concise and developer-focused:

- what changed and why;
- what was verified;
- device, Homebridge, or Home app evidence used;
- anything unverified, intentionally omitted, or deferred;
- migration or release impact.

Never include real device or account data (see the hard rules in [AGENTS.md](./AGENTS.md)); review the
diff before submission.

## Release notes

Release notes are for users. Put required actions, compatibility changes, removed settings, and
behavior changes first. Avoid internal milestones and implementation detail.

## Working with AI agents

- Point the agent at [AGENTS.md](./AGENTS.md), [CONTEXT.md](./CONTEXT.md), and relevant ADRs.
- Verify every claimed SDK symbol and behavior against the current checkout.
- Do not let an agent infer protocol behavior from an older third-party Eufy client.
- Review generated output for secrets, real device data, incompatible code, and unsupported claims.
- The contributor remains responsible for every submitted line.

## Reporting security issues

Do not open a public issue. Follow [SECURITY.md](./SECURITY.md).
