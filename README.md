# MQTTLooter

An Electron MQTT client for browsing topics, publishing messages, recording traffic, and simulating devices.

## Development

Use Node.js 22.12 or newer (Node 22 or 24 LTS recommended) and npm. Install dependencies once at the repository root:

```sh
npm ci
npm run dev
```

`electron-vite` starts the renderer development server and Electron together. If your terminal sets `ELECTRON_RUN_AS_NODE`, unset it before running the app; that variable makes Electron behave as a Node process.

## Checks and builds

```sh
npm test                 # Unit and React regression tests
npm run typecheck
npm run lint
npm run build            # Main, preload, and renderer output in out/
npm run test:electron    # Build and test the real app against a local MQTT broker
npm run pack             # Unpacked Windows application in dist-builder/win-unpacked/
npm run dist             # Windows NSIS installer in dist-builder/
```

The Electron smoke test uses hidden windows, isolated storage under `.tmp/`, and a loopback broker. It does not connect to saved user brokers or modify the user's app data. Screenshots are written to `.tmp/electron-smoke.png`, `.tmp/electron-simulator.png`, `.tmp/electron-simulator-small.png`, and `.tmp/electron-signal-editor.png`.

## Features and behavior

- Multiple MQTT 3.1.1 and MQTT 5 connections, including TLS and WebSocket configuration.
- Saved connection settings, subscriptions, reconnect intervals, and last wills, including empty will payloads.
- Virtualized topic tree that preserves exact MQTT paths, including empty levels such as `a//b`.
- Message history, retained-message filtering, sorting, copying, and JSON/CSV export. History remains available after disconnect, subject to its limits, until cleared or the connection is deleted.
- Byte-preserving payloads: valid UTF-8 stays text; other bytes use base64 through IPC, recording, export and playback. Message inspection offers text/hex views; binary copy/export uses base64 with an explicit encoding field. Publishing accepts UTF-8 or canonical padded base64. Older recordings without an encoding field are read as UTF-8.
- Up to 300 messages and 2 MiB of raw payload bytes per topic. An oversized individual payload is discarded from browsing history, including its latest-message cache. Each connection also has a 32 MiB retained-storage budget, 50,000-message cap, 5,000-node cap and 128-level depth cap. Least recently received topics are evicted first, and the UI reports discards. Defaults live in `src/renderer/src/config.ts`.
- The retained-storage budget estimates encoded strings and bookkeeping. It is **not a process-memory or application-wide limit**: transport queues, runtime overhead, multiple connections, recordings and publishing drafts need additional memory. Message previews are bounded; export contains the complete stored payload.
- Adaptive message-rate estimates measured independently of retained history. Rates update while idle and eventually return to zero; bucket boundary precision is 100 ms.
- Publishing drafts and history per connection, templates, and a limited subset of JSON Schema validation.
- Recording directly from live MQTT events, independent of the selected topic. A recording stops on disconnect, connection switch, or the 10,000-message / 2 MiB capture limit. Saved recordings can be exported and imported (up to 10 MiB per import).
- Stopped captures, imports, renames and deletions are saved through the main process to `recordings.json` in Electron's user-data directory. Saves replace the file atomically, with a visible status and retry button. Existing localStorage recordings migrate automatically and are removed only after a successful disk write. The library currently loads into memory and is capped at 64 MiB / 1,000 recordings; export and remove older captures when needed.
- Playback with speed, stepping, and topic filters. Republish is an explicit option, off by default; enabling it sends messages to the selected broker with their recorded QoS and retain flags.
- Device simulation with temperature, room and machine presets, named signals, live previews, waveform plots and JSON payload examples. Generators include square, triangle, sawtooth, counter and random walk alongside existing distributions and sequences. Each signal can publish to its own topic, follow a shared clock or independent period, add an offset or random interval variation, and apply a publish probability. Interval sliders and three-cycle charts use the shared control styles. Devices support QoS 0/1/2 and retain; individual signals skip busy ticks without queuing. Existing combined-topic devices retain their completion-based timing. Saved devices load stopped, and loops stop on disconnect or unmount. See [the simulator guide](docs/SIMULATION.md) for timing and payload compatibility.
- Resizable topic panel, collapsible connection sidebar, and F1-F4 panel shortcuts.

Connection credentials and certificates are currently stored in renderer localStorage along with connection settings. Active captures remain in memory until stopped; closing or reloading during a capture can lose it. Wait for the recording save status before closing. Failed saves remain available for retry or export from memory. The app allows one running instance per user-data directory to keep recording writes coordinated. See the review notes before treating this as a production data-capture tool.

## Structure

```text
src/main/           Electron lifecycle, IPC handlers, MQTT clients
src/preload/        Restricted renderer-to-main bridge
src/shared/         IPC types and payload encoding
src/renderer/src/
  components/       Connection, topic, message, publishing, recording, simulation UI
  hooks/            Connection, message, and layout state
  services/         MQTT events, topic trees, recording capture, templates
  utils/            History buffer, value generators, helpers
tests/              Regression tests and Electron smoke test
```

The current review, remaining limitations, and suggested next work are in [docs/REVIEW.md](docs/REVIEW.md).
