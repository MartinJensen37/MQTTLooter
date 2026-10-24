import { useState, useEffect, useRef } from 'react';
import { DATA_TYPE_CONFIGS, GENERATOR_CONFIGS } from './constants';
import { defaultConfig, signalTopic, validateOutput, payloadMode } from './model';
import {
  sampleDevice,
  type SimulationSample,
  type SignalState,
} from '../../../services/SimulationSample';
import type { DeviceOutput, SimulatedDevice } from './types';
import SignalTimingFields from './SignalTimingFields';
import DynamicConfigFields from './DynamicConfigFields';
import SignalWaveform from './SignalWaveform';
import SimulationPayloadPreview from './SimulationPayloadPreview';

interface Props {
  output: DeviceOutput;
  otherOutputs?: DeviceOutput[];
  device?: SimulatedDevice;
  onClose: () => void;
  onSave: (output: DeviceOutput) => void;
  onRemove?: () => void;
  lastPublished?: Pick<SimulationSample, 'payload' | 'topic' | 'payloadMode'>;
}
export default function EditOutputModal({
  output,
  otherOutputs = [],
  device,
  onClose,
  onSave,
  onRemove,
  lastPublished,
}: Props) {
  const [form, setForm] = useState<DeviceOutput>({
    ...output,
    decimalPrecision: output.decimalPrecision ?? 2,
    includeTimestamp: output.includeTimestamp !== false,
    config: { ...defaultConfig(output.dataType, output.generator), ...output.config },
  });
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const errors = validateOutput(form, otherOutputs);
  const mode = payloadMode(device, form);
  const update = (updates: Partial<DeviceOutput>) =>
    setForm((previous) => ({ ...previous, ...updates }));
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const fallback = previous?.closest('.outputs-section')?.querySelector('button');
    dialog.current?.querySelector('input')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close.current();
      }
      if (event.key === 'Tab') {
        const elements = [
          ...(dialog.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input, select, textarea, summary',
          ) ?? []),
        ];
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('keydown', keyboard);
      if (previous?.isConnected) previous.focus();
      else fallback?.focus();
    };
  }, []);
  useEffect(() => {
    const started = performance.now();
    let previous = new Map<number, SignalState>();
    const combined = device && device.publishMode !== 'signals';
    const outputs = combined
      ? device.outputs.some((item) => item.id === form.id)
        ? device.outputs.map((item) => (item.id === form.id ? form : item))
        : [...device.outputs, form]
      : [form];
    const previewDevice: SimulatedDevice = {
      id: 0,
      name: 'Preview',
      topic: 'preview',
      publishInterval: 1000,
      isPublishing: false,
      ...device,
      outputs,
      payloadFormat: combined ? device.payloadFormat : 'auto',
      payloadMode: mode,
    };
    const tick = () => {
      try {
        const errors = validateOutput(form);
        if (errors.length) throw new Error(errors[0]);
        const sample = sampleDevice(previewDevice, performance.now() - started, previous);
        previous = sample.next;
        setPreview(sample.payload);
        setPreviewError('');
      } catch (error) {
        setPreview(null);
        setPreviewError((error as Error).message);
      }
    };
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [form, device, mode]);
  const changeType = (dataType: string) =>
    update({
      dataType,
      generator: 'static',
      config: defaultConfig(dataType, 'static'),
      decimalPrecision: form.decimalPrecision ?? 2,
      unit: dataType === 'number' ? form.unit : '',
    });
  return (
    <div className="modal-overlay">
      <div
        className="modal-content modal-large signal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signal-title"
        ref={dialog}
      >
        <div className="modal-header">
          <h3 id="signal-title">Configure signal</h3>
          <button
            className="btn btn-sm btn-ghost"
            aria-label="Close signal editor"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <form
          className="panel-content output-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!errors.length) onSave({ ...form, name: form.name.trim() });
          }}
        >
          <div className="signal-parameters">
            <label>
              Signal name
              <input
                className="form-input"
                required
                value={form.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            <label>
              Data type
              <select
                className="custom-select-button form-select"
                value={form.dataType}
                onChange={(e) => changeType(e.target.value)}
              >
                {Object.entries(DATA_TYPE_CONFIGS).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Generator
              <select
                className="custom-select-button form-select"
                value={form.generator}
                onChange={(e) =>
                  update({
                    generator: e.target.value,
                    config: defaultConfig(form.dataType, e.target.value),
                  })
                }
              >
                {DATA_TYPE_CONFIGS[form.dataType].generators.map((key) => (
                  <option key={key} value={key}>
                    {GENERATOR_CONFIGS[key].label}
                  </option>
                ))}
              </select>
            </label>
            {form.dataType === 'number' && (
              <>
                <label>
                  Unit
                  <input
                    className="form-input"
                    value={form.unit ?? ''}
                    disabled={mode === 'raw'}
                    onChange={(e) => update({ unit: e.target.value })}
                  />
                </label>
                <label>
                  Decimal places
                  <input
                    className="form-input"
                    type="number"
                    min="0"
                    max="10"
                    required
                    value={Number.isFinite(form.decimalPrecision) ? form.decimalPrecision : ''}
                    onChange={(e) => update({ decimalPrecision: e.target.valueAsNumber })}
                  />
                </label>
              </>
            )}
          </div>
          {device?.publishMode === 'signals' && (
            <SignalTimingFields output={form} device={device} onChange={update} />
          )}
          <h4 className="signal-section-title">Value generator</h4>
          <DynamicConfigFields
            dataType={form.dataType}
            generator={form.generator}
            config={form.config}
            onConfigChange={(field, value) =>
              update({ config: { ...form.config, [field]: value } })
            }
          />
          <SignalWaveform output={form} />
          {(!device || device.publishMode === 'signals') && (
            <label>
              Signal payload format
              <select
                className="custom-select-button form-select"
                aria-label="Signal payload format"
                value={form.payloadMode ?? 'inherit'}
                onChange={(event) =>
                  update({
                    payloadMode:
                      event.target.value === 'inherit'
                        ? undefined
                        : (event.target.value as 'json' | 'raw'),
                  })
                }
              >
                <option value="inherit">Device default ({device?.payloadMode ?? 'json'})</option>
                <option value="json">JSON with metadata</option>
                <option value="raw">Raw scalar (UTF-8)</option>
              </select>
            </label>
          )}
          <label>
            <input
              type="checkbox"
              checked={form.includeTimestamp !== false}
              disabled={mode === 'raw'}
              onChange={(e) => update({ includeTimestamp: e.target.checked })}
            />{' '}
            Include timestamp
          </label>
          {mode === 'raw' && (
            <p className="simulation-help">
              Publishes the generated value as UTF-8 text, without quotes around strings or added
              units, timestamps or newlines. Numbers use the selected decimal rounding, without
              fixed-width trailing zeroes. Empty retained values remove the retained message.
            </p>
          )}
          {!!errors.length && (
            <ul role="alert">
              {errors.map((error, i) => (
                <li key={i}>{error}</li>
              ))}
            </ul>
          )}
          <div className="preview-section">
            <h4>
              {device && device.publishMode !== 'signals'
                ? 'Combined payload preview'
                : 'Signal payload preview'}
            </h4>
            {device && (
              <code className="preview-topic">
                {device.publishMode === 'signals' ? signalTopic(device, form) : device.topic}
              </code>
            )}
            <p>
              Independent preview, sampled twice per second. A new loop starts each signal from its
              beginning.
            </p>
            {preview === null ? (
              <pre>{previewError || 'Enter valid settings to preview.'}</pre>
            ) : (
              <SimulationPayloadPreview key={mode} payload={preview} mode={mode} />
            )}
          </div>
          {lastPublished && (
            <details className="last-published">
              <summary>Last successful publish</summary>
              <p className="simulation-help">
                Last accepted publish containing this signal; may reflect earlier settings.
              </p>
              <code className="preview-topic">{lastPublished.topic}</code>
              <SimulationPayloadPreview
                key={lastPublished.payloadMode ?? 'json'}
                payload={lastPublished.payload}
                mode={lastPublished.payloadMode}
              />
            </details>
          )}
          {confirmRemove && (
            <p role="alert">
              Remove this signal from the device? Its saved settings will be deleted.
            </p>
          )}
          <div className="form-actions">
            {onRemove && (
              <button
                type="button"
                className="btn btn-md btn-danger remove-signal"
                onClick={() => (confirmRemove ? onRemove() : setConfirmRemove(true))}
              >
                {confirmRemove ? 'Confirm removal' : 'Remove Signal'}
              </button>
            )}
            <button type="button" className="btn btn-md btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-md btn-primary" type="submit" disabled={!!errors.length}>
              Save Signal
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
