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
npm run test:electron    # Build into out-test/ and test the real app against a local MQTT broker
npm run test:load        # Build and measure the real app under load (LOAD_PROFILE=full for 50k topics / 5,000 msg/s)
npm run pack             # Unpacked Windows application in dist-builder/win-unpacked/
npm run dist             # Windows NSIS installer in dist-builder/
```

`npm test` also runs `tests/mosquitto.test.ts` against a private Mosquitto instance on a free loopback port when Mosquitto is installed (set `MOSQUITTO` to its path if needed), and skips it otherwise.

The load test drives retained floods and a sustained stream with history and a recording active, from a loopback broker in a separate process. It writes `.tmp/load-report-<profile>.json` with memory, event-loop delay, input round trips, queue peaks, disconnect time and per-connection accounting, and removes its isolated app data afterwards (`LOAD_KEEP=1` keeps it). Performance targets are reported; `LOAD_STRICT=1` also fails the run when one is missed. Never point it at a public broker.

The Electron smoke test uses hidden windows, isolated storage under `.tmp/`, and a loopback broker. It does not connect to saved user brokers or modify the user's app data. Screenshots are written to `.tmp/electron-smoke.png`, `.tmp/electron-simulator.png`, `.tmp/electron-simulator-small.png`, and `.tmp/electron-signal-editor.png`.

## Features and behavior

- Multiple MQTT 3.1.1 and MQTT 5 connections, including TLS and WebSocket configuration.
- **Split** in the header shows a second tab beside the current one, for example Logging next to Simulation. Drag the divider's grip or focus it and use the arrow keys to resize; below about 560 px of content width the panes stack instead. Choosing the second pane's tab in the tab bar swaps the panes. Both panes follow the selected connection and topic until you choose **Pin**: the second pane then stays on the current connection and topic, for example to watch one topic while the first pane browses others, and keeps that topic's cached messages from being evicted. Choose **Pin** again, swap the panes or close the split to follow the sidebar again. A pinned Simulation pane keeps its devices running while the sidebar shows another connection; unpinning it switches to the sidebar's connection, which stops them like any connection switch. Each panel exists once (no duplicated simulators or recorders), and the layout is restored after a restart.
- Saved connection settings, subscriptions, reconnect intervals, and last wills, including empty will payloads.
- Virtualized topic tree that preserves exact MQTT paths, including empty levels such as `a//b`. Topic search includes collapsed branches, and first-seen ordering keeps existing siblings stable as traffic arrives.
- Message history, retained-message filtering, sorting, copying, and JSON/CSV export. The list follows the top in either sort order; scrolling down pins the visible message and returning to the top resumes following. History remains available after disconnect, subject to its limits, until cleared or the connection is deleted.
- Byte-preserving payloads: valid UTF-8 stays text; other bytes use base64 through IPC, recording, export and playback. Message cards can show text or hex bytes; binary copy/export uses base64 with an explicit encoding field. Publishing sends UTF-8 text; turn on **Choose the payload encoding** in **Tools > Settings** to send canonical padded base64 bytes. Older recordings without an encoding field are read as UTF-8.
- The live cache holds up to 300 messages per topic by default (100 to 2,000 under **Tools > Settings > Messages per topic**) and 2 MiB of raw payload bytes plus estimated property storage per topic. Older messages are available in Disk history, subject to its separate limits. An oversized individual message is discarded from the live cache, including its latest-message cache. The default Larger cache allows 64 MiB estimated retained storage and 20,000 tree nodes per connection; Compact uses 32 MiB and 5,000 nodes. Both retain the 50,000-message and 128-level depth limits. All connections share a 128 MiB retained-storage cap. Ancestor nodes count toward the node limit. Defaults live in `src/renderer/src/config.ts`.
- **Tools > Settings > Cache size** switches between Larger (the default) and Compact. Pin a topic with the pin button beside its path in the topic details, up to eight per connection; pinned topics show a pin in the tree. Each connection's selected path and pinned paths keep their identity and ancestors under pressure; old payloads can still expire. Payloads are trimmed before metadata under byte pressure, with unprotected history trimmed first. When node space runs out, unprotected topics are evicted in least-recently-received order. The UI reports discards and expired selected history. Clear tree removes selection and pins; pins and the live cache are session-only, while the cache profile is saved. Disk history has its own persistence setting.
- The retained-storage budget estimates encoded strings and bookkeeping. It is **not a process-memory limit**: transport queues, runtime overhead, recordings and publishing drafts need additional memory. Message previews are bounded; export contains the complete stored payload. Changing profiles applies across connections and can immediately discard older history; it does not restore messages previously discarded.
- Adaptive message-rate estimates measured independently of retained history. Rates update while idle and eventually return to zero; bucket boundary precision is 100 ms.
- Publishing drafts and history per connection, and **Message schemas**: a JSON Schema and topic from which **Fill payload** builds a message that matches the schema, with editable typed variables and timestamp/UUID/random placeholders. Two examples are included, and you can import your own schemas. JSON substitutions retain their types and escaping, and Publish sends the displayed bytes. See [message schemas](docs/TEMPLATES.md).
- Recording runs in the main process, ahead of renderer delivery, into `recordings.sqlite` in Electron's user-data directory. Each connection can record independently; selecting another connection, reloading the window or an automatic reconnect does not stop a capture. Disconnecting, deleting the connection or quitting finishes it. MQTT 5 properties and protocol versions are kept.
- Every write batch is a transaction. After a crash, the recording is listed as interrupted and keeps every message committed before the crash.
- Captures have a separate bounded queue (16,384 messages / 16 MiB). If it overflows, the dropped count is stored as a gap, connection outages are stored with their start and end, and the recording is shown as incomplete. The recording database is capped at 2 GiB; reaching it stops active captures with a notice.
- The library loads metadata only. Playback and topic filters read pages from the database, and **Save recording to file** streams the export to a chosen file. **Load Recording** opens a file dialog in main and streams the file into the database in 4 MiB steps, so exports of any size can be imported (each message is limited to 1 MiB). The recording appears only after the whole file is read; a malformed file, invalid UTF-8 or the storage limit discards it, and an import interrupted by a crash is removed on the next start. Messages keep the file's order. The previous `recordings.json` library and any localStorage recordings are imported once on first start; the JSON file is kept as `recordings.json.migrated`.
- Playback with speed, stepping, and topic filters. Republish is an explicit option, off by default; enabling it sends messages to the selected broker with their recorded QoS and retain flags.
- Device simulation with temperature, room and machine presets, named signals, live previews, waveform plots and JSON or raw UTF-8 scalar payloads. Generators include square, triangle, sawtooth, ramp, step, first-order step response, counter and random walk alongside existing distributions and sequences. Each signal can publish to its own topic, follow a shared clock or independent period, add an offset or random interval variation, and apply a publish probability. Interval sliders, three-cycle wave charts and single-transition previews use the shared control styles. Devices support QoS 0/1/2 and retain; individual signals skip busy ticks without queuing. Existing combined-topic devices retain their completion-based timing. Saved devices load stopped, and loops stop on disconnect or unmount. See [the simulator guide](docs/SIMULATION.md) for timing and payload compatibility.
- Simulator payload format can be set per device or overridden per signal. Raw mode sends only the scalar value; the editor offers exact text/hex, byte counts and full payload copying. Existing devices keep their JSON format.
- Resizable connection list and topic panel: drag the grips on their edges. Dragging the connection list fully in collapses it, like clicking the logo. F1-F4 switch panels.
- **Tools > Settings** (Ctrl+,) has four sections:
  - **General**: the default message card view and 24-hour or 12-hour times.
  - **Appearance**: light, dark or system theme (light by default), text size and the interface and payload fonts.
  - **Messages & storage**: messages per topic, cache size, keeping disk history and message delivery counts.
  - **Features**: optional tools that stay hidden until turned on: the payload encoding choice, protobuf decoders and Sparkplug B. Settings saved by earlier versions under Advanced settings carry over.
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

