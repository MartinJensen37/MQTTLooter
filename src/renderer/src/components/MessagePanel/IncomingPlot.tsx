import { useEffect, useId, useMemo, useRef, useState } from 'react';
import LinePlot from '../Charts/LinePlot';
import {
  fieldPointer,
  pointerPath,
  type NumericResult,
  type TimeUnit,
} from '../../../../shared/numeric-series';
import './IncomingPlot.css';

const COLORS = ['var(--primary)', 'var(--success)', 'var(--warning)', 'var(--danger)'];
const name = (pointer: string) => pointer || 'Whole payload';
const time = (value: number) => new Date(value).toLocaleTimeString();
const range = (values: number[]) =>
  values.length ? { min: Math.min(...values), max: Math.max(...values) } : { min: 0, max: 1 };

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
  const [independent, setIndependent] = useState(false);
  const [timeField, setTimeField] = useState('');
  const [timeCandidate, setTimeCandidate] = useState('');
  const [timeUnit, setTimeUnit] = useState<TimeUnit>('ms');
  // About one aggregation bucket per two rendered pixels; buckets hold up to four points.
  const section = useRef<HTMLElement>(null);
  const [maxPoints, setMaxPoints] = useState(512);
  useEffect(() => {
    const element = section.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) =>
      setMaxPoints(Math.min(1024, Math.max(64, Math.round(entry.contentRect.width / 32) * 64))),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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
          maxPoints,
          ...(timeField && { timePath: pointerPath(timeField), timeUnit }),
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
  }, [
    connectionId,
    topic,
    fields,
    duration,
    end,
    automaticField,
    active,
    maxPoints,
    timeField,
    timeUnit,
  ]);

  const plots = useMemo(
    () =>
      result?.series.map((series, index) => ({
        id: fieldPointer(series.path),
        color: COLORS[index],
        points: series.points.map((point) => ({ ...point, x: point.x - result.from })),
        ...(independent && range(series.points.map((point) => point.y))),
      })) ?? [],
    [result, independent],
  );
  const { min, max } = range(plots.flatMap((plot) => plot.points.map((point) => point.y)));
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
  const applyTimeField = () => {
    try {
      const pointer = timeCandidate.trim() ? fieldPointer(pointerPath(timeCandidate.trim())) : '';
      setTimeField(pointer);
      setTimeCandidate(pointer);
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
    <section className="incoming-plot" aria-label="Incoming values plot" ref={section}>
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
        <label>
          Scale{' '}
          <select
            aria-label="Plot scale"
            className="form-select custom-select-button"
            value={independent ? 'independent' : 'shared'}
            onChange={(event) => setIndependent(event.target.value === 'independent')}
          >
            <option value="shared">Shared</option>
            <option value="independent">Per field</option>
          </select>
        </label>
        <label>
          Time{' '}
          <input
            className="form-input"
            aria-label="Payload time field"
            placeholder="Receive time, or /time/path"
            value={timeCandidate}
            onChange={(event) => setTimeCandidate(event.target.value)}
            onBlur={applyTimeField}
            onKeyDown={(event) => event.key === 'Enter' && applyTimeField()}
          />
        </label>
        <select
          aria-label="Payload time unit"
          className="form-select custom-select-button"
          value={timeUnit}
          disabled={!timeField}
          onChange={(event) => setTimeUnit(event.target.value as TimeUnit)}
        >
          <option value="ms">Milliseconds</option>
          <option value="s">Seconds</option>
          <option value="iso">ISO 8601</option>
        </select>
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
                ? `${point.y} at ${time(point.x)}.${String(Math.floor(point.x % 1000)).padStart(3, '0')}`
                : 'No numeric samples'}
              {independent && plots[index]?.points.length
                ? ` (range ${plots[index].min} to ${plots[index].max})`
                : ''}
            </span>
          );
        })}
      </div>
      {!!(result?.timeRejected || result?.outsideWindow) && (
        <p role="status">
          Payload time: {result.timeRejected ?? 0} messages without a valid time and{' '}
          {result.outsideWindow ?? 0} outside the window are not shown.
        </p>
      )}
      {result?.truncated && (
        <p role="status">Showing recent samples. Narrow the time window to see more detail.</p>
      )}
    </section>
  );
}
