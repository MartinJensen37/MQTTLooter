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
- Virtualized topic tree that preserves exact MQTT paths, including empty levels such as `a//b`. Topic search includes collapsed branches, and first-seen ordering keeps existing siblings stable as traffic arrives.
- Message history, retained-message filtering, sorting, copying, and JSON/CSV export. The list follows the top in either sort order; scrolling down pins the visible message and returning to the top resumes following. History remains available after disconnect, subject to its limits, until cleared or the connection is deleted.
- Byte-preserving payloads: valid UTF-8 stays text; other bytes use base64 through IPC, recording, export and playback. Message inspection offers text/hex views; binary copy/export uses base64 with an explicit encoding field. Publishing accepts UTF-8 or canonical padded base64. Older recordings without an encoding field are read as UTF-8.
- The live cache holds up to 300 messages and 2 MiB of raw payload bytes per topic. Older messages are available in Disk history, subject to its separate limits. An oversized individual payload is discarded from browsing history, including its latest-message cache. The default Larger cache allows 64 MiB estimated retained storage and 20,000 tree nodes per connection; Compact uses 32 MiB and 5,000 nodes. Both retain the 50,000-message and 128-level depth limits. All connections share a 128 MiB retained-storage cap. Ancestor nodes count toward the node limit. Defaults live in `src/renderer/src/config.ts`.
- Open **History & pins** above the topic tree to change the cache profile or pin up to eight paths per connection. Each connection's selected path and pinned paths keep their identity and ancestors under pressure; old payloads can still expire. Payloads are trimmed before metadata under byte pressure, with unprotected history trimmed first. When node space runs out, unprotected topics are evicted in least-recently-received order. The UI reports discards and expired selected history. Clear tree removes selection and pins; pins and the live cache are session-only, while the cache profile is saved. Disk history has its own persistence setting.
- The retained-storage budget estimates encoded strings and bookkeeping. It is **not a process-memory limit**: transport queues, runtime overhead, recordings and publishing drafts need additional memory. Message previews are bounded; export contains the complete stored payload. Changing profiles applies across connections and can immediately discard older history; it does not restore messages previously discarded.
- Adaptive message-rate estimates measured independently of retained history. Rates update while idle and eventually return to zero; bucket boundary precision is 100 ms.
- Publishing drafts and history per connection, templates, and a limited subset of JSON Schema validation.
- Recording directly from live MQTT events, independent of the selected topic. A recording stops on disconnect, connection switch, or the 10,000-message / 2 MiB capture limit. Saved recordings can be exported and imported (up to 10 MiB per import).
- Stopped captures, imports, renames and deletions are saved through the main process to `recordings.json` in Electron's user-data directory. Saves replace the file atomically, with a visible status and retry button. Existing localStorage recordings migrate automatically and are removed only after a successful disk write. The library currently loads into memory and is capped at 64 MiB / 1,000 recordings; export and remove older captures when needed.
- Playback with speed, stepping, and topic filters. Republish is an explicit option, off by default; enabling it sends messages to the selected broker with their recorded QoS and retain flags.
- Device simulation with temperature, room and machine presets, named signals, live previews, waveform plots and JSON payload examples. Generators include square, triangle, sawtooth, counter and random walk alongside existing distributions and sequences. Each signal can publish to its own topic, follow a shared clock or independent period, add an offset or random interval variation, and apply a publish probability. Interval sliders and three-cycle charts use the shared control styles. Devices support QoS 0/1/2 and retain; individual signals skip busy ticks without queuing. Existing combined-topic devices retain their completion-based timing. Saved devices load stopped, and loops stop on disconnect or unmount. See [the simulator guide](docs/SIMULATION.md) for timing and payload compatibility.
- Resizable topic panel, collapsible connection sidebar, and F1-F4 panel shortcuts.
- Compact simulator signal rows with interval/mode pills and static mini-patterns. Open a signal for its payload preview, last successful publish and full configuration; combined-mode previews show the entire device payload.

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

The current review and remaining limitations are in [docs/REVIEW.md](docs/REVIEW.md). The audited backlog, implementation order and acceptance criteria are in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

### Message delivery under load

Incoming MQTT messages are delivered in batches (up to 128 messages / roughly 256 KiB, with a 40 ms flush window). Main waits for acknowledgement after the renderer processes each batch in short slices. The shared pending and in-flight queue is limited to 8,192 messages / 8 MiB estimated; one large message may exceed the batch target but cannot exceed the aggregate queue budget. New arrivals are dropped when that queue is full. Connection controls bypass the message queue.

