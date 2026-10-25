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
npm run test:load        # Build and measure the real app under load (LOAD_PROFILE=full for 50k topics / 5,000 msg/s)
npm run pack             # Unpacked Windows application in dist-builder/win-unpacked/
npm run dist             # Windows NSIS installer in dist-builder/
```

The load test drives retained floods and a sustained stream with history and a recording active, from a loopback broker in a separate process. It writes `.tmp/load-report-<profile>.json` with memory, event-loop delay, input round trips, queue peaks, disconnect time and per-connection accounting, and removes its isolated app data afterwards (`LOAD_KEEP=1` keeps it). Performance targets are reported; `LOAD_STRICT=1` also fails the run when one is missed. Never point it at a public broker.

The Electron smoke test uses hidden windows, isolated storage under `.tmp/`, and a loopback broker. It does not connect to saved user brokers or modify the user's app data. Screenshots are written to `.tmp/electron-smoke.png`, `.tmp/electron-simulator.png`, `.tmp/electron-simulator-small.png`, and `.tmp/electron-signal-editor.png`.

## Features and behavior

- Multiple MQTT 3.1.1 and MQTT 5 connections, including TLS and WebSocket configuration.
- Saved connection settings, subscriptions, reconnect intervals, and last wills, including empty will payloads.
- Virtualized topic tree that preserves exact MQTT paths, including empty levels such as `a//b`. Topic search includes collapsed branches, and first-seen ordering keeps existing siblings stable as traffic arrives.
- Message history, retained-message filtering, sorting, copying, and JSON/CSV export. The list follows the top in either sort order; scrolling down pins the visible message and returning to the top resumes following. History remains available after disconnect, subject to its limits, until cleared or the connection is deleted.
- Byte-preserving payloads: valid UTF-8 stays text; other bytes use base64 through IPC, recording, export and playback. Message inspection offers text/hex views; binary copy/export uses base64 with an explicit encoding field. Publishing accepts UTF-8 or canonical padded base64. Older recordings without an encoding field are read as UTF-8.
- The live cache holds up to 300 messages and 2 MiB of raw payload bytes plus estimated property storage per topic. Older messages are available in Disk history, subject to its separate limits. An oversized individual message is discarded from the live cache, including its latest-message cache. The default Larger cache allows 64 MiB estimated retained storage and 20,000 tree nodes per connection; Compact uses 32 MiB and 5,000 nodes. Both retain the 50,000-message and 128-level depth limits. All connections share a 128 MiB retained-storage cap. Ancestor nodes count toward the node limit. Defaults live in `src/renderer/src/config.ts`.
- Open **History & pins** above the topic tree to change the cache profile or pin up to eight paths per connection. Each connection's selected path and pinned paths keep their identity and ancestors under pressure; old payloads can still expire. Payloads are trimmed before metadata under byte pressure, with unprotected history trimmed first. When node space runs out, unprotected topics are evicted in least-recently-received order. The UI reports discards and expired selected history. Clear tree removes selection and pins; pins and the live cache are session-only, while the cache profile is saved. Disk history has its own persistence setting.
- The retained-storage budget estimates encoded strings and bookkeeping. It is **not a process-memory limit**: transport queues, runtime overhead, recordings and publishing drafts need additional memory. Message previews are bounded; export contains the complete stored payload. Changing profiles applies across connections and can immediately discard older history; it does not restore messages previously discarded.
- Adaptive message-rate estimates measured independently of retained history. Rates update while idle and eventually return to zero; bucket boundary precision is 100 ms.
- Publishing drafts and history per connection, templates with editable typed variables, timestamp/UUID/random placeholders, and JSON Schema validation for the declared dialect. JSON substitutions retain their types and escaping; Apply template rebuilds a draft, and Publish sends the displayed bytes. See [publishing templates](docs/TEMPLATES.md).
- Recording runs in the main process, ahead of renderer delivery, into `recordings.sqlite` in Electron's user-data directory. Each connection can record independently; selecting another connection, reloading the window or an automatic reconnect does not stop a capture. Disconnecting, deleting the connection or quitting finishes it. MQTT 5 properties and protocol versions are kept.
- Every write batch is a transaction. After a crash, the recording is listed as interrupted and keeps every message committed before the crash.
- Captures have a separate bounded queue (16,384 messages / 16 MiB). If it overflows, the dropped count is stored as a gap, connection outages are stored with their start and end, and the recording is shown as incomplete. The recording database is capped at 2 GiB; reaching it stops active captures with a notice.
- The library loads metadata only. Playback and topic filters read pages from the database, and **Save recording to file** streams the export to a chosen file. Imports are limited to 10 MiB per file. The previous `recordings.json` library and any localStorage recordings are imported once on first start; the JSON file is kept as `recordings.json.migrated`.
- Playback with speed, stepping, and topic filters. Republish is an explicit option, off by default; enabling it sends messages to the selected broker with their recorded QoS and retain flags.
- Device simulation with temperature, room and machine presets, named signals, live previews, waveform plots and JSON or raw UTF-8 scalar payloads. Generators include square, triangle, sawtooth, ramp, step, first-order step response, counter and random walk alongside existing distributions and sequences. Each signal can publish to its own topic, follow a shared clock or independent period, add an offset or random interval variation, and apply a publish probability. Interval sliders, three-cycle wave charts and single-transition previews use the shared control styles. Devices support QoS 0/1/2 and retain; individual signals skip busy ticks without queuing. Existing combined-topic devices retain their completion-based timing. Saved devices load stopped, and loops stop on disconnect or unmount. See [the simulator guide](docs/SIMULATION.md) for timing and payload compatibility.
- Simulator payload format can be set per device or overridden per signal. Raw mode sends only the scalar value; the editor offers exact text/hex, byte counts and full payload copying. Existing devices keep their JSON format.
- Resizable topic panel, collapsible connection sidebar, and F1-F4 panel shortcuts.
- Compact simulator signal rows with interval/mode pills and static mini-patterns. Open a signal for its payload preview, last successful publish and full configuration; combined-mode previews show the entire device payload.

