import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SimulationEngine } from '../src/renderer/src/services/SimulationEngine';
import { calculateTimeline } from '../src/renderer/src/components/SimulationPanel/simulationPanel/publishTimelineModel';
import {
  loadDevices,
  validateDevice,
} from '../src/renderer/src/components/SimulationPanel/simulationPanel/model';
import type {
  DeviceOutput,
  SimulatedDevice,
} from '../src/renderer/src/components/SimulationPanel/simulationPanel/types';

const signal = (id: number, timing?: DeviceOutput['timing']): DeviceOutput => ({
  id,
  name: `s${id}`,
  dataType: 'number',
  generator: 'counter',
  config: { start: 0, step: 1, min: 0, max: 1000 },
  includeTimestamp: true,
  timing,
});
const device = (outputs = [signal(1), signal(2)]): SimulatedDevice => ({
  id: 1,
  name: 'device',
  topic: 'factory',
  publishInterval: 100,
  publishMode: 'signals',
  outputs,
  isPublishing: true,
  qos: 2,
  retain: true,
});
let engine: SimulationEngine;
const publish = vi.fn();
const sample = vi.fn();
const error = vi.fn();
const random = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  publish.mockResolvedValue(undefined);
  random.mockReturnValue(0.5);
  engine = new SimulationEngine({ publish, sample, error }, () => Date.now(), random);
});
afterEach(() => {
  engine.dispose();
  vi.useRealTimers();
  vi.resetAllMocks();
});

it('uses device raw defaults and per-signal JSON overrides without changing timing or generator state', async () => {
  const d = {
    ...device([signal(1), { ...signal(2), payloadMode: 'json' as const }]),
    payloadMode: 'raw' as const,
  };
  engine.sync([d], true);
  await vi.advanceTimersByTimeAsync(100);
  expect(publish.mock.calls[0][0]).toMatchObject({
    topic: 'factory/s1',
    payload: '0',
    qos: 2,
    retain: true,
  });
  expect(JSON.parse(publish.mock.calls[1][0].payload)).toHaveProperty('value', 0);
  expect(sample.mock.calls[0][1].payloadMode).toBe('raw');
  engine.sync([{ ...d, outputs: [{ ...d.outputs[0], payloadMode: 'json' }, d.outputs[1]] }], true);
  await vi.advanceTimersByTimeAsync(100);
  expect(JSON.parse(publish.mock.calls[2][0].payload)).toHaveProperty('value', 1);
  expect(error).not.toHaveBeenCalled();
});

it('publishes each topic on a shared clock with offsets, independent periods and shared timestamps', async () => {
  const calls: { elapsed: number; topic: string; payload: string }[] = [];
  const start = Date.now();
  publish.mockImplementation((message) => {
    calls.push({ ...message, elapsed: Date.now() - start });
  });
  engine.sync(
    [
      device([
        signal(1),
        signal(2),
        signal(3, { mode: 'sync', offsetMs: 50 }),
        { ...signal(4, { mode: 'fixed', intervalMs: 250 }), topic: 'custom/topic' },
      ]),
    ],
    true,
  );
  await vi.advanceTimersByTimeAsync(300);
  expect(calls.filter((call) => call.topic === 'factory/s1').map((call) => call.elapsed)).toEqual([
    100, 200, 300,
  ]);
  expect(calls.filter((call) => call.topic === 'factory/s3').map((call) => call.elapsed)).toEqual([
    150, 250,
  ]);
  expect(calls.filter((call) => call.topic === 'custom/topic').map((call) => call.elapsed)).toEqual(
    [250],
  );
  expect(JSON.parse(calls[0].payload).timestamp).toBe(JSON.parse(calls[1].payload).timestamp);
  expect(publish.mock.calls[0][0]).toMatchObject({ qos: 2, retain: true });
  const preview = calculateTimeline({
    period: 100,
    horizon: 300,
    signals: [
      signal(1),
      signal(3, { mode: 'sync', offsetMs: 50 }),
      signal(4, { mode: 'fixed', intervalMs: 250 }),
    ],
  });
  for (const [index, topic] of ['factory/s1', 'factory/s3', 'custom/topic'].entries())
    expect(preview.rows[index].ticks).toEqual(
      calls.filter((call) => call.topic === topic).map((call) => call.elapsed),
    );
});

it('drops busy ticks without delaying another signal or drifting the shared clock', async () => {
  let resolve!: () => void;
  publish.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  engine.sync([device()], true);
  await vi.advanceTimersByTimeAsync(350);
  expect(publish.mock.calls.filter(([message]) => message.topic === 'factory/s1')).toHaveLength(1);
  expect(publish.mock.calls.filter(([message]) => message.topic === 'factory/s2')).toHaveLength(3);
  resolve();
  await vi.advanceTimersByTimeAsync(49);
  expect(publish).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(1);
  expect(publish).toHaveBeenCalledTimes(6);
  expect(JSON.parse(publish.mock.calls[4][0].payload).value).toBe(1);
});

