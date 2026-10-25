import { expect, it } from 'vitest';
import { generateValue } from '../src/renderer/src/utils/valueGenerators';
import {
  defaultConfig,
  loadDevices,
  validateOutput,
} from '../src/renderer/src/components/SimulationPanel/simulationPanel/model';
import { sampleSignalPreview } from '../src/renderer/src/components/SimulationPanel/simulationPanel/signalPreview';
import { sampleDevice } from '../src/renderer/src/services/SimulationSample';
import type {
  DeviceOutput,
  SimulatedDevice,
} from '../src/renderer/src/components/SimulationPanel/simulationPanel/types';

const signal = (generator: string, config = {}): DeviceOutput => ({
  id: 1,
  name: 'value',
  dataType: 'number',
  generator,
  config: { ...defaultConfig('number', generator), ...config },
  decimalPrecision: 10,
  includeTimestamp: false,
});
const valueAt = (output: DeviceOutput, elapsedMs: number) => generateValue(output, { elapsedMs });

it('ramps by elapsed time in either direction, holds endpoints and ignores sample count', () => {
  for (const [start, end] of [
    [-10, 30],
    [30, -10],
    [5, 5],
  ]) {
    const output = signal('ramp', { start, end, delayMs: 1000, durationMs: 2000 });
    expect([0, 999, 1000].map((t) => valueAt(output, t))).toEqual([start, start, start]);
    expect(valueAt(output, 2000)).toBe((start + end) / 2);
    expect([3000, 100000].map((t) => valueAt(output, t))).toEqual([end, end]);
    expect(generateValue(output, { elapsedMs: 2000, sampleIndex: 999 })).toBe((start + end) / 2);
  }
});

it('steps at the exact delay, including an immediate falling step', () => {
  const output = signal('step', { start: 10, end: -20, delayMs: 1234 });
  expect(valueAt(output, 1233.999)).toBe(10);
  expect(valueAt(output, 1234)).toBe(-20);
  expect(valueAt(output, 100000)).toBe(-20);
  expect(valueAt(signal('step', { delayMs: 0 }), 0)).toBe(100);
});

it('follows first-order response timing for rising, falling and constant values', () => {
  for (const [start, end] of [
    [0, 100],
    [100, -100],
    [10, 10],
  ]) {
    const output = signal('response', { start, end, delayMs: 500, timeConstantMs: 2000 });
    expect(valueAt(output, 499)).toBe(start);
    expect(valueAt(output, 500)).toBe(start);
    expect(valueAt(output, 2500)).toBeCloseTo(end + (start - end) / Math.E, 8);
    expect(valueAt(output, 10500)).toBeCloseTo(end + (start - end) * Math.exp(-5), 8);
    expect(valueAt(output, 100000)).toBeCloseTo(end, 8);
  }
});

it('keeps extreme finite endpoints finite without subtracting them', () => {
  for (const generator of ['ramp', 'step', 'response']) {
    const output = signal(generator, {
      start: -Number.MAX_VALUE,
      end: Number.MAX_VALUE,
      delayMs: 0,
    });
    expect(validateOutput(output)).toEqual([]);
    for (const t of [0, 1, 2500, 100000]) expect(Number.isFinite(valueAt(output, t))).toBe(true);
  }
});

it('validates transition values and durations without imposing ascending bounds', () => {
  for (const generator of ['ramp', 'step', 'response']) {
    expect(validateOutput(signal(generator, { start: 10, end: -10 }))).toEqual([]);
    for (const config of [
      { start: NaN },
      { end: Infinity },
      { delayMs: -1 },
      { delayMs: 86400001 },
    ])
      expect(validateOutput(signal(generator, config)).length).toBeGreaterThan(0);
  }
  for (const [generator, key] of [
    ['ramp', 'durationMs'],
    ['response', 'timeConstantMs'],
  ]) {
    for (const value of [0, -1, NaN, Infinity, 86400001])
      expect(validateOutput(signal(generator, { [key]: value })).length).toBeGreaterThan(0);
    expect(validateOutput(signal(generator, { [key]: 1 }))).toEqual([]);
  }
});

it('previews exact transitions and small response constants after a long delay with bounded samples', () => {
  const step = sampleSignalPreview(signal('step', { delayMs: 1234 }))!;
  expect(step.points.find((p) => p.x === 1234)?.y).toBe(100);
  expect(step.points.filter((p) => p.x < 1234).every((p) => p.y === 0)).toBe(true);
  const ramp = sampleSignalPreview(signal('ramp', { start: 20, end: -10, durationMs: 1 }), true)!;
  expect(ramp.duration).toBe(1.2);
  expect(ramp.points.find((p) => p.x === 1)?.y).toBe(-10);
  expect([ramp.min, ramp.max]).toEqual([-10, 20]);
  const output = signal('response', { delayMs: 86400000, timeConstantMs: 1 });
  const response = sampleSignalPreview(output)!;
  expect(response.points.some((p) => p.x > 86400000 && p.y > 0 && p.y < 99)).toBe(true);
  expect(response.points.length).toBeLessThan(200);
  expect(sampleSignalPreview(output)).toEqual(response);
});

it('round-trips saved transition devices and preserves JSON/raw output and combined time origin', () => {
  const device: SimulatedDevice = {
    id: 1,
    name: 'Ramp',
    topic: 'ramp',
    publishInterval: 100,
    isPublishing: false,
    outputs: [signal('ramp', { start: 0, end: 10, durationMs: 1000 })],
  };
  const [loaded] = loadDevices(JSON.stringify([device]));
  const first = sampleDevice(loaded, 100);
  expect(first.payload).toBe('{"value":0}');
  const next = sampleDevice(loaded, 600, first.next);
  expect(next.payload).toBe('{"value":5}');
  expect(sampleDevice({ ...loaded, payloadMode: 'raw' }, 1100, next.next).payload).toBe('10');
  expect(sampleDevice(loaded, 100).payload).toBe('{"value":0}');
});
