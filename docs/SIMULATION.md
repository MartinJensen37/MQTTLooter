# Device simulator

Open Simulation (F4), add a device, and choose a temperature sensor, room environment, machine telemetry or custom preset. Each device has one destination topic and a collection of named signals. Configure the topic, interval, QoS and retain flag, then use Publish Once or Start Loop while connected.

The workspace shows device status and topics in a list, with destination settings, signals and payload previews together in the selected device editor. It uses the full content width and stacks the device list above the editor in narrow windows. This representation matches the current model: one device publishes one JSON object containing its signals. A node graph would add complexity without helping configure these independent signals. Linked signals or multi-device scenarios would need a separate model before introducing a graph editor.

## Signals and payloads

- Numbers: static, uniform, normal, sine, square, triangle, sawtooth, counter, random walk and exponential.
- Booleans: static, probability and repeating sequences.
- Strings and enums: static, random selection, weighted selection and repeating sequences.
- Numeric signals support units and 0-10 decimal places. Each signal can include a timestamp. Names must be nonempty and unique within the device.

New devices always use signal names as JSON keys, even with only one signal:

```json
{"temperature":{"value":21.5,"unit":"°C","timestamp":"2026-10-22T12:00:00.000Z"}}
```

Existing saved devices keep their legacy structure: a single signal produces only its value/unit/timestamp object; multiple signals produce named objects. Select the named payload structure to make keys stable when adding or removing signals.

The payload example is a representative first sample. Last successful payload shows what the publish callback accepted; it does not confirm subscriber processing. The signal editor uses the same generators as publishing, with its own independent preview sampled twice per second. Waveform plots show one cycle, including phase and square-wave duty cycle.

## Timing and state

- The publish interval is 100 ms to 24 hours. A loop waits one interval before its first sample, then waits one interval after each publish completes. Broker acknowledgement latency therefore reduces the effective publish rate. Only one publish per device can be pending; missed intervals do not accumulate in a queue.
- Waves and sequences use monotonic elapsed time from their first sample. Frequency is in Hz; phase is in cycles. Zero frequency produces a constant value at the selected phase. Sequence duration sets the time per step, independently of the device's sampling interval.
- Counters start at the configured value and add their step per successful sample, clamped to the bounds. Negative steps count down. Random walks start at the configured value, then add a random amount between minus and plus the step, clamped to the bounds. Their internal state retains precision even when displayed values are rounded.
- Starting a new loop resets its signals. Editing a signal's type, generator or parameters resets that signal on its next sample; changing a name, unit or display precision preserves its state. An interval change reschedules only that device.
- Stop, deletion, disconnect and unmount cancel scheduled work. A publish already handed to the broker may still complete. Switching panels keeps loops running; switching connections stops them. Reconnect and reload never automatically restart devices.
- Devices are saved separately per connection. Live samples are not written to localStorage. Invalid settings block publishing; unreadable saved libraries are preserved and reported instead of overwritten.

The scheduler bounds work per device, not across the application. Large numbers of devices, stalled acknowledgements and overall transport backpressure still need broader load testing. There is no arbitrary nested JSON builder, signal linking or scenario timeline yet.
