import { useId, type CSSProperties } from 'react';

/** The number field keeps precise/long periods available; the logarithmic slider covers 100 ms-24 h. */
export default function IntervalField({
  label = 'Publish interval (ms)',
  value,
  onChange,
}: {
  label?: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const min = 100,
    max = 86400000;
  const position = Math.max(
    0,
    Math.min(1000, (Math.log(Math.max(min, value || min) / min) / Math.log(max / min)) * 1000),
  );
  return (
    <div className="interval-field">
      <label htmlFor={id}>{label}</label>
      <div className="interval-field-controls">
        <input
          type="range"
          className="form-range"
          min="0"
          max="1000"
          step="1"
          aria-label={`${label} slider`}
          aria-valuetext={`${value} milliseconds`}
          style={{ '--range-progress': `${position / 10}%` } as CSSProperties}
          value={Math.round(position)}
          onChange={(event) =>
            onChange(Math.round(min * Math.pow(max / min, Number(event.target.value) / 1000)))
          }
        />
        <input
          id={id}
          className="form-input"
          type="number"
          min={min}
          max={max}
          step="1"
          required
          value={Number.isFinite(value) ? value : ''}
          onChange={(event) => onChange(event.target.valueAsNumber)}
        />
      </div>
    </div>
  );
}
