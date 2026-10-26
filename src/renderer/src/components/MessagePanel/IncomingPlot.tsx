import { useEffect, useMemo, useRef, useState } from 'react';
import LinePlot, { PLOT_FRAME, plotFrame } from '../Charts/LinePlot';
import SuggestInput from '../Controls/SuggestInput';
import { clockTime } from '../../utils/time';
import { matchDecoder } from '../../../../shared/decoders';
import { useTopicDecoders } from '../../services/DecoderRegistry';
import {
  fieldPointer,
  pointerPath,
  type NumericResult,
  type TimeUnit,
} from '../../../../shared/numeric-series';
import './IncomingPlot.css';

const COLORS = ['var(--primary)', 'var(--success)', 'var(--warning)', 'var(--danger)'];
/**
 * Live plots redraw at most this often, however fast messages arrive: each refresh reads the
 * window from disk history, so all messages since the last refresh are added at once.
 */
export const PLOT_REFRESH_MS = 250;
const name = (pointer: string) => pointer || 'Whole payload';
const time = clockTime;
const range = (values: number[]) =>
  values.length ? { min: Math.min(...values), max: Math.max(...values) } : { min: 0, max: 1 };
/** A band around a flat series, so its line sits mid-chart between distinct axis labels. */
const drawn = ({ min, max }: { min: number; max: number }) => {
  if (min !== max) return { min, max };
  const pad = Math.max(1, Math.abs(min) * 0.01);
  return { min: min - pad, max: max + pad };
};