The topic tree's **Message delivery** section shows received, processed and dropped/unconfirmed counts for this app run. Processed means dispatched to renderer subscribers, not durable storage. Reloading abandons queued data; an unacknowledged batch is reported as unconfirmed. Delivery gaps appear separately from history-cache expiration. An active recording stops on a detected delivery gap and retains an incomplete-capture warning when saved or exported. Recording is still renderer-based and bounded; it is separate from the disk history service.

### Disk history

In Logging, choose **Source > Disk history** to browse older messages. Pages hold up to 300 messages or about 2 MiB; one larger message can exceed the byte target. **Older page** and **Newer page** navigate a fixed snapshot, while **Latest stored page** includes newly committed messages. Sorting and export apply to the current page. The stored-topic search also finds retained paths that have left the live topic tree.

A worker owns `history/history.sqlite` in Electron's user-data directory. It stores payload bytes, receive timestamps, session/sequence identity, QoS, retained flags and normalized MQTT 5 properties (binary properties use tagged base64). Writes are transactional and use an independent 8,192-message / 8 MiB queue. Overflow, worker failure or write failure stops disk capture visibly; **Resume capture** retries without hiding the earlier gap. Received/committed/dropped diagnostics cover the current app run, not a lossless-capture guarantee across crashes.

History is session-only by default: it is removed on normal exit, or on the next startup after a crash. Enable **Disk history settings > Keep history across app restarts** to retain it. Messages older than 24 hours are excluded from pages and removed incrementally. Retention trims oldest records at a 256 MiB payload/metadata estimate; SQLite has a separate 512 MiB database ceiling, with additional temporary rollback-journal space. Database free pages are reused, so deleting messages need not shrink the file. The worker uses an 8 MiB SQLite page cache and rollback journaling; WAL is not enabled.

**Clear Messages** in Disk history removes that topic's stored and cached messages. Live-cache clearing remains a cache-only action. Exports currently cover the displayed page; streaming whole-history export and database-backed recording migration are still planned. Saved recordings remain in their existing JSON library.

### Plotting incoming values

Select a topic in Logging and choose **Plot incoming values**. The plot reads retained disk history, so it can show more than the live cache's 300 messages. It also works for topics selected through **Source > Disk history**. Numeric text plots directly; for JSON, the first discovered numeric field is selected automatically. Add up to four fields using the field menu or a JSON Pointer such as `/sensors/0/value`. A literal slash in a key is `~1`, and a tilde is `~0`; dots need no escaping. JSON numeric strings, booleans and missing values are gaps, not zero.

Use **Window**, **Earlier/Later** and **+/−** to inspect a time range. **Pause plot** freezes that range while capture continues; **Resume live plot** returns to current time. Hover over the chart or move **Inspect time** with the keyboard to read the nearest retained sample and its receive timestamp. Fields share a Y scale; remove a field with its adjacent button. Leaving Logging stops queries and preserves the plot's settings.

Extrema-preserving buckets retain short spikes with at most 512 points per field. Invalid values and reconnect boundaries break lines conservatively. Queries scan at most 20,000 messages, 8 MiB of payloads or a 75 ms work target; a notice appears when older samples are omitted. Narrow the window to inspect that range. Payloads larger than 64 KiB and invalid UTF-8 are skipped as gaps. Plotted numbers use JavaScript floating-point precision. Disk retention and capture gaps still apply; a chart cannot recover expired or dropped data.

### Inspecting and copying payloads

Message cards offer Text, Hex and Pretty JSON. JSON formatting is bounded and preserves numeric spelling (including integers beyond JavaScript's safe range), strings and duplicate keys. Formatting changes the preview only; copy/export retains the original payload. Expand **Inspect payload** and drag its lower edge to resize it. Collapsed previews adapt to panel width.

Choose **Display > Plain log** for selectable text rows, then **Copy visible log** to copy the displayed preview. Binary payloads are labeled base64. The plain preview is limited to 4,096 payload characters per row and 262,144 characters overall, with a truncation notice; JSON/CSV exports still contain the complete payloads in the current view/page.

Connection settings now have **Show/Hide** controls for the broker password and TLS private-key passphrase. Values start masked when the dialog opens. Credential storage has not changed; OS-backed secret migration remains planned.
