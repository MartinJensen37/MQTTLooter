# Roadmap

Where MQTTLooter goes next, in priority order within each section. Completed work is recorded in the git history and [CHANGELOG.md](../CHANGELOG.md); how releases are made is in [RELEASING.md](RELEASING.md).

## Release process

1. **Code signing.** The release workflow signs with Azure Trusted Signing once its secrets exist; setting up the account is described in [RELEASING.md](RELEASING.md#code-signing).
2. **Dependency upkeep.** Review Dependabot's pull requests, and upgrade Electron at least every other major for security fixes.

## Maintainability

- Scope stylesheets per component. Class names are already prefixed per component; CSS modules would also need the Electron tests to stop selecting by class name.

## Scalability

- Move the topic tree model into a worker for brokers well beyond what `LOAD_PROFILE=full` measures. At 50,000 topics and 5,000 messages per second the window still answers input within 15 ms (p95), so this waits until a broker needs it. The tree view would then read visible rows by range instead of the whole flattened list.
- Search across recordings. The database query is started on the local branch `wip/recording-search`; the IPC handler, the search field in Recording and tests remain.

## Features

- Decoders for CBOR, MessagePack and Avro alongside protobuf, behind one decoder interface.
- Message comparison: a JSON tree view, a diff between two messages and highlighting of changed values.
- Rules that notify when a value crosses a threshold or a topic goes quiet.
- Sparkplug B: names for aliases in history recorded before a birth, sequence-gap detection, rebirth answers from simulated edge nodes and primary host `STATE`.
- The same tab in both split panes, more than two panes, and detachable windows.
- MQTT 5 enhanced authentication and secure storage for WebSocket headers.
- macOS and Linux builds.
- Interoperability tests against EMQX and HiveMQ in addition to Mosquitto.
