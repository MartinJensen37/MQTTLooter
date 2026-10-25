# Device simulator

Open Simulation (F4), add a device, and choose a temperature sensor, room environment, machine telemetry or custom preset. Each device has a collection of named signals, with a topic and schedule per signal. Configure the default topic prefix, interval, QoS and retain flag, then use Publish Once or Start Loop while connected.

The workspace shows device status in a list and signals as compact, single-line rows: name, interval, timing-mode pill and a small pattern. Click a row (or focus it and press Enter/Space) to configure its destination, timing and value generator, inspect its payload, or remove it. Removing a signal requires confirmation; a device keeps at least one signal. The workspace uses the full content width and stacks the device list above the editor in narrow windows. Selects, buttons, fields and interval sliders reuse the app's shared styles. Sliders cover 100 ms to 24 hours logarithmically; the number field allows exact intervals. A device groups related signals and supplies a shared clock. A node graph is unnecessary for independent signals; linked values or multi-device scenarios would need a separate model.

## Signals and payloads

- Numbers: static, uniform, normal, sine, square, triangle, sawtooth, ramp, step, first-order step response, counter, random walk and exponential.
- Booleans: static, probability and repeating sequences.
- Strings and enums: static, random selection, weighted selection and repeating sequences.
- Numeric signals support units and 0-10 decimal places. Each signal can include a timestamp. Names must be nonempty and unique within the device.

New devices use **One topic per signal**. Leaving a signal's topic blank uses `<device prefix>/<signal name>`; enter a topic in the signal editor to override it. By default, each JSON message contains that signal's value, optional unit and timestamp. For example, `room/temperature` receives:

```json
{"value":21.5,"unit":"°C","timestamp":"2026-10-22T12:00:00.000Z"}
```

Existing devices keep **Combined device payload** mode and their topic, timing and payload structure. Stop the device and change Publishing mode to use individual signal topics. Combined mode publishes all signals together and ignores individual destinations and schedules. Its named payload option uses signal names as keys; the legacy option flattens a single signal. Changing mode requires the device to be stopped with no pending publish.

Payload previews live in the signal editor, alongside the effective destination. Individual-topic mode previews that signal; combined mode previews the full device payload including unsaved edits to the signal. Last successful publish shows the last accepted message containing that particular signal and its original destination, even when another signal publishes afterwards. It may reflect older settings and does not confirm subscriber processing. These live results are not saved as device configuration.

The signal editor uses the same payload construction and generators as publishing, with its own independent preview sampled twice per second. Waveform charts show three cycles, including phase and square-wave duty cycle, with numeric value ticks on the left and time in seconds along the bottom. A zero-frequency wave is constant. Overview patterns have no axes: random patterns are repeatable representative samples, counters/random walks scale to their sampled range, and text/enum signals display their generator label. They describe the value pattern, not publishing times or a prediction of random values. Drawing them never advances live generator state or randomness.

## Transition signals

Choose **Ramp**, **Step** or **Step Response** for a numeric signal. Each uses **Starting value**, **Final value** and **Transition delay (ms)**. Values may rise, fall or remain constant; the signal holds its starting value before the delay.

| Generator | Behavior after the delay | Default timing |
| --- | --- | --- |
| Ramp | Moves linearly to the final value over **Ramp duration (ms)**, then holds it. | No delay; 5,000 ms duration. |
| Step | Changes to the final value at the delay and holds it. | 1,000 ms delay. |
| Step Response | Approaches the final value exponentially without overshoot. **Time constant (ms)** sets the response speed: about 63.2% of the change after one time constant, 99.3% after five. | 1,000 ms delay; 1,000 ms time constant. |

These are single transitions, not repeating waves. Delay accepts 0 to 24 hours; ramp duration and response time constant accept 1 ms to 24 hours. Publishing still has a minimum interval of 100 ms, so a short transition can finish between messages. JSON and raw output use the same generated values and configured decimal precision.