Incoming MQTT messages are delivered in batches (up to 128 messages / roughly 256 KiB, with a 40 ms flush window). Main waits for acknowledgement after the renderer processes each batch in short slices. The shared pending and in-flight queue is limited to 8,192 messages / 8 MiB estimated; one large message may exceed the batch target but cannot exceed the aggregate queue budget. When that queue is full, further arrivals wait as each topic's newest message, for up to 32,768 topics / 8 MiB: an update replaced by a newer one on the same topic counts as dropped, and arrivals beyond that budget are dropped. A large retained flood therefore still delivers every topic's latest value, within the topic tree's own limits. Connection controls bypass the message queue.

**Tools > Settings > Message delivery** shows received, shown and dropped counts per connection for this app run; the topic tree warns when messages were dropped. Shown means dispatched to renderer subscribers, not durable storage. Reloading abandons old queued data; an unacknowledged batch is reported as unconfirmed. New arrivals wait within the same bounded queue until the reloaded renderer has installed its listeners, so an early batch cannot stall subsequent delivery. Delivery gaps appear separately from history-cache expiration. Recordings and disk history capture messages in main before this queue, so renderer delivery gaps do not affect them; their own queue overflows are stored as gaps.

### Disk history

In Logging, choose **Source > Disk history** to browse older messages. Pages hold up to 300 messages or about 2 MiB; one larger message can exceed the byte target. **Older page** and **Newer page** navigate a fixed snapshot, while **Latest stored page** includes newly committed messages. Sorting and export apply to the current page. The stored-topic search also finds retained paths that have left the live topic tree.

