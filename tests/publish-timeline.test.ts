import { expect, it } from 'vitest';
import {
  calculateTimeline,
  chanceOfAny,
  TIMELINE_LIMITS,
  type TimelineInput,
} from '../src/renderer/src/components/SimulationPanel/simulationPanel/publishTimelineModel';

const base: TimelineInput = { period: 1000, horizon: 10000, signals: [{ id: 1, name: 'value' }] };
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

it('aligns sync opportunities, shifts offsets, and sums expected sends without rounding rare chances away', () => {
  const result = calculateTimeline({
    ...base,
    signals: [
      { id: 1, name: 'sync' },
      { id: 2, name: 'shift', timing: { mode: 'sync', offsetMs: 250 } },
      { id: 3, name: 'rare', timing: { mode: 'fixed', intervalMs: 250, probability: 0.01 } },
    ],
  });
  expect(result.rows[0].ticks).toEqual([
    1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000,
  ]);
  expect(result.rows[1].ticks[0]).toBe(1250);
  expect(result.rows[2].ticks).toHaveLength(40);
  expect(sum(result.rows[2].expected)).toBeCloseTo(0.4);
  expect(sum(result.aggregate)).toBeCloseTo(19.4);
  expect(result.rows[2].coverage99).toBe(459 * 250);
  expect(
    result.rows[2].likelihood.some((value) => value === 0.01 || Math.abs(value - 0.01) < 1e-12),
  ).toBe(true);
});

it('distinguishes probability of any send from expected count and handles zero/one chance', () => {
  expect(chanceOfAny(0.01, 5)).toBeCloseTo(1 - 0.99 ** 5);
  expect(chanceOfAny(1, 0)).toBe(0);
  expect(chanceOfAny(1, 5)).toBe(1);
  const result = calculateTimeline({
    period: 100,
    horizon: 60000,
    signals: [
      { id: 1, name: 'never', timing: { mode: 'sync', probability: 0 } },
      { id: 2, name: 'always' },
    ],
  });
  expect(sum(result.rows[0].expected)).toBe(0);
  expect(result.rows[0].coverage99).toBeNull();
  expect(result.rows[1].coverage99).toBe(100);
  expect(sum(result.rows[1].expected)).toBe(600);
  expect(result.rows[1].likelihood.every((value) => value === 1)).toBe(true);
});

it('models zero variation exactly and accounts for timer rounding in random mode', () => {
  const fixed = calculateTimeline(base).rows[0];
  const random = calculateTimeline({
    ...base,
    signals: [
      { id: 1, name: 'value', timing: { mode: 'random', intervalMs: 1000, jitterPercent: 0 } },
    ],
  }).rows[0];
  expect(random.ticks).toEqual(fixed.ticks);
  expect(random.likelihood).toEqual(fixed.likelihood);
  const fractional = calculateTimeline({
    ...base,
    signals: [
      {
        id: 1,
        name: 'value',
        timing: {
          mode: 'random',
          intervalMs: 100.5,
          offsetMs: 0.2,
          jitterPercent: 0,
          probability: 0.5,
        },
      },
    ],
  }).rows[0];
  expect(fractional.ticks.slice(0, 3)).toEqual([101, 202, 303]);
  expect(fractional.coverage99).toBe(707);
});

it('uses repeatable independent timing samples consistent with a uniform first delay and the 100 ms clamp', () => {
  const input: TimelineInput = {
    ...base,
    horizon: 900,
    signals: [
      {
        id: 1,
        name: 'random',
        timing: { mode: 'random', intervalMs: 1000, jitterPercent: 20, probability: 0.01 },
      },
    ],
  };
  const result = calculateTimeline(input);
  expect(result).toEqual(calculateTimeline(input));
  // P(first opportunity <= 900) = 1/4; no second opportunity fits.
  expect(sum(result.rows[0].expected)).toBeCloseTo(0.0025, 3);
  expect(result.rows[0].first).toEqual([800, 1200]);
  expect(result.rows[0].coverage99).toBeNull();
  const clamped = calculateTimeline({
    ...base,
    horizon: 100,
    signals: [
      { id: 2, name: 'clamp', timing: { mode: 'random', intervalMs: 100, jitterPercent: 100 } },
    ],
  });
  expect(sum(clamped.rows[0].expected)).toBeGreaterThan(0.44);
  expect(sum(clamped.rows[0].expected)).toBeLessThan(0.56);
  expect(clamped.rows[0].first).toEqual([100, 200]);
});

it('bounds the horizon, rows and bins, reports long waits and excludes invalid schedules', () => {
  expect(() => calculateTimeline({ ...base, horizon: Infinity })).toThrow();
  expect(() => calculateTimeline({ ...base, horizon: 60001 })).toThrow();
  const result = calculateTimeline({
    ...base,
    signals: Array.from({ length: 200 }, (_, id) => ({
      id,
      name: String(id),
      timing: { mode: 'fixed', intervalMs: 120000, offsetMs: 1000 },
    })),
  });
  expect(result.rows).toHaveLength(TIMELINE_LIMITS.signals);
  expect(result.omitted).toBe(72);
  expect(result.aggregate).toHaveLength(TIMELINE_LIMITS.bins);
  expect(result.rows[0].first).toEqual([121000, 121000]);
  expect(result.rows[0].ticks).toEqual([]);
  expect(sum(result.aggregate)).toBe(0);
  const invalid = calculateTimeline({
    ...base,
    signals: [{ id: 1, name: 'bad', timing: { mode: 'random', intervalMs: 0 } }],
  });
  expect(invalid.rows[0].error).toBeTruthy();
  expect(sum(invalid.aggregate)).toBe(0);
});
