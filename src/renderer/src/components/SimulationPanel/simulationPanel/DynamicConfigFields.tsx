import { GENERATOR_CONFIGS } from './constants';
import { defaultConfig } from './model';

interface Props {
  dataType: string;
  generator: string;
  config: any;
  onConfigChange: (field: string, value: any) => void;
}
const labels: Record<string, string> = {
  min: 'Minimum',
  max: 'Maximum',
  mean: 'Mean',
  stdDev: 'Standard deviation',
  frequency: 'Frequency (Hz)',
  phase: 'Phase (cycles)',
  dutyCycle: 'High fraction (0-1)',
  start: 'Starting value',
  step: 'Step per sample',
  lambda: 'Rate (lambda)',
  trueProbability: 'True probability (0-1)',
  intervalMs: 'Time per step (ms)',
  value: 'Value',
};

export default function DynamicConfigFields({
  dataType,
  generator,
  config,
  onConfigChange,
}: Props) {
  const values = { ...defaultConfig(dataType, generator), ...config };
  const changeItem = (field: string, index: number, value: any) =>
    onConfigChange(
      field,
      values[field].map((item: any, i: number) => (i === index ? value : item)),
    );
  return (
    <div className="signal-parameters">
      {(GENERATOR_CONFIGS[generator]?.fields ?? []).map((field) => {
        if (['sequence', 'values', 'weightedValues'].includes(field)) {
          const items = Array.isArray(values[field]) ? values[field] : [];
          return (
            <fieldset key={field}>
              <legend>
                {field === 'sequence'
                  ? 'Sequence'
                  : field === 'weightedValues'
                    ? 'Weighted values'
                    : 'Values'}
              </legend>
              {items.map((item: any, index: number) => (
                <div className="signal-list-row" key={index}>
                  {dataType === 'boolean' ? (
                    <select
                      className="custom-select-button form-select"
                      aria-label={`Step ${index + 1}`}
                      value={String(item)}
                      onChange={(e) => changeItem(field, index, e.target.value === 'true')}
                    >
                      <option value="true">True</option>
                      <option value="false">False</option>
                    </select>
                  ) : (
                    <input
                      className="form-input"
                      aria-label={`Value ${index + 1}`}
                      value={field === 'weightedValues' ? item.value : item}
                      onChange={(e) =>
                        changeItem(
                          field,
                          index,
                          field === 'weightedValues'
                            ? { ...item, value: e.target.value }
                            : e.target.value,
                        )
                      }
                    />
                  )}
                  {field === 'weightedValues' && (
                    <input
                      className="form-input"
                      type="number"
                      step="any"
                      min="0"
                      required
                      aria-label={`Weight ${index + 1}`}
                      value={Number.isFinite(item.weight) ? item.weight : ''}
                      onChange={(e) =>
                        changeItem(field, index, { ...item, weight: e.target.valueAsNumber })
                      }
                    />
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    aria-label={`Remove step ${index + 1}`}
                    onClick={() =>
                      onConfigChange(
                        field,
                        items.filter((_: unknown, i: number) => i !== index),
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() =>
                  onConfigChange(field, [
                    ...items,
                    field === 'weightedValues'
                      ? { value: '', weight: 1 }
                      : dataType === 'boolean'
                        ? true
                        : '',
                  ])
                }
              >
                Add {field === 'sequence' ? 'step' : 'value'}
              </button>
            </fieldset>
          );
        }
        if (field === 'value' && dataType !== 'number')
          return (
            <label key={field}>
              Value
              {dataType === 'boolean' ? (
                <select
                  className="custom-select-button form-select"
                  value={String(values.value)}
                  onChange={(e) => onConfigChange('value', e.target.value === 'true')}
                >
                  <option value="true">True</option>
                  <option value="false">False</option>
                </select>
              ) : (
                <textarea
                  className="form-input"
                  rows={3}
                  value={values.value ?? ''}
                  onChange={(e) => onConfigChange('value', e.target.value)}
                />
              )}
            </label>
          );
        return (
          <label key={field}>
            {labels[field] ?? field}
            <input
              className="form-input"
              type="number"
              step="any"
              required
              value={Number.isFinite(values[field]) ? values[field] : ''}
              onChange={(e) => onConfigChange(field, e.target.valueAsNumber)}
            />
          </label>
        );
      })}
    </div>
  );
}
