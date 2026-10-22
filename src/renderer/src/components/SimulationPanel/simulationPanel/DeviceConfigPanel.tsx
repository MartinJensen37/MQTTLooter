import { useMemo } from 'react';
import type { SimulatedDevice, DeviceOutput } from './types';
import { GENERATOR_CONFIGS } from './constants';
import IntervalField from './IntervalField';
import SignalWaveform from './SignalWaveform';
import { signalTopic, validateDevice } from './model';
import { sampleDevice } from '../../../services/SimulationEngine';
import { formatOutputValue } from './formatters';
interface Props {
  device: SimulatedDevice;
  onUpdateDevice: (id: number, updates: Partial<SimulatedDevice>) => void;
  onPublishOnce: (id: number) => void;
  onTogglePublishing: (id: number) => void;
  onAddOutput: (id: number) => void;
  onRemoveOutput: (id: number, outputId: number) => void;
  isConnected: boolean;
  onEditOutput: (output: DeviceOutput) => void;
  busy?: boolean;
  lastPayload?: string;
  lastTopic?: string;
  onDuplicate?: () => void;
}
export default function DeviceConfigPanel({
  device,
  onUpdateDevice,
  onPublishOnce,
  onTogglePublishing,
  onAddOutput,
  onRemoveOutput,
  isConnected,
  onEditOutput,
  busy,
  lastPayload,
  lastTopic,
  onDuplicate,
}: Props) {
  const separate = device.publishMode === 'signals';
  const errors = validateDevice(device);
  const example = useMemo(() => {
    try {
      const preview = (outputs = device.outputs) =>
        JSON.parse(
          sampleDevice(
            { ...device, outputs, payloadFormat: separate ? 'auto' : device.payloadFormat },
            0,
            undefined,
            () => 0.5,
            '2026-01-01T00:00:00.000Z',
          ).payload,
        );
      return separate
        ? device.outputs.map((output) => ({
            topic: signalTopic(device, output),
            payload: preview([output]),
          }))
        : [{ topic: device.topic, payload: preview() }];
    } catch {
      return [];
    }
  }, [device, separate]);
  return (
    <div className="device-config panel">
      <div className="device-config-header">
        <h3>{device.name || 'Unnamed device'}</h3>
        <span className={`simulation-status ${device.isPublishing ? 'running' : ''}`} role="status">
          {busy ? 'Publishing...' : device.isPublishing ? 'Running' : 'Stopped'}
        </span>
        <button className="btn btn-sm btn-secondary" onClick={onDuplicate}>
          Duplicate device
        </button>
      </div>
      <fieldset className="device-settings">
        <legend>Device settings</legend>
        <div className="signal-parameters">
          <label>
            Device name
            <input
              className="form-input"
              value={device.name}
              onChange={(e) => onUpdateDevice(device.id, { name: e.target.value })}
            />
          </label>
          <label>
            {separate ? 'Default topic prefix' : 'MQTT topic'}
            <input
              className="form-input"
              value={device.topic}
              onChange={(e) => onUpdateDevice(device.id, { topic: e.target.value })}
            />
          </label>
          <label>
            QoS
            <select
              className="custom-select-button form-select"
              aria-label="QoS"
              value={device.qos ?? 0}
              onChange={(e) =>
                onUpdateDevice(device.id, { qos: Number(e.target.value) as 0 | 1 | 2 })
              }
            >
              {[0, 1, 2].map((qos) => (
                <option key={qos}>{qos}</option>
              ))}
            </select>
          </label>
          <label>
            Publishing mode
            <select
              className="custom-select-button form-select"
              value={device.publishMode ?? 'combined'}
              disabled={device.isPublishing || busy}
              onChange={(event) =>
                onUpdateDevice(device.id, {
                  publishMode: event.target.value as 'signals' | 'combined',
                })
              }
            >
              <option value="signals">One topic per signal</option>
              <option value="combined">Combined device payload</option>
            </select>
          </label>
          {!separate && (
            <label>
              Payload structure
              <select
                className="custom-select-button form-select"
                value={device.payloadFormat ?? 'auto'}
                onChange={(event) =>
                  onUpdateDevice(device.id, {
                    payloadFormat: event.target.value as 'auto' | 'named',
                  })
                }
              >
                <option value="named">Named signals</option>
                <option value="auto">Flatten single signal (legacy)</option>
              </select>
            </label>
          )}
          <label>
            <input
              type="checkbox"
              checked={device.retain ?? false}
              onChange={(e) => onUpdateDevice(device.id, { retain: e.target.checked })}
            />{' '}
            Retain message
          </label>
        </div>
        <IntervalField
          value={device.publishInterval}
          onChange={(publishInterval) => onUpdateDevice(device.id, { publishInterval })}
        />
        <p className="simulation-help">
          {separate
            ? 'Each signal has its own topic and schedule. Edit a signal to set an offset, period, interval variation or publish probability.'
            : 'Compatibility mode: all signals share one topic and publish together. Stop the loop to switch to individual signal topics.'}
        </p>
      </fieldset>
      <div className="publishing-buttons">
        <button
          className={`btn btn-md ${device.isPublishing ? 'btn-danger' : 'btn-success'}`}
          disabled={!device.isPublishing && (!isConnected || !!errors.length)}
          onClick={() => onTogglePublishing(device.id)}
        >
          {device.isPublishing ? 'Stop Loop' : 'Start Loop'}
        </button>
        <button
          className="btn btn-md btn-primary"
          disabled={!isConnected || device.isPublishing || busy || !!errors.length}
          onClick={() => onPublishOnce(device.id)}
        >
          Publish Once
        </button>
      </div>
      <p className="simulation-help">
        {separate
          ? 'Signals share a clock, with at most one pending publish per signal. Busy ticks are skipped without a catch-up burst. Publish Once sends every signal.'
          : 'One publish at a time per device. The interval starts after each publish completes; slow brokers do not build a queue.'}
      </p>
      {!isConnected && (
        <p role="status">Connect to publish. Signals can still be configured and previewed.</p>
      )}
      <section className="outputs-section">
        <div className="section-header">
          <h4>Signals ({device.outputs.length})</h4>
          <button className="btn btn-sm btn-success" onClick={() => onAddOutput(device.id)}>
            Add Signal
          </button>
        </div>
        <div className="outputs-list">
          {device.outputs.map((output) => (
            <div className="output-item" key={output.id}>
              <div className="output-info">
                <strong>{output.name}</strong>
                <span>{GENERATOR_CONFIGS[output.generator]?.label}</span>
                <small>
                  {output.dataType}
                  {output.unit ? ` / ${output.unit}` : ''}
                </small>
                <span className="output-value">
                  {output.currentValue === undefined
                    ? 'Not published yet'
                    : formatOutputValue(output)}
                </span>
              </div>
              {separate && (
                <div className="signal-delivery-summary">
                  <code>{signalTopic(device, output)}</code>
                  <span>
                    {output.timing?.mode === 'random'
                      ? 'Random'
                      : output.timing?.mode === 'fixed'
                        ? 'Fixed'
                        : 'Synchronized'}
                    {' / '}
                    {!output.timing || output.timing.mode === 'sync'
                      ? device.publishInterval
                      : output.timing.intervalMs}{' '}
                    ms
                    {' / '}offset {output.timing?.offsetMs ?? 0} ms
                    {' / '}
                    {Math.round((output.timing?.probability ?? 1) * 100)}% sends
                    {output.timing?.mode === 'random'
                      ? ` / +/- ${output.timing.jitterPercent ?? 20}% interval`
                      : ''}
                  </span>
                </div>
              )}
              <SignalWaveform output={output} />
              <div className="output-actions">
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => onEditOutput(output)}
                  aria-label={`Edit ${output.name}`}
                >
                  Edit
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  disabled={device.outputs.length <= 1}
                  onClick={() => onRemoveOutput(device.id, output.id)}
                  aria-label={`Remove ${output.name}`}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
      {!!errors.length && (
        <ul role="alert">
          {errors.map((error, index) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      )}
      <section className="simulation-payload-preview">
        <h4>{separate ? 'Topic and payload examples' : 'Payload example'}</h4>
        <p>First sample with representative random values and an example timestamp.</p>
        {example.length ? (
          example.map((message, index) => (
            <div className="payload-example" key={index}>
              <code>{message.topic}</code>
              <pre>{JSON.stringify(message.payload, null, 2)}</pre>
            </div>
          ))
        ) : (
          <p>Fix the settings above to preview the payload.</p>
        )}
        {lastPayload && (
          <details>
            <summary>Last successful publish</summary>
            {lastTopic && <code>{lastTopic}</code>}
            <pre>{JSON.stringify(JSON.parse(lastPayload), null, 2)}</pre>
          </details>
        )}
      </section>
    </div>
  );
}