export default function IncomingPlot({
  connectionId,
  topic,
  active = true,
  connected = true,
}: {
  connectionId: string;
  topic: string;
  active?: boolean;
  /** The broker connection; losing it pauses the plot until it returns. */
  connected?: boolean;
}) {
  // A matching protobuf decoder turns stored bytes into fields before plotting.
  const decoder = matchDecoder(useTopicDecoders(), topic);
  const decoderId = decoder?.id;
  const [duration, setDuration] = useState(60_000);
  const [end, setEnd] = useState<number | null>(null);
  // The pause a disconnect made, undone when the connection returns unless changed meanwhile.
  const [disconnectPause, setDisconnectPause] = useState<number | null>(null);
  const wasConnected = useRef(connected);
  const [fields, setFields] = useState(['']);
  const [candidate, setCandidate] = useState('');
  const [result, setResult] = useState<NumericResult>();
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  // Pointer or keyboard inspection: a fraction of the time axis and where to show the card.
  const [hover, setHover] = useState<{ fraction: number; left: number; top: number } | null>(null);
  const [cardShown, setCardShown] = useState(false);
  const dwell = useRef<ReturnType<typeof setTimeout>>();
  const chart = useRef<HTMLDivElement>(null);
  useEffect(() => () => clearTimeout(dwell.current), []);
  useEffect(() => {
    if (wasConnected.current === connected) return;
    wasConnected.current = connected;
    if (!connected && end === null) {
      const at = Date.now();
      setEnd(at);
      setDisconnectPause(at);
    } else if (connected && disconnectPause !== null) {
      if (end === disconnectPause) setEnd(null);
      setDisconnectPause(null);
    }
  }, [connected, end, disconnectPause]);
  const [automaticField, setAutomaticField] = useState(true);
  const [independent, setIndependent] = useState(false);
  const [timeField, setTimeField] = useState('');
  const [timeCandidate, setTimeCandidate] = useState('');
  const [timeUnit, setTimeUnit] = useState<TimeUnit>('ms');
  // About one aggregation bucket per two rendered pixels; buckets hold up to four points.
  const section = useRef<HTMLElement>(null);
  const [maxPoints, setMaxPoints] = useState(512);
  // Drawn at its pixel width, so a wide window gives more detail rather than a taller plot.
  const [plotWidth, setPlotWidth] = useState(PLOT_FRAME.width);
  useEffect(() => {
    const element = section.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      setMaxPoints(Math.min(1024, Math.max(64, Math.round(entry.contentRect.width / 32) * 64)));
      setPlotWidth(Math.max(PLOT_FRAME.width, Math.round(chart.current?.clientWidth ?? 0)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const to = end ?? Date.now();
      const started = performance.now();
      try {
        const response = await window.electronAPI.history.series({
          connectionId,
          topic,
          paths: fields.map(pointerPath),
          from: Math.max(0, to - duration),
          to,
          maxPoints,
          ...(timeField && { timePath: pointerPath(timeField), timeUnit }),
          ...(decoderId && { decoderId }),
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
        // A slow query (a busy topic over a long window) waits longer before the next one.
        if (!disposed && end === null)
          timer = setTimeout(poll, Math.max(PLOT_REFRESH_MS, 2 * (performance.now() - started)));
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
    decoderId,
  ]);

  const plots = useMemo(
    () =>
      result?.series.map((series, index) => ({
        id: fieldPointer(series.path),
        color: COLORS[index],
        points: series.points.map((point) => ({ ...point, x: point.x - result.from })),
        ...(independent && drawn(range(series.points.map((point) => point.y)))),
      })) ?? [],
    [result, independent],
  );
  const { min, max } = drawn(range(plots.flatMap((plot) => plot.points.map((point) => point.y))));
  const from = result?.from ?? Date.now() - duration;
  const span = result ? result.to - result.from : duration;
  const cursorTime = from + (hover?.fraction ?? 1) * span;
  const nearest = (result?.series ?? []).map((series) =>
    series.points.reduce<(typeof series.points)[number] | undefined>(
      (best, point) =>
        !best || Math.abs(point.x - cursorTime) <= Math.abs(best.x - cursorTime) ? point : best,
      undefined,
    ),
  );
  const stamp = (value: number) =>
    `${time(value)}.${String(Math.floor(value % 1000)).padStart(3, '0')}`;
  const inspect = (fraction: number, left: number, top: number, immediate = false) => {
    setHover({ fraction, left, top });
    // The card appears once the pointer has rested on the plot for a moment.
    if (immediate) setCardShown(true);
    else if (!cardShown && !dwell.current)
      dwell.current = setTimeout(() => {
        dwell.current = undefined;
        setCardShown(true);
      }, 800);
  };
  const leave = () => {
    clearTimeout(dwell.current);
    dwell.current = undefined;
    setHover(null);
    setCardShown(false);
  };
  /** Keyboard inspection places the card above the plot at the cursor's position. */
  const inspectByKey = (fraction: number) => {
    const box = chart.current?.getBoundingClientRect();
    const width = box?.width ?? 0;
    const frame = plotFrame(plotWidth);
    const x = ((frame.left + fraction * (frame.right - frame.left)) / frame.width) * width;
    inspect(Math.min(1, Math.max(0, fraction)), x, 24, true);
  };
  // Fields found in the payloads, for the Field and Time suggestions.
  const available = (result?.availablePaths ?? []).map(fieldPointer);
  const addField = (text = candidate) => {
    try {
      const typed = text.trim();
      const pointer = /^whole payload$/i.test(typed) ? '' : fieldPointer(pointerPath(typed));
      if (fields.includes(pointer)) throw new Error('This field is already plotted.');
      if (fields.length >= 4) throw new Error('Up to four fields can be plotted.');
      setFields((previous) => [...previous, pointer]);
      setAutomaticField(false);
      setFieldError('');
      // Ready for the next field, without deleting the last one first.
      setCandidate('');
    } catch (reason) {
      setFieldError((reason as Error).message);
    }
  };
  const applyTimeField = (text = timeCandidate) => {
    try {
      const pointer = text.trim() ? fieldPointer(pointerPath(text.trim())) : '';
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
          <SuggestInput
            label="Payload time field"
            placeholder="Receive time or /field"
            title="Empty uses the receive time. A field such as /time uses the payload's time."
            value={timeCandidate}
            suggestions={available.filter(Boolean).map((value) => ({ value }))}
            empty="Type a field such as /time"
            onChange={setTimeCandidate}
            onPick={(value) => {
              setTimeCandidate(value);
              applyTimeField(value);
            }}
            onEnter={applyTimeField}
            onBlur={() => applyTimeField()}
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
        <label>
          Field{' '}
          <SuggestInput
            label="Numeric field path"
            placeholder="Choose or type /field"
            title="Pick a field found in the payloads, or type a JSON pointer such as /sensors/0/value."
            value={candidate}
            suggestions={available
              .filter((pointer) => !fields.includes(pointer))
              .map((value) => ({ value, label: name(value) }))}
            empty={
              error
                ? 'Fields are unavailable while plot data cannot be read'
                : result
                  ? 'No other numeric fields in this window'
                  : 'Reading fields…'
            }
            disabled={fields.length >= 4}
            onChange={(value) => {
              setCandidate(value);
              setFieldError('');
            }}
            onPick={(value) => addField(value || 'Whole payload')}
            onEnter={() => addField()}
          />
        </label>
        <button
          className="btn btn-sm btn-secondary"
          disabled={fields.length >= 4 || !candidate.trim() || fields.includes(candidate)}
          onClick={() => addField()}
        >
          Add field
        </button>
      </div>
      <ul className="incoming-plot-legend" aria-label="Plotted fields">
        {fields.map((field, index) => (
          <li key={field} className="incoming-plot-field">
            <span className="incoming-plot-swatch" style={{ background: COLORS[index] }} />
            {name(field)}
            {fields.length > 1 && (
              <button
                className="incoming-plot-field-remove"
                aria-label={`Remove plot field ${name(field)}`}
                title="Remove from the plot"
                onClick={() => {
                  setFields((previous) => previous.filter((item) => item !== field));
                  setAutomaticField(false);
                }}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {decoder && <p className="incoming-plot-decoder">Decoded with {decoder.name}</p>}
      {fieldError && <p role="alert">{fieldError}</p>}
      {error && <p role="alert">{error}</p>}
      <div
        ref={chart}
        className="incoming-plot-chart"
        tabIndex={0}
        aria-label="Plot. Hover or use the arrow keys to inspect samples."
        onKeyDown={(event) => {
          const step = event.shiftKey ? 0.1 : 0.01;
          const current = hover?.fraction ?? 1;
          const next =
            event.key === 'ArrowLeft'
              ? current - step
              : event.key === 'ArrowRight'
                ? current + step
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? 1
                    : null;
          if (event.key === 'Escape') leave();
          if (next === null) return;
          event.preventDefault();
          inspectByKey(next);
        }}
        onBlur={leave}
      >
        <LinePlot
          plotHeight={300}
          plotWidth={plotWidth}
          series={plots}
          min={min}
          max={max}
          duration={span}
          label="Incoming numeric values"
          marker={
            hover && result
              ? {
                  x: cursorTime - from,
                  points: nearest.flatMap((point, index) =>
                    point && plots[index]
                      ? [{ id: plots[index].id, x: point.x - from, y: point.y }]
                      : [],
                  ),
                }
              : undefined
          }
          onInspect={(fraction, event) => {
            const box = chart.current!.getBoundingClientRect();
            inspect(fraction, event.clientX - box.left, event.clientY - box.top);
          }}
          onLeave={leave}
          formatX={(offset) => time(from + offset)}
        />
        {hover && cardShown && result && (
          <div
            className="incoming-plot-card"
            role="status"
            style={{
              // Keep the card inside the plot: flip it to the left of the cursor near the edge.
              left: hover.left,
              top: hover.top,
              transform: `translate(${hover.left > (chart.current?.clientWidth ?? 0) / 2 ? 'calc(-100% - 12px)' : '12px'}, ${hover.top > (chart.current?.clientHeight ?? 0) / 2 ? 'calc(-100% - 12px)' : '12px'})`,
            }}
          >
            <time>{stamp(cursorTime)}</time>
            {result.series.map((series, index) => (
              <div key={fieldPointer(series.path)}>
                <span className="incoming-plot-swatch" style={{ background: COLORS[index] }} />
                {name(fieldPointer(series.path))}{' '}
                <strong>{nearest[index] ? nearest[index]!.y : '—'}</strong>
                {nearest[index] && nearest[index]!.x !== cursorTime && (
                  <small> at {stamp(nearest[index]!.x)}</small>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="incoming-plot-readout" aria-label="Plot sample values">
        {result?.series.map((series, index) => {
          const point = nearest[index];
          return (
            <span key={fieldPointer(series.path)} style={{ borderColor: COLORS[index] }}>
              {name(fieldPointer(series.path))}:{' '}
              {point ? `${point.y} at ${stamp(point.x)}` : 'No numeric samples'}
              {independent && plots[index]?.points.length
                ? (({ min, max }) => ` (range ${min} to ${max})`)(
                    range(plots[index].points.map((sample) => sample.y)),
                  )
                : ''}
            </span>
          );
        })}
      </div>
      {disconnectPause !== null && end === disconnectPause && (
        <p role="status">
          Paused while the broker is disconnected. It follows live data again on reconnect.
        </p>
      )}
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
