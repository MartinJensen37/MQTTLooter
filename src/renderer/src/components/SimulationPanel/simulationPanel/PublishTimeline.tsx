import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { SimulatedDevice } from './types';
import { validateTiming } from './model';
import {
  TIMELINE_COLUMNS,
  TIMELINE_LIMITS,
  TIMELINE_SERIES,
  type TimelineInput,
  type TimelineResult,
} from './publishTimelineModel';
import CheckToggle from '../../Controls/CheckToggle';
import InfoTip from '../../Controls/InfoTip';
import './PublishTimeline.css';

/** Height of the messages-at-once chart, and the width of its bars and the lanes' ticks. */
const TOTAL_HEIGHT = 64;
/** Height of one signal lane; the list is virtualized by it. */
const ROW_HEIGHT = 46;
const MARK_WIDTH = 3;
/** A signal's color by its position; signals past the eighth share the "other" color. */
const seriesColor = (index: number) =>
  index < TIMELINE_SERIES ? `var(--series-${index + 1})` : 'var(--series-other)';
const seconds = (ms: number) => `${Number((ms / 1000).toFixed(3))} s`;
const percent = (value: number) =>
  value > 0 && value < 0.0001 ? '<0.01%' : `${Number((value * 100).toFixed(2))}%`;
const count = (value: number) => Number(value.toPrecision(3)).toString();

export default function PublishTimeline({ device }: { device: SimulatedDevice }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="publish-timeline">
      <CheckToggle label="Show publish timeline" checked={open} onChange={setOpen} />
      {open &&
        (device.publishMode === 'signals' ? (
          <Timeline device={device} />
        ) : (
          <p>Choose one topic per signal to view the publish timeline.</p>
        ))}
    </section>
  );
}