it('keeps timed ramps aligned through skipped probability and busy ticks and restarts the clock', async () => {
  const d = device([
    {
      ...signal(1, { mode: 'sync', probability: 0.5 }),
      generator: 'ramp',
      config: { start: 0, end: 10, delayMs: 0, durationMs: 1000 },
    },
  ]);
  random.mockReturnValue(0.9);
  engine.sync([d], true);
  await vi.advanceTimersByTimeAsync(100);
  expect(publish).not.toHaveBeenCalled();
  random.mockReturnValue(0.1);
  let finish!: () => void;
  publish.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await vi.advanceTimersByTimeAsync(300);
  expect(publish).toHaveBeenCalledTimes(1);
  expect(JSON.parse(publish.mock.calls[0][0].payload).value).toBe(2);
  finish();
  await vi.advanceTimersByTimeAsync(100);
  expect(JSON.parse(publish.mock.calls[1][0].payload).value).toBe(5);
  engine.stop(1);
  engine.sync([d], true);
  await vi.advanceTimersByTimeAsync(100);
  expect(JSON.parse(publish.mock.calls[2][0].payload).value).toBe(1);
  expect(error).not.toHaveBeenCalled();
});

it('varies random intervals within bounds and independently applies send probability', async () => {
  const start = Date.now();
  const times: number[] = [];
  random.mockReturnValue(0); // Lower bound: 200 ms - 50% = 100 ms.
  publish.mockImplementation(() => {
    times.push(Date.now() - start);
  });
  engine.sync([device([signal(1, { mode: 'random', intervalMs: 200, jitterPercent: 50 })])], true);
  await vi.advanceTimersByTimeAsync(100);
  random.mockReturnValue(0.999999); // Subsequent interval is near 300 ms.
  await vi.advanceTimersByTimeAsync(400);
  expect(times).toEqual([100, 200, 500]);
  engine.stop(1);
  publish.mockClear();
  engine.sync(
    [
      device([
        signal(1, { mode: 'sync', probability: 0 }),
        signal(2, { mode: 'sync', probability: 0.5 }),
      ]),
    ],
    true,
  );
  await vi.advanceTimersByTimeAsync(100);
  expect(publish).not.toHaveBeenCalled();
  random.mockReturnValue(0.25);
  await vi.advanceTimersByTimeAsync(100);
  expect(publish).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls[0][0].topic).toBe('factory/s2');
});

it('manual publishing ignores probability, preserves samples and resets on loop restart', async () => {
  const d = device([signal(1, { mode: 'sync', probability: 0 })]);
  engine.sync([{ ...d, isPublishing: false }], true);
  await engine.publishOnce(1);
  await engine.publishOnce(1);
  expect(publish.mock.calls.map(([message]) => JSON.parse(message.payload).value)).toEqual([0, 1]);
  const running = { ...d, outputs: [signal(1)] };
  engine.sync([running], true);
  await vi.advanceTimersByTimeAsync(100);
  expect(JSON.parse(publish.mock.calls[2][0].payload).value).toBe(0);
  engine.stop(1);
  engine.sync([running], true);
  await vi.advanceTimersByTimeAsync(100);
  expect(JSON.parse(publish.mock.calls[3][0].payload).value).toBe(0);
});

it('applies edits on the shared clock and cancels deleted signals and disconnected devices', async () => {
  const d = device();
  engine.sync([d], true);
  await vi.advanceTimersByTimeAsync(150);
  engine.sync(
    [{ ...d, publishInterval: 200, outputs: [{ ...d.outputs[0], topic: 'updated' }] }],
    true,
  );
  await vi.advanceTimersByTimeAsync(50);
  expect(publish.mock.calls[2][0].topic).toBe('updated');
  engine.sync([d], false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(publish).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

it('ignores late acknowledgements after stop and stops a device after a publish failure', async () => {
  let reject!: (error: Error) => void;
  publish.mockImplementationOnce(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  engine.sync([device([signal(1)])], true);
  await vi.advanceTimersByTimeAsync(100);
  engine.stop(1);
  reject(new Error('late failure'));
  await vi.advanceTimersByTimeAsync(0);
  expect(error).not.toHaveBeenCalled();
  expect(sample).not.toHaveBeenCalled();
  publish.mockRejectedValueOnce(new Error('Denied'));
  engine.sync([device([signal(1)])], true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(error).toHaveBeenCalledWith(1, 'Denied');
  expect(vi.getTimerCount()).toBe(0);
});

it('validates signal destinations and schedules while keeping saved combined devices compatible', () => {
  const d = device([
    {
      ...signal(1, { mode: 'fixed', intervalMs: 0, probability: 2, offsetMs: -1 }),
      topic: 'bad/+',
    },
  ]);
  expect(validateDevice(d).length).toBeGreaterThanOrEqual(4);
  const saved = loadDevices(JSON.stringify([{ ...device(), publishMode: undefined }]));
  expect(saved[0].publishMode).toBe('combined');
  expect(saved[0].isPublishing).toBe(false);
  expect(
    validateDevice(device([signal(1, { mode: 'sync', probability: 0, offsetMs: 0 })])),
  ).toEqual([]);
});

it('preserves pending samples across timing edits and ignores acknowledgements for removed signals', async () => {
  let resolve!: () => void;
  publish.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const d = device([signal(1)]);
  engine.sync([d], true);
  await vi.advanceTimersByTimeAsync(100);
  engine.sync([{ ...d, publishInterval: 200 }], true);
  resolve();
  await vi.advanceTimersByTimeAsync(100);
  expect(JSON.parse(publish.mock.calls[1][0].payload).value).toBe(1);
  engine.stop(1);
  sample.mockClear();
  publish.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  engine.sync([{ ...d, isPublishing: false }], true);
  const pending = engine.publishOnce(1);
  engine.sync([{ ...d, isPublishing: false, outputs: [signal(2)] }], true);
  resolve();
  await pending;
  expect(sample).not.toHaveBeenCalled();
});