A worker owns `history/history.sqlite` in Electron's user-data directory. It stores payload bytes, receive timestamps, session/sequence identity, QoS, retained flags and normalized MQTT 5 properties (binary properties use tagged base64). Writes are transactional, in batches of up to 1,024 messages / 1 MiB, through an independent 16,384-message / 16 MiB queue. Messages that do not fit in the queue are stored as gap records and capture continues; Logging shows how many messages are missing. Worker or write failure stops disk capture visibly; **Resume capture** retries, starting a new worker if the old one stopped responding, without hiding the earlier gap or this session's stored history. Time the computer spends asleep does not count toward a worker's 10-second response limit.

History is session-only by default: it is removed on normal exit, or on the next startup after a crash. Turn on **Tools > Settings > Keep disk history after closing the app** to retain it. Messages older than 24 hours are excluded from pages and removed incrementally. Retention trims oldest records at a 256 MiB payload/metadata estimate; SQLite has a separate 512 MiB database ceiling, plus a write-ahead log truncated to 64 MiB after checkpoints. Database free pages are reused, so deleting messages need not shrink the file. The worker uses an 8 MiB SQLite page cache.

**Clear Messages** in Disk history removes that topic's stored and cached messages. Live-cache clearing remains a cache-only action. **Export** offers the displayed page, or **Export all stored as JSON/CSV**, which streams every retained message of the topic from main into a file you choose, oldest first. It includes messages committed before the export started; later arrivals are left out.

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

In Logging, choose **Source > Disk history**, select a stored topic, and open **Search message contents**. Search literal, case-sensitive UTF-8 text or a hexadecimal byte sequence such as `00 ff 80`. Hex searches the original bytes, including binary payloads. Choose the last 5 minutes, last hour, retained 24 hours or **Custom range**, which takes a start and end receive time in local time (seconds allowed); parts of a range older than the retained 24 hours are left out. Search walks a time index newest first, so an earlier range is reached directly rather than after scanning newer messages. The time range and captured-message snapshot are fixed when the search starts.

Set **Topics > Topic filter** to search every stored topic of the connection that matches an MQTT filter, such as `sensors/+/temperature` or `#`. Each result shows its topic. As with subscriptions, `#` also matches the parent level, and wildcards do not match topics starting with `$` unless the filter names that level. Messages from non-matching topics still count toward each bounded scan step, so a narrow filter over a busy connection may need several **Continue search** steps. **Clear topic history** is not offered for filter results.

Search scans beyond the displayed page and the live cache. **Stop search** pauses scanning, and **Continue search** resumes from the last completed step or looks for older matches. **Newer matches** shows the previous result page again, rescanned within the same snapshot. Changing criteria, switching topics or leaving Logging stops further scan requests. Start a new search to include new arrivals. Result pages hold up to 100 matches / 1 MiB estimated; sorting, copying and page export apply to those displayed matches. **Export > Export all matches as JSON/CSV** instead runs the same search to the end in main and streams every match, newest first, into a file you choose; it uses the snapshot and time window fixed when the search started. **Clear topic history** removes all stored and cached messages for the selected topic, including unmatched messages.

Payloads above 256 KiB and records above 1 MiB estimated are skipped with a visible count. Text mode also counts non-UTF-8 payloads it skips. Retention may remove records while browsing, and searches cannot recover expired data. Searches cannot be cancelled once a whole-result export has started.

### Previewing publish schedules

