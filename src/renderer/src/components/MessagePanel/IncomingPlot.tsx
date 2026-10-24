import { useEffect, useId, useMemo, useState } from 'react';
import LinePlot from '../Charts/LinePlot';
import { fieldPointer, pointerPath, type NumericResult } from '../../../../shared/numeric-series';
import './IncomingPlot.css';

const COLORS = ['var(--primary)', 'var(--success)', 'var(--warning)', 'var(--danger)'];
const name = (pointer: string) => pointer || 'Whole payload';
const time = (value: number) => new Date(value).toLocaleTimeString();

export default function IncomingPlot({
  connectionId,
  topic,
  active = true,
}: {
  connectionId: string;
  topic: string;
  active?: boolean;
}) {
  const fieldListId = useId();
  const [duration, setDuration] = useState(60_000);
  const [end, setEnd] = useState<number | null>(null);
  const [fields, setFields] = useState(['']);
  const [candidate, setCandidate] = useState('');
  const [result, setResult] = useState<NumericResult>();
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [cursor, setCursor] = useState(1);
  const [automaticField, setAutomaticField] = useState(true);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const to = end ?? Date.now();
      try {
        const response = await window.electronAPI.history.series({
          connectionId,
          topic,
          paths: fields.map(pointerPath),
          from: Math.max(0, to - duration),
          to,
          maxPoints: 512,
        });
        if (disposed) return;
        if (!response.success || !response.data)
          throw new Error(response.error || 'Plot query failed');
        setError('');
        setResult(response.data);
        if (automaticField && response.data.series[0]?.valid === 0) {
          const first = response.data.availablePaths.find((path) => path.length > 0);
          if (first) {
            setFields([fieldPointer(first)]);
            setAutomaticField(false);
          }
        }
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : 'Plot query failed');
      } finally {
        if (!disposed && end === null) timer = setTimeout(poll, 250);
      }
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [connectionId, topic, fields, duration, end, automaticField, active]);

  const plots = useMemo(
    () =>
      result?.series.map((series, index) => ({
        id: fieldPointer(series.path),
        color: COLORS[index],
        points: series.points.map((point) => ({ ...point, x: point.x - result.from })),
      })) ?? [],
    [result],
  );
  const values = plots.flatMap((plot) => plot.points.map((point) => point.y));
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const from = result?.from ?? Date.now() - duration;
  const span = result ? result.to - result.from : duration;
  const cursorTime = from + cursor * span;
  const addField = () => {
    try {
      const pointer = fieldPointer(pointerPath(candidate));
      if (fields.includes(pointer)) throw new Error('This field is already plotted.');
      setFields((previous) => [...previous, pointer]);
      setAutomaticField(false);
      setFieldError('');
    } catch (reason) {
      setFieldError((reason as Error).message);
    }
  };
  const move = (direction: number) =>
    setEnd(
      Math.max(
        duration,
        Math.min(
          Date.now(),
          (end ?? result?.to ?? Date.now()) + direction * Math.round(duration / 2),
        ),
      ),
    );

  return (
    <section className="incoming-plot" aria-label="Incoming values plot">
      <div className="incoming-plot-toolbar">
        <label>
          Window{' '}
          <select
            aria-label="Plot window"
            className="form-select custom-select-button"
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
          >
            {[10_000, 60_000, 300_000, 3_600_000, duration]
              .filter((value, index, all) => all.indexOf(value) === index)
              .sort((a, b) => a - b)
              .map((value) => (
                <option key={value} value={value}>
                  {value / 1000} s
                </option>
              ))}
          </select>
        </label>
        <button
          className="btn btn-sm btn-secondary"
          onClick={() => setEnd(end === null ? (result?.to ?? Date.now()) : null)}
        >
          {end === null ? 'Pause plot' : 'Resume live plot'}
        </button>
        <button
          className="btn btn-sm btn-secondary"
          aria-label="Plot earlier"
          onClick={() => move(-1)}
        >
          Earlier
        </button>
        <button
          className="btn btn-sm btn-secondary"
          aria-label="Plot later"
          disabled={end === null}
          onClick={() => move(1)}
        >
          Later
        </button>
        <button
          className="btn btn-sm btn-secondary"
          aria-label="Zoom in plot"
          disabled={duration <= 1000}
          onClick={() => setDuration((value) => Math.max(1000, Math.round(value / 2)))}
        >
          +
        </button>
        <button
          className="btn btn-sm btn-secondary"
          aria-label="Zoom out plot"
          disabled={duration >= 86_400_000}
          onClick={() => setDuration((value) => Math.min(86_400_000, value * 2))}
        >
          −
        </button>
      </div>
      <div className="incoming-plot-fields">
        {fields.map((field, index) => (
          <span key={field} className="incoming-plot-field" style={{ borderColor: COLORS[index] }}>
            {name(field)}
            <button
              className="btn btn-sm btn-secondary"
              aria-label={`Remove plot field ${name(field)}`}
              disabled={fields.length === 1}
              onClick={() => {
                setFields((previous) => previous.filter((item) => item !== field));
                setAutomaticField(false);
              }}
            >
              ×
            </button>
          </span>
        ))}
        <label>
          Field{' '}
          <input
            className="form-input"
            aria-label="Numeric field path"
            list={fieldListId}
            placeholder="Whole payload or /field/path"
            value={candidate}
            onChange={(event) => {
              setCandidate(event.target.value);
              setFieldError('');
            }}
          />
          <datalist id={fieldListId}>
            {(result?.availablePaths ?? [])
              .map(fieldPointer)
              .filter(Boolean)
              .map((pointer) => (
                <option key={pointer} value={pointer} />
              ))}
          </datalist>
        </label>
        <button
          className="btn btn-sm btn-secondary"
          disabled={fields.length >= 4 || fields.includes(candidate)}
          onClick={addField}
        >
          Add field
        </button>
      </div>
      {fieldError && <p role="alert">{fieldError}</p>}
      {error && <p role="alert">{error}</p>}
      <LinePlot
        plotHeight={300}
        series={plots}
        min={min}
        max={max}
        duration={span}
        label="Incoming numeric values"
        onInspect={setCursor}
        formatX={(offset) => time(from + offset)}
      />
      <label className="incoming-plot-cursor">
        Inspect time
        <input
          type="range"
          aria-label="Plot time cursor"
          min="0"
          max="1"
          step="0.001"
          value={cursor}
          onChange={(event) => setCursor(Number(event.target.value))}
        />
      </label>
      <div className="incoming-plot-readout" aria-label="Plot sample values">
        {result?.series.map((series, index) => {
          const point = series.points.reduce<(typeof series.points)[number] | undefined>(
            (nearest, point) =>
              !nearest || Math.abs(point.x - cursorTime) <= Math.abs(nearest.x - cursorTime)
                ? point
                : nearest,
            undefined,
          );
          return (
            <span key={fieldPointer(series.path)} style={{ borderColor: COLORS[index] }}>
              {name(fieldPointer(series.path))}:{' '}
              {point
                ? `${point.y} at ${time(point.x)}.${String(point.x % 1000).padStart(3, '0')}`
                : 'No numeric samples'}
            </span>
          );
        })}
      </div>
      {result?.truncated && (
        <p role="status">Showing recent samples. Narrow the time window to see more detail.</p>
      )}
    </section>
  );
}
