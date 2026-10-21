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

The Electron smoke test uses hidden windows, isolated storage under `.tmp/`, and a loopback broker. It does not connect to saved user brokers or modify the user's app data. Its screenshot is written to `.tmp/electron-smoke.png`.

## Features and behavior

- Multiple MQTT 3.1.1 and MQTT 5 connections, including TLS and WebSocket configuration.
- Saved connection settings, subscriptions, reconnect intervals, and last wills, including empty will payloads.
- Virtualized topic tree that preserves exact MQTT paths, including empty levels such as `a//b`.
- Message history, retained-message filtering, sorting, copying, and JSON/CSV export. Captured history remains available after disconnect until explicitly cleared or the connection is deleted.
- Up to 300 messages and 2 MiB of UTF-8 payload per topic history buffer. An individual payload exceeding this history budget is not added to the buffer. These are per-topic limits, **not an application-wide memory limit**.
- Adaptive message-rate estimates measured independently of retained history. Rates update while idle and eventually return to zero; bucket boundary precision is 100 ms.
- Publishing drafts and history per connection, templates, and a limited subset of JSON Schema validation.
- Recording directly from live MQTT events, independent of the selected topic. A recording stops on disconnect, connection switch, or the 10,000-message / 2 MiB capture limit. Saved recordings can be exported and imported (up to 10 MiB per import).
- Playback with speed, stepping, and topic filters. Republish is an explicit option, off by default; enabling it sends messages to the selected broker with their recorded QoS and retain flags.
- Device simulation with configurable outputs and intervals. Saved devices load stopped. Running intervals use the latest device settings and stop on disconnect or unmount.
- Resizable topic panel, collapsible connection sidebar, and F1-F4 panel shortcuts.

Connection credentials and certificates are currently stored in renderer localStorage along with connection settings. Recordings also use localStorage; if its quota is exhausted, the app reports the save failure and recordings can still be exported from memory. See the review notes before treating this as a production data-capture tool.

## Structure

```text
src/main/           Electron lifecycle, IPC handlers, MQTT clients
src/preload/        Restricted renderer-to-main bridge
src/shared/         IPC types
src/renderer/src/
  components/       Connection, topic, message, publishing, recording, simulation UI
  hooks/            Connection, message, and layout state
  services/         MQTT events, topic trees, recording capture, templates
  utils/            History buffer, value generators, helpers
tests/              Regression tests and Electron smoke test
```

The current review, remaining limitations, and suggested next work are in [docs/REVIEW.md](docs/REVIEW.md).
