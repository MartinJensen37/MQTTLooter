# Roadmap

Where MQTTLooter goes after 1.0.0, in priority order within each section. Completed work is recorded in the git history and [CHANGELOG.md](../CHANGELOG.md).

## Release process

The goal is small, frequent releases that are safe to ship.

1. **Continuous integration.** A GitHub Actions workflow on Windows that runs typecheck, lint, unit tests and the Electron smoke test for every push and pull request.
2. **Release workflow.** Pushing a `v*` tag builds the installer and drafts a GitHub release with the changelog entry, the installer and `latest.yml`.
3. **Automatic updates.** `electron-updater` reading GitHub Releases, with **Help > Check for updates**. Pre-release tags (`v1.1.0-beta.1`) give an opt-in beta channel.
4. **Code signing.** A signing certificate (for example Azure Trusted Signing) so Windows stops showing the unknown-publisher warning.
5. **Working agreement.** Feature branches and pull requests into `master`, `master` always releasable, a changelog line with each change, and semantic versions: minor for features, patch for fixes, major when saved data or behavior changes incompatibly.
6. **Dependency upkeep.** Dependabot for npm packages and GitHub Actions, and an Electron upgrade at least every other Electron major for security fixes.

## Maintainability

- Convert the remaining JavaScript to TypeScript, starting with `App.jsx`, `MessagePanel.jsx` and `mqtt-connection-manager.js` (about 2,900 lines in eight files).
- Split the largest components (`PublishingPanel`, `RecordingPanel`, `App`) into smaller pieces, and move their state into services so panels only render.
- Version every saved format (settings, connections, devices, schemas, recordings) with tested migrations, so upgrades never lose data.
- Scope stylesheets per component (CSS modules) and remove the legacy color aliases still kept in `variables.css`.
- A short architecture note covering the processes, workers, IPC and storage.
- An opt-in diagnostics bundle (logs, versions, settings without secrets) from **Help > About** for bug reports.

## Scalability

- Move the topic tree model into a worker so very large brokers (100,000 topics or more) cannot slow the window.
- Configurable disk-history retention and per-topic limits, with database compaction.
- Stream oversized payloads in content search and load large payloads on demand in the inspector.
- Search across recordings.
- Measure memory and responsiveness under sustained load in CI, and fail on regressions.
- Minify the renderer build.

## Features

- Decoders for CBOR, MessagePack and Avro alongside protobuf, behind one decoder interface.
- Message comparison: a JSON tree view, a diff between two messages and highlighting of changed values.
- Rules that notify when a value crosses a threshold or a topic goes quiet.
- Sparkplug B: names for aliases in history recorded before a birth, sequence-gap detection, rebirth answers from simulated edge nodes and primary host `STATE`.
- The same tab in both split panes, more than two panes, and detachable windows.
- MQTT 5 enhanced authentication and secure storage for WebSocket headers.
- macOS and Linux builds.
- Interoperability tests against EMQX and HiveMQ in addition to Mosquitto.
