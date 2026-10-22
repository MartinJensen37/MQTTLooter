# Device simulator

Open Simulation (F4), add a device, and choose a temperature sensor, room environment, machine telemetry or custom preset. Each device has a collection of named signals, with a topic and schedule per signal. Configure the default topic prefix, interval, QoS and retain flag, then use Publish Once or Start Loop while connected.

The workspace shows device status in a list and signals as compact, single-line rows: name, interval, timing-mode pill and a small pattern. Click a row (or focus it and press Enter/Space) to configure its destination, timing and value generator, inspect its payload, or remove it. Removing a signal requires confirmation; a device keeps at least one signal. The workspace uses the full content width and stacks the device list above the editor in narrow windows. Selects, buttons, fields and interval sliders reuse the app's shared styles. Sliders cover 100 ms to 24 hours logarithmically; the number field allows exact intervals. A device groups related signals and supplies a shared clock. A node graph is unnecessary for independent signals; linked values or multi-device scenarios would need a separate model.

## Signals and payloads

- Numbers: static, uniform, normal, sine, square, triangle, sawtooth, counter, random walk and exponential.
- Booleans: static, probability and repeating sequences.
- Strings and enums: static, random selection, weighted selection and repeating sequences.
- Numeric signals support units and 0-10 decimal places. Each signal can include a timestamp. Names must be nonempty and unique within the device.

New devices use **One topic per signal**. Leaving a signal's topic blank uses `<device prefix>/<signal name>`; enter a topic in the signal editor to override it. Each message contains only that signal's value, optional unit and timestamp. For example, `room/temperature` receives:

```json
{"value":21.5,"unit":"°C","timestamp":"2026-10-22T12:00:00.000Z"}
```

Existing devices keep **Combined device payload** mode and their topic, timing and payload structure. Stop the device and change Publishing mode to use individual signal topics. Combined mode publishes all signals together and ignores individual destinations and schedules. Its named payload option uses signal names as keys; the legacy option flattens a single signal. Changing mode requires the device to be stopped with no pending publish.

Payload previews live in the signal editor, alongside the effective destination. Individual-topic mode previews that signal; combined mode previews the full device payload including unsaved edits to the signal. Last successful publish shows the last accepted message containing that particular signal and its original destination, even when another signal publishes afterwards. It may reflect older settings and does not confirm subscriber processing. These live results are not saved as device configuration.

The signal editor uses the same payload construction and generators as publishing, with its own independent preview sampled twice per second. Waveform charts show three cycles, including phase and square-wave duty cycle, with numeric value ticks on the left and time in seconds along the bottom. A zero-frequency wave is constant. Overview patterns have no axes: random patterns are repeatable representative samples, counters/random walks scale to their sampled range, and text/enum signals display their generator label. They describe the value pattern, not publishing times or a prediction of random values. Drawing them never advances live generator state or randomness.

## Per-signal schedules

| Mode | Behavior |
| --- | --- |
| Synchronized with device | Uses the device interval and the same clock as other synchronized signals. |
| Independent fixed period | Uses the signal's own period on the shared device clock. |
| Random interval variation | Chooses each delay uniformly around the signal period by the configured percentage, clamped to a minimum of 100 ms. |

Time offset delays the first tick and shifts the fixed schedule. With a 1,000 ms period and 250 ms offset, ticks occur at 1,250, 2,250, 3,250 ms, and so on after Start Loop. Zero-offset synchronized signals are sampled together with the same timestamp. MQTT sends are separate messages, so broker/network delivery is not atomic or guaranteed simultaneous.

Publish probability is evaluated independently at each eligible tick: 100% always sends, 0% never sends, and 25% sends on average once in four ticks. It does not alter the signal's value distribution. Publish Once explicitly sends every signal, bypassing timing and probability.

## Timing and state

- The publish interval is 100 ms to 24 hours. Individual signals follow monotonic deadlines from loop start. A slow signal skips ticks while its publish is pending; other signals keep their schedule. Late timer callbacks sample once rather than sending a catch-up burst. Combined mode retains a delay of one interval after each completed publish.
- In individual-topic mode, waves and sequences share elapsed time from device start, so offsets affect sampling times without restarting waveform phase. Combined mode retains elapsed time from each signal's first sample. Frequency is in Hz; phase is in cycles. Sequence duration sets the time per step independently of sampling intervals.
- Counters start at the configured value and add their step per successful sample, clamped to the bounds. Negative steps count down. Random walks start at the configured value, then add a random amount between minus and plus the step, clamped to the bounds. Their internal state retains precision even when displayed values are rounded.
- Starting a new loop resets its signals. Editing a signal's type, generator or parameters resets its counter/random-walk state on the next sample; changing a name, unit or display precision preserves that state. Individual-topic waves remain aligned to the shared clock. A timing change recalculates the affected signal's next deadline; fixed schedules remain aligned to the original device clock. Changing the device interval leaves independent signal periods alone.
- Stop, deletion, disconnect and unmount cancel scheduled work. A publish already handed to the broker may still complete. Switching panels keeps loops running; switching connections stops them. Reconnect and reload never automatically restart devices.
- Devices are saved separately per connection. Live samples are not written to localStorage. Invalid settings block publishing; unreadable saved libraries are preserved and reported instead of overwritten.

The scheduler bounds pending work per signal (per device in combined mode), not across the application. Large numbers of signals, stalled acknowledgements and overall transport backpressure still need broader load testing. There is no arbitrary nested JSON builder, signal linking or scenario timeline yet.
