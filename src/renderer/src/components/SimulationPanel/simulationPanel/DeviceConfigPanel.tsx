import { useMemo } from 'react';
import type { SimulatedDevice, DeviceOutput } from './types';
import { GENERATOR_CONFIGS } from './constants';
import { validateDevice } from './model';
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
  onDuplicate,
}: Props) {
  const errors = validateDevice(device);
  const example = useMemo(() => {
    try {
      return sampleDevice(device, 0, undefined, () => 0.5, '2026-01-01T00:00:00.000Z').payload;
    } catch {
      return '';
    }
  }, [device]);
  return (
    <div className="device-config panel">
      <div className="device-config-header">
        <h3>{device.name || 'Unnamed device'}</h3>
        <span role="status">
          {busy ? 'Publishing...' : device.isPublishing ? 'Running' : 'Stopped'}
        </span>
        <button className="btn btn-sm" onClick={onDuplicate}>
          Duplicate device
        </button>
      </div>
      <fieldset className="device-settings">
        <legend>Device and destination</legend>
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
            MQTT topic
            <input
              className="form-input"
              value={device.topic}
              onChange={(e) => onUpdateDevice(device.id, { topic: e.target.value })}
            />
          </label>
          <label>
            Publish interval (ms)
            <input
              className="form-input"
              type="number"
              min="100"
              max="86400000"
              value={Number.isFinite(device.publishInterval) ? device.publishInterval : ''}
              onChange={(e) =>
                onUpdateDevice(device.id, { publishInterval: e.target.valueAsNumber })
              }
            />
          </label>
          <label>
            QoS
            <select
              className="form-input"
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
            Payload structure
            <select
              className="form-input"
              value={device.payloadFormat ?? 'auto'}
              onChange={(e) =>
                onUpdateDevice(device.id, { payloadFormat: e.target.value as 'auto' | 'named' })
              }
            >
              <option value="named">Named signals (stable keys)</option>
              <option value="auto">Flatten a single signal (legacy)</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={device.retain ?? false}
              onChange={(e) => onUpdateDevice(device.id, { retain: e.target.checked })}
            />{' '}
            Retain message
          </label>
        </div>
      </fieldset>
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
              <div className="output-actions">
                <button
                  className="btn btn-sm"
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
        One publish at a time per device. The interval starts after each publish completes; slow
        brokers do not build a queue. Settings apply to the next sample.
      </p>
      {!isConnected && (
        <p role="status">Connect to publish. Signals can still be configured and previewed.</p>
      )}
      <section className="simulation-payload-preview">
        <h4>Payload example</h4>
        <p>First sample with representative random values and an example timestamp.</p>
        <pre>
          {example
            ? JSON.stringify(JSON.parse(example), null, 2)
            : 'Fix the settings above to preview the payload.'}
        </pre>
        {lastPayload && (
          <details>
            <summary>Last successful publish</summary>
            <pre>{JSON.stringify(JSON.parse(lastPayload), null, 2)}</pre>
          </details>
        )}
      </section>
    </div>
  );
}