Transition delay changes the value pattern; the publishing **Time offset** changes when samples are sent. In individual-topic mode, transitions use elapsed time from device start, including time spent skipping probability decisions or waiting for earlier publishes. Combined mode keeps the existing origin at each signal's first sample. Starting a new loop resets the clock. Editing generator parameters during a loop keeps individual signals on the device clock; combined signals restart their transition on their next sample.

Editor charts show the delay and transition with numeric axes: ramp includes a short final-value hold, step includes time after the change, and response shows five time constants. Overview rows retain tiny patterns. Preview samples are independent of live publishing and include exact transition boundaries; drawing a chart does not advance the simulator.

## Raw scalar output

Set **Payload format** to **Raw scalar (UTF-8)** in device settings. In individual-topic mode, each signal can inherit that default or explicitly select JSON or raw output. Combined raw output requires exactly one signal unless the device uses a payload template (below).

Raw strings are sent exactly as configured, including empty strings, spaces, newlines and Unicode. Static string fields support multiple lines. Booleans send `true` or `false`; numbers use the existing precision rounding without fixed-width trailing zeroes. No quotes, JSON wrapper, units, timestamps or newline are appended. Unit/timestamp settings remain saved but are disabled while raw output is selected. An empty retained raw payload clears the broker's retained message for that topic.

The signal editor offers exact text, hex and Pretty JSON views, a UTF-8 byte count and full payload copy. Text/hex previews are bounded to 4 KiB; JSON formatting has its own bounded preview. Truncation is labeled and never changes the copied or published payload. Raw JSON-looking strings open as exact text. Last-published previews remember the format that was actually used, even after editing the current format.

Saved devices now carry `schemaVersion: 1`. Unversioned devices migrate to JSON without changing their existing payload structure, topic or schedule. Unknown versions and output formats are reported while preserving the original saved library. This adds scalar serialization.

## Payload templates

For **Combined device payload**, set **Payload structure** to **Template** to compose one message from several signals. The editor starts with a template naming every signal, for example:

```json
{
  "device": "Boiler",
  "timestamp": "{{isoTimestamp}}",
  "values": { "Temperature": "{{Temperature}}", "Running": "{{Running}}" }
}
```

Each signal is available by its name. In JSON mode a placeholder that fills a whole string becomes the signal's typed value, so the message above contains `"Temperature": 21.5` and `"Running": true`; placeholders inside longer strings insert text. Templates use the publishing template syntax, so `{{timestamp}}` (milliseconds), `{{isoTimestamp}}`, `{{uuid}}` (one per message) and the random helpers also work. With **Raw scalar (UTF-8)** the template is plain text, such as `temp={{Temperature}};on={{Running}}`, and may combine several signals.

JSON templates must be valid JSON before expansion; put placeholders inside strings. Templates are checked while editing and a device with an unknown placeholder or invalid JSON cannot start. Templates are limited to 64 KiB and apply only to combined publishing; per-signal topics keep their own payloads. A signal named like a built-in placeholder (for example `uuid`) takes precedence over it.

In JSON mode, **Build from JSON Schema** replaces the template with one shaped by a schema file. Properties named like a signal use that signal; other values are generated as for imported publishing templates (bounded random numbers, enum choices, UUIDs, ISO times or fixed examples). Review the result: a schema property that should come from a signal with a different name still needs editing.

## Per-signal schedules

| Mode | Behavior |
| --- | --- |
| Synchronized with device | Uses the device interval and the same clock as other synchronized signals. |
| Independent fixed period | Uses the signal's own period on the shared device clock. |
| Random interval variation | Chooses each delay uniformly around the signal period by the configured percentage, clamped to a minimum of 100 ms. |

Time offset delays the first tick and shifts the fixed schedule. With a 1,000 ms period and 250 ms offset, ticks occur at 1,250, 2,250, 3,250 ms, and so on after Start Loop. Zero-offset synchronized signals are sampled together with the same timestamp. MQTT sends are separate messages, so broker/network delivery is not atomic or guaranteed simultaneous.

