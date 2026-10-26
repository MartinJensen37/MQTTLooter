# Contributing

## Workflow

- `master` is always releasable. Work happens on a branch and reaches `master` through a pull request once CI passes.
- Keep commits small, with a short message that says what changed.
- Add a line to the `Unreleased` section of [CHANGELOG.md](CHANGELOG.md) for each change people will notice.
- Versions follow semantic versioning: patch for fixes, minor for features, major when saved data or behavior changes incompatibly. Releases are described in [docs/RELEASING.md](docs/RELEASING.md).

## Before opening a pull request

```sh
npm run typecheck
npm run lint
npm run format
npm test
npm run test:electron
```

`npm run test:load` measures the app under load; CI runs it with `LOAD_STRICT=1`, which fails on missed latency or memory targets.

## Code

- TypeScript throughout; the window talks to main only through the typed bridge in `src/shared/ipc.ts`.
- A change to a saved format needs a new version and a tested migration (see [Saved data](docs/RELEASING.md#saved-data)).
- Interface text is plain and short, without internal identifiers.

How the parts fit together is described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
