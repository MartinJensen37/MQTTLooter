# Architecture

MQTTLooter is an Electron app with three kinds of code: the main process, a preload bridge and the window (renderer). Code shared by both sides lives in `src/shared`.

```text
broker ── MQTT.js ── main process ───────────────┬── history worker   (history.sqlite)
                     │  connections, IPC,        ├── recording worker (recordings.sqlite)
                     │  delivery, credentials    └── decoder worker   (protobuf, Sparkplug B)
                     │
                 preload (window.electronAPI)
                     │
                     window: React panels, topic tree, simulator
```

## Main process (`src/main`)

- **Connections.** `mqtt-connection-manager.ts` owns one MQTT.js client per connection. Every received message gets a session id and sequence number, which identify it everywhere afterwards.
- **Fan-out.** Each message goes to the recording service (active captures), the history service (disk history), the decoder service (Sparkplug births) and message delivery (the window).
- **Delivery.** `message-delivery.ts` sends batches to the window one at a time and waits for an acknowledgement, so Electron's IPC queue stays bounded. Under overload it keeps each topic's newest message and counts the rest as dropped.
- **Workers.** Disk history, recordings and decoding run in worker threads with their own SQLite connections, so slow queries never block the main loop. `worker-client.ts` restarts a worker that stops responding.
- **Secrets.** Passwords and keys are encrypted with Electron's `safeStorage` by `credential-store.ts` and never sent to the window.
- **Updates.** `updates.ts` checks GitHub Releases through electron-updater.

## Preload (`src/preload`)

The window has no Node access. `preload.ts` exposes a fixed set of calls as `window.electronAPI`, typed by `src/shared/ipc.ts`. Main checks that every request comes from its own window and validates the arguments.

## Window (`src/renderer`)

- **Services** hold state outside React: `MQTTService` (IPC calls and batch acknowledgement), `TopicTreeService` (the topic tree and the live cache), `Settings`, `DecoderRegistry` and `SimulationEngine`.
- **Topic tree.** `services/models` keeps a tree of topics with a bounded ring buffer of recent messages per topic, under a per-connection memory budget. Pinned and selected topics are protected from eviction.
- **Panels** are React components in `components/`. Each panel keeps its larger logic in hooks next to it, such as `useTopicMessages` (live cache plus disk history for one topic) and `usePlayback`.
- **Simulation** runs in the window: `SimulationEngine` schedules signals and publishes through main; the publish timeline is computed in a web worker.
- **Saved data** in localStorage is upgraded by `storageMigrations.ts` before any panel reads it.

## Storage

| File | Contents |
| --- | --- |
| `history/history.sqlite` | Every received message for the retention chosen in Settings, with gaps where messages could not be stored |
| `recordings.sqlite` | Recordings, imported files and gap records |
| `decoders.json`, `credentials.json` | Saved protobuf decoders, encrypted secrets |
| Window storage | Settings, connections, drafts, schemas and simulated devices |

All live in the app data folder under `%APPDATA%`. How each is versioned is listed under [Saved data](RELEASING.md#saved-data).
