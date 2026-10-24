import type { SimulatedDevice, DeviceOutput } from './types';
import IntervalField from './IntervalField';
import SignalSparkline from './SignalSparkline';
import PublishTimeline from './PublishTimeline';
import { validateDevice } from './model';
import { formatInterval } from './formatters';
interface Props {
  device: SimulatedDevice;
  onUpdateDevice: (id: number, updates: Partial<SimulatedDevice>) => void;
  onPublishOnce: (id: number) => void;
  onTogglePublishing: (id: number) => void;
  onAddOutput: (id: number) => void;
  isConnected: boolean;
  onEditOutput: (output: DeviceOutput) => void;
  busy?: boolean;
  onDuplicate?: () => void;
}
export default function DeviceConfigPanel({
  device,
  onUpdateDevice,
  onPublishOnce,
  onTogglePublishing,
  onAddOutput,
  isConnected,
  onEditOutput,
  busy,
  onDuplicate,
}: Props) {
  const separate = device.publishMode === 'signals';
  const errors = validateDevice(device);
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
          <label>
            Payload format
            <select
              className="custom-select-button form-select"
              aria-label="Device payload format"
              value={device.payloadMode ?? 'json'}
              disabled={device.isPublishing || busy}
              onChange={(event) =>
                onUpdateDevice(device.id, { payloadMode: event.target.value as 'json' | 'raw' })
              }
            >
              <option value="json">JSON with metadata</option>
              <option value="raw">Raw scalar (UTF-8)</option>
            </select>
          </label>
          {!separate && device.payloadMode !== 'raw' && (
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
          {device.outputs.map((output) => {
            const mode = separate ? (output.timing?.mode ?? 'sync') : 'combined';
            const interval =
              !separate || mode === 'sync' ? device.publishInterval : output.timing?.intervalMs;
            const modeLabel = {
              sync: 'Sync',
              fixed: 'Fixed',
              random: 'Random',
              combined: 'Combined',
            }[mode];
            return (
              <button
                type="button"
                className="signal-overview-row"
                key={output.id}
                onClick={() => onEditOutput(output)}
                aria-label={`Edit ${output.name}`}
                title={`Edit ${output.name}`}
              >
                <span className="signal-row-name">{output.name}</span>
                <span
                  className="badge signal-interval-pill"
                  title={
                    mode === 'combined'
                      ? 'Delay after each completed device publish'
                      : 'Publish period'
                  }
                >
                  {formatInterval(interval)}
                </span>
                <span className={`badge signal-mode-pill signal-mode-${mode}`}>{modeLabel}</span>
                <SignalSparkline output={output} />
              </button>
            );
          })}
        </div>
      </section>
      <PublishTimeline key={device.id} device={device} />
      {!!errors.length && (
        <ul role="alert">
          {errors.map((error, index) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
