import { useState } from 'react';
import type { SimulatedDevice, DeviceOutput } from './types';
import { templateFromSchema } from '../../../../../shared/schema-template';
import IntervalField from './IntervalField';
import SignalSparkline from './SignalSparkline';
import PublishTimeline from './PublishTimeline';
import { defaultPayloadTemplate, MAX_PAYLOAD_TEMPLATE, validateDevice } from './model';
import { formatInterval } from './formatters';
import InfoTip from '../../Controls/InfoTip';
import CheckToggle from '../../Controls/CheckToggle';
import SparkplugBadge from '../../Controls/SparkplugBadge';
import { useSettings } from '../../../services/Settings';
import { sparkplugTopic } from '../../../../../shared/sparkplug';
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
  const raw = device.payloadMode === 'raw';
  // A Sparkplug device publishes births and data to spBv1.0 topics instead of its own topic.
  const sparkplugEnabled = useSettings().sparkplug;
  const spb = sparkplugEnabled ? device.sparkplug : undefined;
  const template = !separate && !spb && device.payloadFormat === 'template';
  const spbTopic = (messageType: 'NBIRTH' | 'NDATA' | 'DDATA') =>
    spb
      ? sparkplugTopic({
          group: spb.group || '…',
          edgeNode: spb.edgeNode || '…',
          messageType: spb.device ? (messageType === 'NDATA' ? 'DDATA' : messageType) : messageType,
          device: spb.device || undefined,
        })
      : '';
  const setTarget = (patch: Partial<NonNullable<SimulatedDevice['sparkplug']>>) =>
    onUpdateDevice(device.id, { sparkplug: { ...device.sparkplug!, ...patch } });
  const errors = validateDevice(device);
  const [schemaError, setSchemaError] = useState('');
  // Signals fill properties with their names; the schema shapes and fills everything else.
  const buildFromSchema = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = '';
    setSchemaError('');
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('schema files must be at most 1 MiB');
      const schema = JSON.parse(await file.text());
      onUpdateDevice(device.id, {
        payloadTemplate: templateFromSchema(schema, {
          variables: device.outputs.map((output) => output.name.trim()),
        }),
      });
    } catch (error) {
      setSchemaError(`Schema could not be used: ${(error as Error).message}`);
    }
  };
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
          {!spb && (
            <>
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
              {!separate && (
                <label>
                  Payload structure
                  <select
                    className="custom-select-button form-select"
                    aria-label="Payload structure"
                    value={raw && !template ? 'named' : (device.payloadFormat ?? 'auto')}
                    onChange={(event) => {
                      const payloadFormat = event.target.value as 'auto' | 'named' | 'template';
                      onUpdateDevice(device.id, {
                        payloadFormat,
                        ...(payloadFormat === 'template' &&
                          !device.payloadTemplate?.trim() && {
                            payloadTemplate: defaultPayloadTemplate(device),
                          }),
                      });
                    }}
                  >
                    <option value="named">{raw ? 'Single signal value' : 'Named signals'}</option>
                    {!raw && <option value="auto">Flatten single signal (legacy)</option>}
                    <option value="template">Template</option>
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
            </>
          )}
        </div>
        {template && (
          <div className="payload-template-field">
            <label>
              <span>
                Payload template
                <InfoTip text="Placeholders: {{signal name}}, {{timestamp}}, {{isoTimestamp}}, {{uuid}}, {{randomInt(min, max)}}" />
              </span>
              <textarea
                className="form-input payload-template-input"
                aria-label="Payload template"
                rows={8}
                spellCheck={false}
                maxLength={MAX_PAYLOAD_TEMPLATE}
                value={device.payloadTemplate ?? ''}
                onChange={(e) => onUpdateDevice(device.id, { payloadTemplate: e.target.value })}
              />
            </label>
            <div className="payload-template-actions">
              {!raw && (
                <label className="btn btn-sm btn-secondary">
                  Build from JSON Schema
                  <input
                    type="file"
                    accept=".json,application/json"
                    aria-label="Build payload template from JSON Schema"
                    hidden
                    onChange={(event) => void buildFromSchema(event.target)}
                  />
                </label>
              )}
            </div>
            {schemaError && <p role="alert">{schemaError}</p>}
          </div>
        )}
        {sparkplugEnabled && (
          <CheckToggle
            className="spb-simulation"
            checked={!!device.sparkplug}
            disabled={device.isPublishing || busy}
            onChange={(enabled) =>
              onUpdateDevice(
                device.id,
                enabled
                  ? {
                      sparkplug: {
                        group: 'Simulation',
                        edgeNode: device.name.trim().replace(/[\s/+#]+/g, '-') || 'Edge',
                        device: '',
                      },
                      publishMode: 'combined',
                      payloadMode: 'json',
                    }
                  : { sparkplug: undefined },
              )
            }
            label={
              <>
                <SparkplugBadge /> Sparkplug B edge node
              </>
            }
            hint="Publishes a birth with every signal as a metric, then data each interval, and a death when the loop stops. With a device ID the signals belong to that device."
          >
            {spb && (
              <>
                <div className="signal-parameters">
                  <label>
                    Group
                    <input
                      className="form-input"
                      value={spb.group}
                      disabled={device.isPublishing}
                      onChange={(event) => setTarget({ group: event.target.value })}
                    />
                  </label>
                  <label>
                    Edge node
                    <input
                      className="form-input"
                      value={spb.edgeNode}
                      disabled={device.isPublishing}
                      onChange={(event) => setTarget({ edgeNode: event.target.value })}
                    />
                  </label>
                  <label>
                    Device
                    <input
                      className="form-input"
                      value={spb.device ?? ''}
                      placeholder="Optional"
                      disabled={device.isPublishing}
                      onChange={(event) => setTarget({ device: event.target.value })}
                    />
                  </label>
                </div>
                <p className="spb-simulation-topics">
                  {spbTopic('NBIRTH')}
                  {spb.device && <> then {spbTopic('DDATA').replace('DDATA', 'DBIRTH')}</>}
                  <br />
                  {spbTopic('NDATA')} every interval
                </p>
              </>
            )}
          </CheckToggle>
        )}
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