Broker passwords, TLS private keys and key passphrases are encrypted with the operating system's credential protection (`safeStorage`) and stored by the main process in `credentials.json`; other connection settings and CA/client certificates stay in renderer localStorage. Secrets saved by earlier versions move there on first start. Connecting merges them in main, and the editor loads them only while that connection is open for editing. If OS encryption is unavailable (for example Linux without a keyring), secrets stay in localStorage as before and the editor says so. The app allows one running instance per user-data directory to keep recording and history writes coordinated. See the review notes before treating this as a production data-capture tool.

## Structure

```text
src/main/           Electron lifecycle, IPC handlers, MQTT clients, storage workers
src/preload/        Restricted renderer-to-main bridge
src/shared/         IPC types and payload encoding
src/renderer/src/
  components/       Connection, topic, message, publishing, recording, simulation UI
  hooks/            Connection, message, and layout state
  services/         MQTT events, topic trees, recording playback cursor, templates
  utils/            History buffer, value generators, helpers
tests/              Regression tests and Electron smoke test
```

The current review and remaining limitations are in [docs/REVIEW.md](docs/REVIEW.md). The audited backlog, implementation order and acceptance criteria are in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

### Message delivery under load

Incoming MQTT messages are delivered in batches (up to 128 messages / roughly 256 KiB, with a 40 ms flush window). Main waits for acknowledgement after the renderer processes each batch in short slices. The shared pending and in-flight queue is limited to 8,192 messages / 8 MiB estimated; one large message may exceed the batch target but cannot exceed the aggregate queue budget. New arrivals are dropped when that queue is full. Connection controls bypass the message queue.

The topic tree's **Message delivery** section shows received, processed and dropped/unconfirmed counts for this app run. Processed means dispatched to renderer subscribers, not durable storage. Reloading abandons old queued data; an unacknowledged batch is reported as unconfirmed. New arrivals wait within the same bounded queue until the reloaded renderer has installed its listeners, so an early batch cannot stall subsequent delivery. Delivery gaps appear separately from history-cache expiration. An active recording stops on a detected delivery gap and retains an incomplete-capture warning when saved or exported. Recording is still renderer-based and bounded; it is separate from the disk history service.

### Disk history

In Logging, choose **Source > Disk history** to browse older messages. Pages hold up to 300 messages or about 2 MiB; one larger message can exceed the byte target. **Older page** and **Newer page** navigate a fixed snapshot, while **Latest stored page** includes newly committed messages. Sorting and export apply to the current page. The stored-topic search also finds retained paths that have left the live topic tree.