function Timeline({ device }: { device: SimulatedDevice }) {
  const [horizon, setHorizon] = useState(10_000);
  const [result, setResult] = useState<TimelineResult>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  // Hovering (or arrow keys) inspects a time bin; its card appears after a short rest.
  const [hover, setHover] = useState<{ bin: number; left: number; top: number } | null>(null);
  const [cardShown, setCardShown] = useState(false);
  const dwell = useRef<ReturnType<typeof setTimeout>>();
  const chart = useRef<HTMLDivElement>(null);
  useEffect(() => () => clearTimeout(dwell.current), []);
  const [scroll, setScroll] = useState(0);
  const invalidTiming =
    !Number.isFinite(device.publishInterval) ||
    device.publishInterval < 100 ||
    device.publishInterval > 86400000 ||
    device.outputs
      .slice(0, TIMELINE_LIMITS.signals)
      .some((output) => validateTiming(output).length > 0);
  // Live sample/ack updates must not restart the preview calculation.
  const signature = JSON.stringify({
    period: device.publishInterval,
    horizon,
    signals: device.outputs
      .slice(0, TIMELINE_LIMITS.signals)
      .map(({ id, name, timing }) => ({ id, name, timing })),
    totalSignals: device.outputs.length,
  } satisfies TimelineInput);
  useEffect(() => {
    setBusy(true);
    setError('');
    if (invalidTiming) {
      setError('Fix invalid timing settings before previewing.');
      setBusy(false);
      return;
    }
    let disposed = false;
    let worker: Worker | undefined;
    const timer = setTimeout(() => {
      try {
        worker = new Worker(new URL('./publishTimeline.worker.ts', import.meta.url), {
          type: 'module',
        });
        worker.onmessage = ({ data }) => {
          if (disposed) return;
          setResult(data.result);
          setError(data.error ?? '');
          setBusy(false);
          worker?.terminate();
        };
        worker.onerror = () => {
          setError('Could not calculate the timeline. Close and reopen to retry.');
          setBusy(false);
          worker?.terminate();
        };
        worker.postMessage(JSON.parse(signature));
      } catch (reason) {
        setError((reason as Error).message);
        setBusy(false);
        worker?.terminate();
      }
      // Wait until a dragged slider rests before calculating.
    }, 250);
    return () => {
      disposed = true;
      clearTimeout(timer);
      worker?.terminate();
    };
  }, [signature, invalidTiming]);
  const binWidth = horizon / TIMELINE_LIMITS.bins;
  // While the preview recalculates, each signal keeps its lane, empty, so nothing moves.
  const pending = busy || !result;
  const lanes: TimelineResult =
    !pending && result
      ? result
      : {
          horizon,
          rows: device.outputs.slice(0, TIMELINE_LIMITS.signals).map((output) => ({
            id: output.id,
            name: output.name,
            period: 0,
            chance: 0,
            random: false,
            first: [0, 0],
            coverage99: null,
            ticks: [],
            likelihood: [],
            expected: [],
          })),
          aggregate: [],
          bursts: [],
          burstParts: [],
          randomExpected: [],
          omitted: Math.max(0, device.outputs.length - TIMELINE_LIMITS.signals),
        };
  const start = Math.max(0, Math.min(Math.floor(scroll / ROW_HEIGHT) - 2, lanes.rows.length - 1));
  const shown = lanes.rows.slice(start, start + 10);
  // Bursts count messages due at the same moment; randomized schedules add per-interval estimates.
  const peak = Math.max(0, ...lanes.bursts, ...lanes.randomExpected);
  const columnsPerBin = TIMELINE_COLUMNS / TIMELINE_LIMITS.bins;
  /** Stacked segments, first signal at the bottom, with a thin gap between neighbors. */
  const stack = (parts: [number, number][]) => {
    let base = 0;
    return parts.map(([series, value], index) => {
      const size = (value / (peak || 1)) * (TOTAL_HEIGHT - 2);
      // The gap separates a segment from the one above it; the top segment keeps its height.
      const gap = index < parts.length - 1 && size > 2 ? 1 : 0;
      const segment = { series, y: TOTAL_HEIGHT - base - size + gap, height: size - gap };
      base += size;
      return segment;
    });
  };
  const atOnce = (index: number) =>
    Math.max(
      0,
      ...lanes.bursts.slice(
        Math.floor(index * columnsPerBin),
        Math.floor((index + 1) * columnsPerBin),
      ),
    );
  const bin = pending ? null : (hover?.bin ?? null);
  const leave = () => {
    clearTimeout(dwell.current);
    dwell.current = undefined;
    setHover(null);
    setCardShown(false);
  };
  // Lanes and the expected-messages chart share one x axis; measure against the latter.
  const axis = () =>
    chart.current?.querySelector('.publish-timeline-total svg')?.getBoundingClientRect();
  const inspect = (event: PointerEvent<HTMLDivElement>) => {
    if (pending) return;
    const box = chart.current?.getBoundingClientRect();
    const lane = axis();
    if (!box || !lane || event.clientX < lane.left || event.clientX > lane.right) return leave();
    const index = Math.min(
      TIMELINE_LIMITS.bins - 1,
      Math.floor(((event.clientX - lane.left) / lane.width) * TIMELINE_LIMITS.bins),
    );
    setHover({ bin: index, left: event.clientX - box.left, top: event.clientY - box.top });
    if (!cardShown && !dwell.current)
      dwell.current = setTimeout(() => {
        dwell.current = undefined;
        setCardShown(true);
      }, 800);
  };
  const inspectByKey = (index: number) => {
    const box = chart.current?.getBoundingClientRect();
    const lane = axis();
    if (!box || !lane) return;
    const next = Math.max(0, Math.min(TIMELINE_LIMITS.bins - 1, index));
    setHover({
      bin: next,
      left: lane.left - box.left + ((next + 0.5) / TIMELINE_LIMITS.bins) * lane.width,
      top: lane.top - box.top,
    });
    setCardShown(true);
  };
  const likely = !pending
    ? lanes.rows
        .filter((row) => !row.error && bin !== null && row.likelihood[bin] > 0)
        .sort((a, b) => b.likelihood[bin!] - a.likelihood[bin!])
    : [];
  const cursor = (height: number) =>
    bin === null ? null : (
      <line
        className="publish-timeline-cursor"
        x1={((bin + 0.5) * 640) / TIMELINE_LIMITS.bins}
        x2={((bin + 0.5) * 640) / TIMELINE_LIMITS.bins}
        y1="0"
        y2={height}
      />
    );
  return (
    <>
      <div className="publish-timeline-controls">
        <label>
          Preview window
          <input
            type="range"
            className="form-range"
            aria-label="Timeline horizon"
            aria-valuetext={seconds(horizon)}
            min={1000}
            max={TIMELINE_LIMITS.horizon}
            step={1000}
            value={horizon}
            style={
              {
                '--range-progress': `${((horizon - 1000) / (TIMELINE_LIMITS.horizon - 1000)) * 100}%`,
              } as CSSProperties
            }
            onChange={(event) => setHorizon(Number(event.target.value))}
          />
          <output>{seconds(horizon)}</output>
        </label>
        <InfoTip text="When each signal may publish after starting the loop, assuming the connection is up and no publish stalls." />
      </div>
      {error && <p role="alert">{error}</p>}
      {(busy || !error) && (
        <div
          ref={chart}
          className="publish-timeline-chart"
          onPointerMove={inspect}
          onPointerLeave={leave}
          onBlur={leave}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 10 : 1;
            const current = bin ?? 0;
            const next =
              event.key === 'ArrowLeft'
                ? current - step
                : event.key === 'ArrowRight'
                  ? current + step
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? TIMELINE_LIMITS.bins - 1
                      : null;
            if (event.key === 'Escape') leave();
            if (next === null) return;
            event.preventDefault();
            inspectByKey(next);
          }}
        >
          <div className="publish-timeline-axis">
            <span role="status">{pending ? 'Calculating…' : 'Signal / send chance'}</span>
            <span>0 s</span>
            <span>{seconds(horizon / 2)}</span>
            <span>{seconds(horizon)}</span>
          </div>
          <div
            className="publish-timeline-rows"
            onScroll={(event) => setScroll(event.currentTarget.scrollTop)}
            tabIndex={0}
            aria-label="Signal schedules. Hover, or use the left and right arrow keys, to inspect a moment."
          >
            <div style={{ height: lanes.rows.length * ROW_HEIGHT, position: 'relative' }}>
              {shown.map((row, index) => (
                <div
                  key={row.id}
                  className="publish-timeline-row"
                  style={{ position: 'absolute', top: (start + index) * ROW_HEIGHT, width: '100%' }}
                >
                  <div className="publish-timeline-name" title={row.name}>
                    <strong>
                      <span
                        className="publish-timeline-swatch"
                        style={{ background: seriesColor(start + index) }}
                      />
                      {row.name}
                    </strong>
                    <span>{pending ? '…' : `${percent(row.chance)} · ${seconds(row.period)}`}</span>
                  </div>
                  <div className="publish-timeline-lane">
                    {row.error ? (
                      <span role="alert">{row.error}</span>
                    ) : (
                      <>
                        <svg
                          viewBox="0 0 640 24"
                          preserveAspectRatio="none"
                          style={{ '--series-color': seriesColor(start + index) } as CSSProperties}
                          role="img"
                          aria-label={`${row.name}: ${row.random ? 'estimated likelihood' : 'scheduled opportunities'}`}
                        >
                          {row.random
                            ? row.likelihood.map(
                                (probability, index) =>
                                  probability > 0 && (
                                    <rect
                                      key={index}
                                      x={(index * 640) / TIMELINE_LIMITS.bins}
                                      y="2"
                                      width={640 / TIMELINE_LIMITS.bins}
                                      height="20"
                                      opacity={0.15 + 0.85 * probability}
                                    />
                                  ),
                              )
                            : row.ticks.map((tick, index) => (
                                <line
                                  key={index}
                                  x1={(tick / horizon) * 638 + 1}
                                  x2={(tick / horizon) * 638 + 1}
                                  y1="2"
                                  y2="22"
                                  opacity={row.chance ? 0.15 + 0.85 * row.chance : 0.25}
                                  strokeDasharray={row.chance ? undefined : '2 2'}
                                />
                              ))}
                          {cursor(24)}
                        </svg>
                      </>
                    )}
                  </div>
                  <span
                    className="publish-timeline-likelihood"
                    title="Chance of at least one send at the inspected moment"
                  >
                    {bin === null ? '' : row.error ? '—' : percent(row.likelihood[bin])}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="publish-timeline-total">
            <span>
              Messages at once
              {bin !== null && (
                <>
                  <br />
                  <strong>{count(atOnce(bin) || lanes.aggregate[bin])} here</strong>
                </>
              )}
            </span>
            <svg
              viewBox={`0 0 640 ${TOTAL_HEIGHT}`}
              preserveAspectRatio="none"
              role="img"
              aria-label="Messages due at the same moment over time"
            >
              {lanes.randomExpected.map((value, bin) =>
                value > 0
                  ? stack(
                      lanes.rows.flatMap((row, index) =>
                        row.random && !row.error && row.expected[bin] > 0
                          ? [
                              [Math.min(index, TIMELINE_SERIES), row.expected[bin]] as [
                                number,
                                number,
                              ],
                            ]
                          : [],
                      ),
                    ).map(({ series, y, height }) => (
                      <rect
                        key={`r${bin}-${series}`}
                        className="publish-timeline-estimate"
                        x={(bin * 640) / TIMELINE_LIMITS.bins}
                        width={640 / TIMELINE_LIMITS.bins - 0.5}
                        y={y}
                        height={height}
                        style={{ fill: seriesColor(series) }}
                      />
                    ))
                  : null,
              )}
              {lanes.burstParts.map((parts, column) =>
                stack(parts).map(({ series, y, height }) => (
                  <rect
                    key={`${column}-${series}`}
                    x={(column * 640) / TIMELINE_COLUMNS - MARK_WIDTH / 2}
                    width={MARK_WIDTH}
                    y={y}
                    height={height}
                    style={{ fill: seriesColor(series) }}
                  />
                )),
              )}
              {cursor(TOTAL_HEIGHT)}
            </svg>
            <span>
              Peak
              <br />
              {pending ? '–' : count(peak)}
            </span>
          </div>
          {hover && cardShown && bin !== null && (
            <div
              className="publish-timeline-card"
              role="status"
              style={{
                left: hover.left,
                top: hover.top,
                // Stay inside the timeline: flip left near the right edge and above in the lower half.
                transform: `translate(${hover.left > (chart.current?.clientWidth ?? 0) / 2 ? 'calc(-100% - 12px)' : '12px'}, ${hover.top > (chart.current?.clientHeight ?? 0) / 2 ? 'calc(-100% - 12px)' : '12px'})`,
              }}
            >
              <time>
                {seconds(bin * binWidth)}–{seconds((bin + 1) * binWidth)}
              </time>
              {atOnce(bin) > 0 && (
                <div>
                  Most at once <strong>{count(atOnce(bin))}</strong>
                </div>
              )}
              <div>
                Expected in this interval <strong>{count(lanes.aggregate[bin])}</strong>
              </div>
              {likely.slice(0, 5).map((row) => (
                <div key={row.id}>
                  <span>
                    <span
                      className="publish-timeline-swatch"
                      style={{ background: seriesColor(lanes.rows.indexOf(row)) }}
                    />
                    {row.name}
                  </span>{' '}
                  <strong>{percent(row.likelihood[bin])}</strong>
                </div>
              ))}
              {likely.length > 5 && <small>{likely.length - 5} more signals may send</small>}
              {!likely.length && <small>No signal sends here</small>}
            </div>
          )}
          {lanes.omitted > 0 && (
            <p role="status">
              Showing the first {TIMELINE_LIMITS.signals} signals; {lanes.omitted} more are excluded
              from this preview and its aggregate.
            </p>
          )}
        </div>
      )}
    </>
  );
}
