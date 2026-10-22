import type { DeviceOutput, SimulatedDevice } from './types';
import { signalTopic } from './model';
import IntervalField from './IntervalField';

export default function SignalTimingFields({
  output,
  device,
  onChange,
}: {
  output: DeviceOutput;
  device: SimulatedDevice;
  onChange: (updates: Partial<DeviceOutput>) => void;
}) {
  const timing = {
    mode: 'sync' as const,
    offsetMs: 0,
    probability: 1,
    jitterPercent: 20,
    intervalMs: device.publishInterval,
    ...output.timing,
  };
  const setTiming = (updates: Partial<NonNullable<DeviceOutput['timing']>>) =>
    onChange({ timing: { ...timing, ...updates } });
  return (
    <fieldset className="signal-delivery">
      <legend>Topic and publishing schedule</legend>
      <label className="signal-topic-field">
        Signal topic
        <input
          className="form-input"
          value={output.topic ?? ''}
          placeholder={`${device.topic}/${output.name.trim()}`}
          onChange={(event) => onChange({ topic: event.target.value })}
        />
        <small className="field-hint">
          Blank uses the device prefix and signal name. Publishes to: {signalTopic(device, output)}
        </small>
      </label>
      <div className="signal-parameters">
        <label>
          Timing mode
          <select
            className="custom-select-button form-select"
            value={timing.mode}
            onChange={(event) => setTiming({ mode: event.target.value as typeof timing.mode })}
          >
            <option value="sync">Synchronized with device</option>
            <option value="fixed">Independent fixed period</option>
            <option value="random">Random interval variation</option>
          </select>
        </label>
        <label>
          Time offset (ms)
          <input
            className="form-input"
            type="number"
            min="0"
            max="86400000"
            step="1"
            required
            value={Number.isFinite(timing.offsetMs) ? timing.offsetMs : ''}
            onChange={(event) => setTiming({ offsetMs: event.target.valueAsNumber })}
          />
        </label>
        <label>
          Publish probability (%)
          <input
            className="form-input"
            type="number"
            min="0"
            max="100"
            step="any"
            required
            value={
              Number.isFinite(timing.probability)
                ? Number((timing.probability * 100).toFixed(8))
                : ''
            }
            onChange={(event) => setTiming({ probability: event.target.valueAsNumber / 100 })}
          />
        </label>
        {timing.mode === 'random' && (
          <label>
            Interval variation (+/- %)
            <input
              className="form-input"
              type="number"
              min="0"
              max="100"
              step="any"
              required
              value={Number.isFinite(timing.jitterPercent) ? timing.jitterPercent : ''}
              onChange={(event) => setTiming({ jitterPercent: event.target.valueAsNumber })}
            />
          </label>
        )}
      </div>
      {timing.mode !== 'sync' && (
        <IntervalField
          label="Signal period (ms)"
          value={timing.intervalMs}
          onChange={(intervalMs) => setTiming({ intervalMs })}
        />
      )}
      <p className="simulation-help">
        {timing.mode === 'sync'
          ? `Shares the device's ${device.publishInterval} ms clock.`
          : timing.mode === 'fixed'
            ? 'Keeps a fixed period on the device clock.'
            : 'Chooses a new interval within the variation range, with a minimum of 100 ms.'}{' '}
        Offset delays the first tick and shifts fixed schedules. Probability is checked at each
        tick: 100% always sends, 0% never sends. Publish Once sends every signal regardless of its
        schedule.
      </p>
    </fieldset>
  );
}
