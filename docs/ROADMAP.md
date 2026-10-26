# Roadmap

Open work, roughly in priority order. Completed work is recorded in the git history.

## Data and performance

- Stream oversized payloads in content search and fetch large payloads on demand in the inspector.
- Search across recordings.
- Measure responsiveness and full-process memory under sustained load, including plots.
- Reduce per-message allocations on the delivery path.
- Minify the renderer build.

## Sparkplug B

- Name aliases in history recorded before the app saw a birth.
- Detect sequence gaps.
- Answer rebirth requests from simulated edge nodes.
- Show primary host `STATE`.

## Interface

- Allow the same tab in both split panes, and more than two panes.
- Notices when a scrolled-to message has expired from the cache, and richer search-page navigation.
- Optional actual-event overlays in the publish timeline.
- Move the connection editor's checkboxes to the shared toggle.

## Connections and release

- Secure storage for WebSocket headers and MQTT 5 authentication data.
- Interoperability tests against more brokers (EMQX, HiveMQ) in addition to Mosquitto.
- Installer and upgrade checks before distributing builds.
- Convert the remaining JavaScript modules (`mqtt-connection-manager.js`, `MessageTemplateService.js`, `valueGenerators.js`) to TypeScript.
