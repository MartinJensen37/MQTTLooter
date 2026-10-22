import { useState, useEffect, useRef } from 'react';
import { DATA_TYPE_CONFIGS, GENERATOR_CONFIGS } from './constants';
import { defaultConfig, validateOutput } from './model';
import { generateSignalSample } from '../../../utils/valueGenerators';
import type { DeviceOutput } from './types';
import DynamicConfigFields from './DynamicConfigFields';
import SignalWaveform from './SignalWaveform';

interface Props {
  output: DeviceOutput;
  otherOutputs?: DeviceOutput[];
  onClose: () => void;
  onSave: (output: DeviceOutput) => void;
}
export default function EditOutputModal({ output, otherOutputs = [], onClose, onSave }: Props) {
  const [form, setForm] = useState<DeviceOutput>({
    ...output,
    decimalPrecision: output.decimalPrecision ?? 2,
    includeTimestamp: output.includeTimestamp !== false,
    config: { ...defaultConfig(output.dataType, output.generator), ...output.config },
  });
  const [preview, setPreview] = useState<any>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const errors = validateOutput(form, otherOutputs);
  const update = (updates: Partial<DeviceOutput>) =>
    setForm((previous) => ({ ...previous, ...updates }));
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    dialog.current?.querySelector('input')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close.current();
      }
      if (event.key === 'Tab') {
        const elements = [
          ...(dialog.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input, select, textarea',
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
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    const started = performance.now();
    let sampleIndex = 0;
    let previousValue: any;
    const tick = () => {
      try {
        if (validateOutput(form).length) {
          setPreview(null);
          return;
        }
        const { value, rawValue } = generateSignalSample(form, {
          elapsedMs: performance.now() - started,
          sampleIndex: sampleIndex++,
          previousValue,
        });
        previousValue = rawValue;
        setPreview({
          value,
          ...(form.dataType === 'number' && form.unit?.trim() ? { unit: form.unit.trim() } : {}),
          ...(form.includeTimestamp !== false ? { timestamp: new Date().toISOString() } : {}),
        });
      } catch {
        setPreview(null);
      }
    };
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [form]);
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
          <button className="modal-close-btn" aria-label="Close signal editor" onClick={onClose}>
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
                className="form-input"
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
                className="form-input"
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
          <DynamicConfigFields
            dataType={form.dataType}
            generator={form.generator}
            config={form.config}
            onConfigChange={(field, value) =>
              update({ config: { ...form.config, [field]: value } })
            }
          />
          <SignalWaveform output={form} />
          <label>
            <input
              type="checkbox"
              checked={form.includeTimestamp !== false}
              onChange={(e) => update({ includeTimestamp: e.target.checked })}
            />{' '}
            Include timestamp
          </label>
          {!!errors.length && (
            <ul role="alert">
              {errors.map((error, i) => (
                <li key={i}>{error}</li>
              ))}
            </ul>
          )}
          <div className="preview-section">
            <h4>Live signal preview</h4>
            <p>
              Independent preview, sampled twice per second. A new loop starts each signal from its
              beginning.
            </p>
            <pre>
              {preview ? JSON.stringify(preview, null, 2) : 'Enter valid settings to preview.'}
            </pre>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-md" onClick={onClose}>
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
