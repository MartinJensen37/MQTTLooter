import type { DeviceOutput } from './types';
import { validateTiming } from './model';
import { signalDelay, signalPeriod } from '../../../services/signalTiming';

export const TIMELINE_LIMITS = { signals: 128, bins: 128, trials: 512, horizon: 60_000 };
/** Horizontal resolution of the burst chart, one column per chart unit. */
export const TIMELINE_COLUMNS = 640;
/** Signals with their own color; later ones share one "other" color and stack segment. */
export const TIMELINE_SERIES = 8;
export interface TimelineInput {
  period: number;
  horizon: number;
  signals: Pick<DeviceOutput, 'id' | 'name' | 'timing'>[];
  totalSignals?: number;
}
export interface TimelineRow {
  id: number;
  name: string;
  period: number;
  chance: number;
  random: boolean;
  first: [number, number];
  coverage99: number | null;
  ticks: number[];
  likelihood: number[];
  expected: number[];
  error?: string;
}
export interface TimelineResult {
  horizon: number;
  rows: TimelineRow[];
  /** Expected messages per time bin, from every signal. */
  aggregate: number[];
  /**
   * Fixed schedules: the most messages due at one exact millisecond within each chart column.
   * Bins would split or merge bursts depending on how the period meets the bin width.
   */
  bursts: number[];
  /** Each column's burst split by signal, as [series, messages]; series past the eighth merge. */
  burstParts: [number, number][][];
  /** Expected messages per time bin from randomized schedules, which have no exact moments. */
  randomExpected: number[];
  omitted: number;
}
export const chanceOfAny = (chance: number, count: number) =>
  count === 0 || chance === 0 ? 0 : chance === 1 ? 1 : -Math.expm1(count * Math.log1p(-chance));

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Plans from a fresh loop start. No live state, timers, payload generation or live RNG. */
export function calculateTimeline(input: TimelineInput): TimelineResult {
  if (
    !Number.isFinite(input.horizon) ||
    input.horizon < 100 ||
    input.horizon > TIMELINE_LIMITS.horizon
  )
    throw new Error('Choose a timeline horizon between 0.1 and 60 seconds.');
  const { bins, trials } = TIMELINE_LIMITS;
  const aggregate = Array<number>(bins).fill(0);
  const randomExpected = Array<number>(bins).fill(0);
  // Expected messages at each exact due time (ms) of the fixed schedules, per series.
  const moments = new Map<number, Map<number, number>>();
  const rows = input.signals.slice(0, TIMELINE_LIMITS.signals).map((signal, index): TimelineRow => {
    const series = Math.min(index, TIMELINE_SERIES);
    const timing = signal.timing;
    const period = signalPeriod(input.period, timing);
    const chance = timing?.probability ?? 1;
    const offset = timing?.offsetMs ?? 0;
    const random = timing?.mode === 'random' && (timing.jitterPercent ?? 20) > 0;
    const errors = validateTiming(signal as DeviceOutput);
    if (!Number.isFinite(period) || period < 100 || period > 86400000)
      errors.push('Period must be between 100 and 86,400,000 ms.');
    const row: TimelineRow = {
      id: signal.id,
      name: signal.name,
      period,
      chance,
      random,
      first: [0, 0],
      coverage99: null,
      ticks: [],
      likelihood: Array<number>(bins).fill(0),
      expected: Array<number>(bins).fill(0),
    };
    if (errors.length) return { ...row, error: errors[0] };
    row.first = [
      Math.ceil(offset + signalDelay(period, timing, () => 0)),
      Math.ceil(offset + signalDelay(period, timing, () => 1)),
    ];
    const opportunities =
      chance === 0 ? Infinity : chance === 1 ? 1 : Math.ceil(Math.log(0.01) / Math.log1p(-chance));
    // This is an exact fixed-schedule time, not a quantile for random intervals.
    if (!random && Number.isFinite(opportunities)) {
      const coverage =
        timing?.mode === 'random'
          ? row.first[0] + (opportunities - 1) * Math.ceil(period)
          : Math.ceil(offset + opportunities * period);
      if (Number.isFinite(coverage)) row.coverage99 = coverage;
    }
    const rng = seededRandom(signal.id ^ 0x6d2b79f5);
    const iterations = random ? trials : 1;
    for (let trial = 0; trial < iterations; trial++) {
      const counts = new Uint16Array(bins);
      let opportunity = 1;
      let due = Math.ceil(offset + signalDelay(period, timing, rng));
      while (due <= input.horizon) {
        const bin = Math.min(bins - 1, Math.floor((due / input.horizon) * bins));
        counts[bin]++;
        if (!random) {
          row.ticks.push(due);
          let parts = moments.get(due);
          if (!parts) moments.set(due, (parts = new Map()));
          parts.set(series, (parts.get(series) ?? 0) + chance);
        }
        // Random deadlines restart at the actual (integer-ms) callback time; fixed deadlines retain phase.
        due =
          timing?.mode === 'random'
            ? due + Math.ceil(signalDelay(period, timing, rng))
            : Math.ceil(offset + ++opportunity * period);
      }
      for (let bin = 0; bin < bins; bin++) {
        row.expected[bin] += (counts[bin] * chance) / iterations;
        row.likelihood[bin] += chanceOfAny(chance, counts[bin]) / iterations;
      }
    }
    row.expected.forEach((value, bin) => {
      aggregate[bin] += value;
      if (random) randomExpected[bin] += value;
    });
    return row;
  });
  // A column shows its largest burst, split by signal.
  const bursts = Array<number>(TIMELINE_COLUMNS).fill(0);
  const burstParts: [number, number][][] = Array.from({ length: TIMELINE_COLUMNS }, () => []);
  for (const [time, parts] of moments) {
    const column = Math.min(
      TIMELINE_COLUMNS - 1,
      Math.floor((time / input.horizon) * TIMELINE_COLUMNS),
    );
    let total = 0;
    for (const value of parts.values()) total += value;
    if (total > bursts[column]) {
      bursts[column] = total;
      burstParts[column] = [...parts].sort((a, b) => a[0] - b[0]);
    }
  }
  return {
    horizon: input.horizon,
    rows,
    aggregate,
    bursts,
    burstParts,
    randomExpected,
    omitted: Math.max(0, (input.totalSignals ?? input.signals.length) - rows.length),
  };
}

/**
 * Width of the lanes' ticks and the burst bars, in chart units (640 across). It follows the
 * preview window, 3 at 10 s, thicker when zoomed in and thinner when zoomed out, and never wider
 * than 60% of the closest gap between sends, so neighbors stay apart.
 */
export function markWidth(horizon: number, rows: { ticks: number[] }[]) {
  let gap = Infinity;
  for (const row of rows)
    for (let index = 1; index < row.ticks.length; index++)
      gap = Math.min(gap, row.ticks[index] - row.ticks[index - 1]);
  const byWindow = Math.min(6, Math.max(1, 30_000 / horizon));
  return Math.max(1, Math.min(byWindow, (gap / horizon) * 640 * 0.6));
}
