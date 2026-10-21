# Repository review ? 2026-10-21

This pass followed the main/preload/renderer message path, connection lifecycle, topic models, persistence hooks, publishing, recording/playback, simulation, UI controls, and build configuration. It fixes verified defects and establishes regression coverage; it is not a claim that all remaining behavior is production-ready.

## Fixed in this pass

| Area | Defect and resulting behavior |
| --- | --- |
| Connection lifecycle | Early socket close left connect promises pending; retry could leak clients; cancellation left timeouts alive. Attempts now settle and clean up, and concurrent connects share one client. |
| MQTT settings | MQTT 5 `clean` was replaced by an unsupported option; zero keepalive/reconnect values, empty wills, user properties, and subscription IPC properties were lost. These settings now reach MQTT.js. |
| Reconnect | The configured reconnect period was ignored. It is applied after the initial successful connection; configured subscriptions are restored and denied SUBACKs are rejected. |
| IPC and desktop | Window recreation duplicated forwarding listeners. Forwarders register once; IPC checks the sending window/frame, navigation and popups are blocked, and the renderer is sandboxed with a CSP and local icon fonts. Duplicate packet payload transfer was removed. |
| Topic identity | Filtering empty topic levels merged distinct MQTT topics. Leading, trailing, and repeated slashes now remain distinct. |
| Counts and rates | Parent topics double-counted descendants and clearing a parent's direct history subtracted descendant counts. Counts are separated; rates use time buckets independent of the 300-message buffer, decay while idle, and cache subtree totals. |
| History | Timestamp-only React keys collided during bursts; byte limits counted characters and accepted oversized entries. IDs are monotonic per node and buffer accounting uses UTF-8 bytes. Tree clearing refreshes message views and cancels queued updates. |
| Saved connections | Refresh replaced all saved profiles with the subset already known to the MQTT service. Refresh now merges status into saved profiles. Loading state before persistence also avoids overwriting saved settings during mount. |
| Disconnect behavior | Disconnects and errors erased topic trees. History remains available for inspection after disconnect. |
| Recording | The panel received a permanently empty array. It now captures live events for its source broker, batches UI counters, retains same-timestamp bursts, and stops with a visible notice at its capture limit. |
| Playback | Publishing ran inside a React state updater and scheduled every message at once. Playback uses one timer, performs side effects outside state updates, defaults to preview, and cancels scheduled work on source/filter changes. |
| Simulation | Intervals used stale settings, connection switches could mix saved devices, and per-output updates overwrote each other. Devices are scoped by connection, interval callbacks read current state, and output values update together. Zero-valued generator settings are honored. |
| Publishing and UI | Failures were swallowed and reported as successful publishes. Errors now reach callers. Drafts/history are scoped per connection, template payloads are expanded, sorting/retained filters and follow scrolling work, and topic rows support keyboard activation. |
| Imports | Malformed recording timestamps and payloads could break rendering. Imports are size-limited and validated; message counts are recomputed. Basic schema validation now handles null, arrays, nested values, and required properties. |
| Tooling | Added regression and desktop smoke tests, upgraded Electron/build/test tools, updated Windows signing configuration, refreshed dependencies, and replaced obsolete build instructions. |

## Remaining priorities

1. **Global memory budgets and disk-backed capture.** `TopicTree.topicLookup` has no connection-wide topic/node cap. Per-topic buffers do not bound the sum across thousands of topics, and `lastMessage` can retain an oversized payload even when history rejects it. Introduce explicit byte/node budgets, eviction indicators, and a disk-backed recording store. Benchmark retained-message floods and long-running wildcard subscriptions before selecting defaults.
2. **Binary payload fidelity.** `MQTTConnection` still decodes incoming buffers with `toString()`. Invalid UTF-8 cannot round-trip through recording/export/playback. Add a byte-preserving payload contract, text/hex views, and explicit encoding on import/export before advertising binary support.
3. **Credential storage.** Saved connections include passwords and private keys in localStorage. Move secrets into main-process storage using OS-backed encryption and migrate existing profiles without dropping credentials. Avoid persisting volatile connection state alongside secrets.
4. **Typed and validated IPC.** `ConnectionConfig` and event payloads still use broad shapes; `mqtt-connection-manager.js` is outside strict JS checking. Add per-event discriminated types and runtime validation for topic names, configuration ranges, QoS, and payload encoding. Test malicious/malformed inputs at the IPC boundary.
5. **Storage and schema validation.** Recording persistence can exceed localStorage quota; imported templates and saved UI/device settings still need complete shape validation. Template validation covers only a subset of JSON Schema and does not resolve `$ref`, combinators, or all constraints. Use a standards-compliant validator if that feature is required.
6. **Timing and backpressure.** Playback waits for each publish and can drift with broker acknowledgement latency; resuming restarts the current inter-message delay. Simulation uses intervals and can overlap slow publishes. Add monotonic scheduling, an explicit queue/backpressure policy, and broker-disconnect tests under QoS 1/2 traffic.
7. **UI consistency and accessibility.** Selected topic metadata is a snapshot, tree highlighting is not restored with the remembered topic, and nested div/button controls need broader keyboard/focus work. Panels and header tabs need checks at the minimum 800px window width. Notifications overlap header controls during bursts. A dedicated payload inspector and searchable topic list would be useful next additions.
8. **Reload/shutdown recovery and protocol coverage.** Live recordings are in memory until stopped. Refreshing or closing the renderer can lose an active capture; renderer reload also needs an explicit connection reconciliation policy. Add durable checkpoints and tests with real TLS/client certificates, WebSocket paths/headers, MQTT 5 session expiry, denied authentication, QoS 2, and reconnecting persistent sessions.

## Validation and limits

- This pass completed with 21 passing regression tests, clean typecheck/lint, a successful production build and Electron smoke test, and successful Windows unpacked packaging (`npm run pack`).
- After the dependency updates, `npm audit --omit=dev` reported zero findings. The full audit reported eight moderate findings in the packaging/download dependency chain; no high or critical findings remained. Those moderate findings are still open.
- Regression suite covers exact topic paths, counts, rate decay, buffer limits, duplicate timestamps, connection cancellation/reconnect/settings, recording bursts and bounds, import validation, basic schema validation, generator edge cases, saved profiles, playback, and simulation updates/cleanup.
- The Electron smoke test loads the built main/preload/renderer with sandboxing enabled, connects to a local MQTT 5 broker, checks topic/message rendering and panel geometry, disconnects, and verifies retained browsing history and local icon fonts. Windows remain hidden and test data is isolated.
- Typecheck and lint are part of the check commands. JavaScript files remain outside TypeScript's `checkJs` coverage.
- The smoke broker is deliberately minimal. It does not establish interoperability with every broker or validate TLS, WebSocket, installer signing, or installer upgrade/uninstall behavior.
- Dependency audit results are time-dependent. Run both `npm audit` and `npm audit --omit=dev`; Electron ships with the app even though npm lists it as a development dependency.

Suggested next implementation: global memory budgets plus byte-preserving payloads, followed by durable recordings and encrypted connection storage. These address the largest remaining correctness and resource risks before adding more UI features.