Publish probability is evaluated independently at each eligible tick: 100% always sends, 0% never sends, and 25% sends on average once in four ticks. It does not alter the signal's value distribution. Publish Once explicitly sends every signal, bypassing timing and probability.

## Publish timeline

Open **Publish timeline** below the signal list to compare planned sending times from a fresh loop start. The default window is 10 seconds, with 5/30/60-second options. Synchronized rows align, independent periods repeat separately, and offsets shift the first opportunity. This previews message timing; the tiny waveform in each signal row previews its value.

Fixed schedules show ticks colored by send chance. Random timing uses fading bands for the estimated chance of at least one send in each time bin. Hover for a numeric description, or move **Inspect bin** with the keyboard to read each row's likelihood and the aggregate expected message count. A bin with several opportunities can have more than one expected message; its probability of at least one send still cannot exceed 100%. Colors have a visibility floor, so read the numbers rather than treating opacity as a linear scale. Dashed ticks mean 0% and never send. No bins are hidden by a 1% cutoff.

For example, a 1-second fixed period with 1% send chance has 99% probability of at least one send by its 459th opportunity, assuming independent decisions and no stalls. That wait is described below the row even though the timeline stops at 60 seconds. A longer period or offset also shows the first opportunity outside the window. Combined mode explains its completion-dependent spacing instead of drawing independent signal messages.

Random estimates use 512 repeatable timing trajectories in a separate worker, with the same bounded-delay rule as publishing, a 100 ms minimum and integer-millisecond timer rounding. Send probability is calculated analytically within each trajectory. This does not consume the live RNG or generator state. Per-bin sampling uncertainty is at most approximately ±4.4 percentage points at 95% confidence under the sampling assumptions. The preview assumes an available connection and no delayed callbacks or pending publishes; it does not forecast actual deliveries, manual sends or edits during an existing run.

The calculation is capped at 128 signals and 128 time bins; extra signals are explicitly excluded from the preview and its aggregate. Rows are virtualized, live sample updates reuse the result, and closing the timeline terminates calculation. Invalid timing must be corrected before a preview is shown.

## Timing and state

- The publish interval is 100 ms to 24 hours. Individual signals follow monotonic deadlines from loop start. A slow signal skips ticks while its publish is pending; other signals keep their schedule. Late timer callbacks sample once rather than sending a catch-up burst. Combined mode retains a delay of one interval after each completed publish.
- In individual-topic mode, waves and sequences share elapsed time from device start, so offsets affect sampling times without restarting waveform phase. Combined mode retains elapsed time from each signal's first sample. Frequency is in Hz; phase is in cycles. Sequence duration sets the time per step independently of sampling intervals.
- Counters start at the configured value and add their step per successful sample, clamped to the bounds. Negative steps count down. Random walks start at the configured value, then add a random amount between minus and plus the step, clamped to the bounds. Their internal state retains precision even when displayed values are rounded.
- Starting a new loop resets its signals. Editing a signal's type, generator or parameters resets its counter/random-walk state on the next sample; changing a name, unit or display precision preserves that state. Individual-topic waves remain aligned to the shared clock. A timing change recalculates the affected signal's next deadline; fixed schedules remain aligned to the original device clock. Changing the device interval leaves independent signal periods alone.
- Stop, deletion, disconnect and unmount cancel scheduled work. A publish already handed to the broker may still complete. Switching panels keeps loops running; switching connections stops them. Reconnect and reload never automatically restart devices.
- Devices are saved separately per connection. Live samples are not written to localStorage. Invalid settings block publishing; unreadable saved libraries are preserved and reported instead of overwritten.

The scheduler bounds pending work per signal (per device in combined mode), not across the application. Large numbers of signals, stalled acknowledgements and overall transport backpressure still need broader load testing. There is no arbitrary nested JSON builder, signal linking or scenario timeline yet.
