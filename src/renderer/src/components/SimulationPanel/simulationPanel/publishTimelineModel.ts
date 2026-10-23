import type { DeviceOutput } from './types';
import { validateTiming } from './model';
import { signalDelay, signalPeriod } from '../../../services/signalTiming';

export const TIMELINE_LIMITS = { signals: 128, bins: 128, trials: 512, horizon: 60_000 };
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
  aggregate: number[];
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
  const rows = input.signals.slice(0, TIMELINE_LIMITS.signals).map((signal): TimelineRow => {
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
        if (!random) row.ticks.push(due);
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
    });
    return row;
  });
  return {
    horizon: input.horizon,
    rows,
    aggregate,
    omitted: Math.max(0, (input.totalSignals ?? input.signals.length) - rows.length),
  };
}