A worker owns `history/history.sqlite` in Electron's user-data directory. It stores payload bytes, receive timestamps, session/sequence identity, QoS, retained flags and normalized MQTT 5 properties (binary properties use tagged base64). Writes are transactional, in batches of up to 1,024 messages / 1 MiB, through an independent 16,384-message / 16 MiB queue. Messages that do not fit in the queue are stored as gap records and capture continues; Logging shows how many messages are missing. Worker or write failure stops disk capture visibly; **Resume capture** retries without hiding the earlier gap.

History is session-only by default: it is removed on normal exit, or on the next startup after a crash. Enable **Disk history settings > Keep history across app restarts** to retain it. Messages older than 24 hours are excluded from pages and removed incrementally. Retention trims oldest records at a 256 MiB payload/metadata estimate; SQLite has a separate 512 MiB database ceiling, plus a write-ahead log truncated to 64 MiB after checkpoints. Database free pages are reused, so deleting messages need not shrink the file. The worker uses an 8 MiB SQLite page cache.

**Clear Messages** in Disk history removes that topic's stored and cached messages. Live-cache clearing remains a cache-only action. Exports currently cover the displayed page; streaming whole-history export is still planned.

### Inspecting MQTT 5 properties

Open **MQTT 5 properties** on a message card in Logging. The same inspector works with the live cache, disk-history pages and content-search matches. It shows response topic, content type, received expiry/alias values, payload format, subscription identifiers and repeated user properties. Expiry is the value received from the broker, not a live countdown; an incoming alias is not a reusable publishing alias.

Correlation data has a hex preview and **Copy correlation as base64** for the exact bytes, including empty or non-UTF-8 values. **Copy properties as JSON** and topic JSON/CSV exports include full properties; binary values use `{ "encoding": "base64", "data": "..." }`. The inspector limits previews to 64 rows, 1,024 characters per value, 128 per label and 256 correlation bytes, with a truncation notice. Copy/export is not truncated to those preview limits. Topic export still covers only the displayed message page. Plain-log mode remains payload-focused; switch to message cards for properties.

Property storage counts toward live-cache budgets, so large properties can cause history trimming even with small payloads. The Publishing tab also supports explicit outgoing properties, described below.

### Publishing MQTT 5 properties

In Publishing, expand **MQTT 5 publish properties** and enable **Include MQTT 5 properties**. Set an optional response topic, content type, expiry, payload format, correlation bytes and user properties. Correlation accepts complete hex bytes or canonical base64; changing the encoding selector changes how the text is interpreted. Enabling correlation with an empty value sends an empty binary field.