In Simulation, open **Publish timeline** below a device's signal list. It shows aligned fixed opportunities, offsets, random timing likelihood bands and expected message counts per time bin. Hover over the timeline, or focus it and use the arrow keys, to see each row's likelihood at that moment, including rare 1% sends; a card with the expected messages and the most likely signals follows after a moment. A separate worker calculates repeatable estimates without advancing live generator state. Windows are bounded to 60 seconds and 128 signals; exclusions and assumptions are explicit. See [the simulator guide](docs/SIMULATION.md#publish-timeline).

### Plotting incoming values

Select a topic in Logging and choose **Display > Plot**. The plot replaces the message list below the topic details; choose Message cards or Plain log to return. The plot reads retained disk history, so it can show more than the live cache's 300 messages. It also works for topics selected through **Source > Disk history**. Numeric text plots directly; for JSON, the first discovered numeric field is selected automatically. Any JSON structure works, including nested objects and arrays. Add up to four fields: the **Field** list opens on click and suggests the numeric fields found in the payloads (**Whole payload** for a plain number), filtering as you type; picking one adds it. You can also type a JSON Pointer such as `/machine/temperature/inlet` or `/sensors/0/value` and press Enter. Suggestions come from the first messages in the window and list up to 64 numeric fields, eight levels deep; a typed pointer can go 16 levels deep. The entry clears after each field is added, and the plotted fields appear as colored pills below it, matching their lines. A field whose values are all equal is drawn mid-chart with the axis spread around it. A literal slash in a key is `~1`, and a tilde is `~0`; dots need no escaping. JSON numeric strings, booleans and missing values are gaps, not zero.

Use **Window**, **Earlier/Later** and **+/−** to inspect a time range. **Pause plot** freezes that range while capture continues; **Resume live plot** returns to current time. Hover over the chart: a line and dots follow the pointer to the nearest samples, and after a moment a card shows their values and times. With the chart focused, the arrow keys (Shift for larger steps), Home and End move the same marker. The values below the chart show the latest samples, or the hovered ones. **Scale > Per field** gives each field its own Y range (the axis then shows percent of each range, and the readout lists the ranges); remove a field with the × on its pill.

By default samples are placed at their receive time. To use a time inside the payload, pick or enter its JSON Pointer in **Time** (for example `/meta/ts`) and choose milliseconds, seconds or ISO 8601. ISO times must include `Z` or an offset. The window still selects messages by receive time; samples without a valid payload time, or whose payload time falls outside the window, are omitted and counted below the chart. Leaving Logging stops queries and preserves the plot's settings.

Extrema-preserving buckets retain short spikes, with a point budget that follows the chart's width (up to 1,024 points per field). Invalid values and reconnect boundaries break lines conservatively. Queries scan at most 20,000 messages, 8 MiB of payloads or a 75 ms work target; a notice appears when older samples are omitted. Narrow the window to inspect that range. Payloads larger than 64 KiB and invalid UTF-8 are skipped as gaps. Plotted numbers use JavaScript floating-point precision. Disk retention and capture gaps still apply; a chart cannot recover expired or dropped data.

### Decoding protobuf payloads

Turn on **Protobuf decoders** in **Tools > Settings**, then choose **Decoders** in Logging to add a protobuf decoder: pick a `.proto` file, together with any files it imports, choose one of their message types and enter the MQTT topic filter it applies to (for example `plant/+/reading`). Message cards on matching topics are then decoded in the default **View > Auto**; **View** above the cards also offers Text and Hex. The first decoder whose filter matches is used; the list is numbered in that order.

Decoding runs in a main-process worker, because generated protobuf code is not allowed under the window's content security policy. It never changes stored or exported bytes. Decoded JSON keeps 64-bit integers exact as strings, shows bytes as base64 and enums by name, and omits fields left at their default value. Payloads above 1 MiB and decoded output above 1 MiB are not decoded. All chosen files are compiled together and saved with the decoder, at most 32 files of 1 MiB each and 4 MiB in total; Google's well-known types (`google/protobuf/*.proto`) are built in. If an imported file is missing, the error names it. Definitions are saved in `decoders.json` in Electron's user-data directory, and a definition that does not compile is rejected rather than saved. **Display > Plot** also uses a matching decoder: the history worker decodes stored payloads, so decoded numeric fields can be plotted like JSON fields. For plotting, 64-bit integers become JavaScript numbers (exact up to 2^53) and fields at their default value count as zero. Content search offers **Match > Decoded protobuf** once a decoder exists: it searches the decoded JSON text of each message, using the decoder that matches that message's topic, so it also finds values such as exact 64-bit integers that never appear as text in the bytes. Messages without a matching decoder, or whose payload does not decode, are skipped and counted.

### Sparkplug B

Turn on **Sparkplug B** in **Tools > Settings**. Sparkplug topics, messages and tools are then marked with a yellow **SpB v3.0** badge, and Logging, Publishing and Simulation each gain a Sparkplug section that stays folded until you open it. Turning the setting off hides them again; nothing is deleted.

- **Decoding.** Topics of the form `spBv1.0/<group>/<NBIRTH|NDATA|NDEATH|NCMD|DBIRTH|DDATA|DDEATH|DCMD>/<edge node>[/<device>]` are decoded with the built-in Eclipse Tahu schema (`spBv1.0/STATE/<host>` is JSON and stays text). The decoded view lists metrics by name with their value, data type and alias. Values follow their declared type: signed 8/16/32/64-bit integers, unsigned integers, floats rounded to their 32-bit precision, DateTime in milliseconds, bytes as base64, Sparkplug 3.0 array types, DataSets as columns and rows, Templates and property sets. 64-bit values beyond 2^53 stay exact as text. A decoder of your own for `spBv1.0` topics takes precedence.
- **Aliases.** Data messages often send a metric's alias instead of its name. The app learns names and types from the birth messages it receives (NBIRTH for the edge node, DBIRTH for each device), so data received after a birth shows names. Births are not retained, so data from a node that was born before you connected shows `Alias <n>` until its next birth; **Request rebirth** asks for one.
- **Plots and search.** **Display > Plot** offers each metric as `/metrics/<name>/value`, and content search can match decoded Sparkplug text. Both decode stored history in the history worker, which learns aliases from births in the same way.
- **Logging.** On a Sparkplug topic, the **Sparkplug B** section in the topic details shows whether the edge node (and device) is online since its last birth or death, the latest `seq` and `bdSeq`, and every metric from the last birth updated by the latest data message. **Request rebirth** publishes `Node Control/Rebirth = true` to the edge node's NCMD topic.
- **Publishing.** **Sparkplug B command** builds NCMD messages for an edge node, or DCMD when a device is set. It fills in the selected topic's group, edge node and device, suggests metric names and types from the target's last birth, checks each value against its type and has a **Rebirth** preset. Commands use QoS 0 and are not retained.
- **Simulation.** **Sparkplug B edge node** turns a simulated device into an edge node (or one of its devices). Starting the loop publishes NBIRTH, plus DBIRTH when a device ID is set, with every signal as a metric (numbers as Double, booleans as Boolean, other values as String) and `bdSeq` and `Node Control/Rebirth` on the node. Each interval then sends NDATA or DDATA by alias with `seq` counting up to 255 and wrapping to 0. Stopping the loop sends DDEATH and NDEATH; `bdSeq` counts up with each new session. The device's topic, QoS, retain and payload settings are not used while this is on. The simulator does not answer rebirth commands, and a lost connection sends no death, because the death certificate is normally the connection's last will.

Encoding runs in the decoder worker as well, so publishing a command or simulated message never runs protobuf code in the window.

### Inspecting and copying payloads

**View** above the message cards applies to the whole topic. **Auto** (the default) indents JSON objects and arrays, shows binary payloads as hex, decodes protobuf when a decoder matches, and otherwise shows the text as received; **Text as received** and **Hex bytes** are also available. Cards show the first eight lines; **Inspect payload** shows everything. JSON formatting is bounded and preserves numeric spelling (including integers beyond JavaScript's safe range), strings and duplicate keys. Formatting changes the preview only; copy/export retains the original payload. Expand **Inspect payload** and drag its lower edge to resize it. Collapsed previews adapt to panel width.

Choose **Display > Plain log** for selectable text rows, then **Copy visible log** to copy the displayed preview. Binary payloads are labeled base64. The plain preview is limited to 4,096 payload characters per row and 262,144 characters overall, with a truncation notice; JSON/CSV exports still contain the complete payloads in the current view/page.

Connection settings have **Show/Hide** controls for the broker password and TLS private-key passphrase. Values start masked when the dialog opens.