Expiry is in whole seconds: blank omits it, while `0` requests immediate expiry. Payload format describes the payload bytes and does not convert them; declaring UTF-8 rejects invalid UTF-8 payload bytes. Response topics cannot contain wildcards. These semantics follow the [MQTT 5 PUBLISH properties specification](https://docs.oasis-open.org/mqtt/mqtt/v5.0/os/mqtt-v5.0-os.html).

The app allows 64 user-property pairs and 64 KiB of encoded properties per publish. Repeated names are grouped together, preserving values within each name; cross-name row order is not guaranteed. MQTT 3 publishing requires disabling the properties, while retaining their draft fields. Main-process validation rejects invalid or unsupported properties as well as invalid topic/QoS/retain values.

Properties are saved per connection with the draft and successful publication history. Loading history restores them; different property sets remain separate history entries. **Use Selected Topic** loads the payload and resets outgoing properties so received aliases, subscription identifiers and request metadata are not replayed automatically. **Clear** resets properties, and **Remove Retained** sends an empty retained message without the draft's properties. Manual topic aliases are rejected. Instead, enable **Use topic aliases when publishing** in an MQTT 5 connection's settings: repeated topics are then sent as aliases within the Topic Alias Maximum the broker announces in CONNACK, and the alias table is discarded on every reconnect. No subscription identifiers are sent by this editor.

### Searching message contents

In Logging, choose **Source > Disk history**, select a stored topic, and open **Search message contents**. Search literal, case-sensitive UTF-8 text or a hexadecimal byte sequence such as `00 ff 80`. Hex searches the original bytes, including binary payloads. Choose the last 5 minutes, last hour or retained 24 hours; the time range and captured-message snapshot are fixed when the search starts.

Set **Topics > Topic filter** to search every stored topic of the connection that matches an MQTT filter, such as `sensors/+/temperature` or `#`. Each result shows its topic. As with subscriptions, `#` also matches the parent level, and wildcards do not match topics starting with `$` unless the filter names that level. Messages from non-matching topics still count toward each bounded scan step, so a narrow filter over a busy connection may need several **Continue search** steps. **Clear topic history** is not offered for filter results.

Search scans beyond the displayed page and the live cache. **Stop search** pauses scanning, and **Continue search** resumes from the last completed step or looks for older matches. Changing criteria, switching topics or leaving Logging stops further scan requests. Start a new search to include new arrivals. Result pages hold up to 100 matches / 1 MiB estimated; sorting, copying and export apply to those displayed matches. **Clear topic history** removes all stored and cached messages for the selected topic, including unmatched messages.

Payloads above 256 KiB and records above 1 MiB estimated are skipped with a visible count. Text mode also counts non-UTF-8 payloads it skips. Retention may remove records while browsing, and searches cannot recover expired data. Whole-result export is still planned.

### Previewing publish schedules

In Simulation, open **Publish timeline** below a device's signal list. It shows aligned fixed opportunities, offsets, random timing likelihood bands and expected message counts per time bin. The time-bin slider exposes numeric likelihoods, including rare 1% sends. A separate worker calculates repeatable estimates without advancing live generator state. Windows are bounded to 60 seconds and 128 signals; exclusions and assumptions are explicit. See [the simulator guide](docs/SIMULATION.md#publish-timeline).

### Plotting incoming values

Select a topic in Logging and choose **Display > Plot**. The plot replaces the message list below the topic details; choose Message cards or Plain log to return. The plot reads retained disk history, so it can show more than the live cache's 300 messages. It also works for topics selected through **Source > Disk history**. Numeric text plots directly; for JSON, the first discovered numeric field is selected automatically. Add up to four fields using the suggested paths in the Field input or a JSON Pointer such as `/sensors/0/value`. A literal slash in a key is `~1`, and a tilde is `~0`; dots need no escaping. JSON numeric strings, booleans and missing values are gaps, not zero.

Use **Window**, **Earlier/Later** and **+/−** to inspect a time range. **Pause plot** freezes that range while capture continues; **Resume live plot** returns to current time. Hover over the chart or move **Inspect time** with the keyboard to read the nearest retained sample and its time. **Scale > Per field** gives each field its own Y range (the axis then shows percent of each range, and the readout lists the ranges); remove a field with its adjacent button.

By default samples are placed at their receive time. To use a time inside the payload, enter its JSON Pointer in **Time** (for example `/meta/ts`) and choose milliseconds, seconds or ISO 8601. ISO times must include `Z` or an offset. The window still selects messages by receive time; samples without a valid payload time, or whose payload time falls outside the window, are omitted and counted below the chart. Leaving Logging stops queries and preserves the plot's settings.

Extrema-preserving buckets retain short spikes, with a point budget that follows the chart's width (up to 1,024 points per field). Invalid values and reconnect boundaries break lines conservatively. Queries scan at most 20,000 messages, 8 MiB of payloads or a 75 ms work target; a notice appears when older samples are omitted. Narrow the window to inspect that range. Payloads larger than 64 KiB and invalid UTF-8 are skipped as gaps. Plotted numbers use JavaScript floating-point precision. Disk retention and capture gaps still apply; a chart cannot recover expired or dropped data.

### Inspecting and copying payloads

Message cards offer Text, Hex and Pretty JSON. JSON formatting is bounded and preserves numeric spelling (including integers beyond JavaScript's safe range), strings and duplicate keys. Formatting changes the preview only; copy/export retains the original payload. Expand **Inspect payload** and drag its lower edge to resize it. Collapsed previews adapt to panel width.

Choose **Display > Plain log** for selectable text rows, then **Copy visible log** to copy the displayed preview. Binary payloads are labeled base64. The plain preview is limited to 4,096 payload characters per row and 262,144 characters overall, with a truncation notice; JSON/CSV exports still contain the complete payloads in the current view/page.

Connection settings have **Show/Hide** controls for the broker password and TLS private-key passphrase. Values start masked when the dialog opens.
