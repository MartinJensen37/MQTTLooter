import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimulationEngine, sampleDevice } from '../src/renderer/src/services/SimulationEngine';
import {
  defaultConfig,
  presetOutputs,
  validateDevice,
  validateOutput,
} from '../src/renderer/src/components/SimulationPanel/simulationPanel/model';
import { DATA_TYPE_CONFIGS } from '../src/renderer/src/components/SimulationPanel/simulationPanel/constants';
import { generateValue } from '../src/renderer/src/utils/valueGenerators';
import type { SimulatedDevice } from '../src/renderer/src/components/SimulationPanel/simulationPanel/types';

const device = (): SimulatedDevice => ({
  id: 1,
  name: 'Machine',
  topic: 'machine',
  publishInterval: 100,
  isPublishing: true,
  payloadFormat: 'named',
  qos: 1,
  retain: true,
  outputs: [
    {
      id: 1,
      name: 'count',
      dataType: 'number',
      generator: 'counter',
      config: { start: 0, step: 1, min: 0, max: 10 },
      includeTimestamp: false,
      decimalPrecision: 0,
    },
  ],
});

describe('signal generation', () => {
  it('generates every offered type with valid defaults', () => {
    for (const [dataType, settings] of Object.entries(DATA_TYPE_CONFIGS)) {
      for (const generator of settings.generators) {
        const output = {
          id: 1,
          name: 'signal',
          dataType,
          generator,
          config: defaultConfig(dataType, generator),
        };
        expect(validateOutput(output)).toEqual([]);
        expect(typeof generateValue(output)).toBe(dataType === 'enum' ? 'string' : dataType);
      }
    }
  });

  it('uses elapsed time for wave phase, duty cycles and sequences', () => {
    const wave = (generator: string, elapsedMs: number, extra = {}) =>
      generateValue(
        { dataType: 'number', generator, config: { min: 0, max: 100, frequency: 1, ...extra } },
        { elapsedMs },
      );
    expect(wave('sine', 250)).toBe(100);
    expect(wave('triangle', 250)).toBe(50);
    expect(wave('triangle', 500)).toBe(100);
    expect(wave('sawtooth', 750)).toBe(75);
    expect(wave('square', 250, { dutyCycle: 0.25 })).toBe(0);
    expect(wave('square', 0, { dutyCycle: 0 })).toBe(0);
    expect(wave('square', 999, { dutyCycle: 1 })).toBe(100);
    expect(wave('sine', 999, { frequency: 0, phase: 0.25 })).toBe(100);
    expect(
      generateValue(
        {
          dataType: 'enum',
          generator: 'pattern',
          config: { sequence: ['idle', 'running'], intervalMs: 500 },
        },
        { elapsedMs: 500 },
      ),
    ).toBe('running');
    expect(
      generateValue(
        {
          dataType: 'boolean',
          generator: 'pattern',
          config: { sequence: [false, true], intervalMs: 500 },
        },
        { elapsedMs: 1000 },
      ),
    ).toBe(false);
  });

  it('advances counters, bounds random walks and resets edited signals', () => {
    const d = device();
    const first = sampleDevice(d);
    const second = sampleDevice(d, 100, first.next);
    expect(second.values[1]).toBe(1);
    d.outputs[0].config = { ...d.outputs[0].config, start: 5 };
    expect(sampleDevice(d, 200, second.next).values[1]).toBe(5);
    const walk = {
      dataType: 'number',
      generator: 'walk',
      config: { start: 5, step: 3, min: 0, max: 10 },
    };
    expect(generateValue(walk)).toBe(5);
    expect(generateValue(walk, { previousValue: 9, random: () => 1 })).toBe(10);
    expect(generateValue(walk, { previousValue: 1, random: () => 0 })).toBe(0);
    d.outputs[0] = {
      ...d.outputs[0],
      generator: 'walk',
      config: { start: 0, step: 0.1, min: 0, max: 10 },
    };
    let walkSample = sampleDevice(d);
    for (let i = 0; i < 10; i++) walkSample = sampleDevice(d, i * 100, walkSample.next, () => 1);
    expect(walkSample.values[1]).toBe(1);
  });

  it('validates names, topics, bounds, weights, periods and preserves legacy payloads', () => {
    const d = device();
    expect(validateDevice({ ...d, topic: 'a/+', publishInterval: 0 }).length).toBe(2);
    expect(validateDevice({ ...d, outputs: [d.outputs[0], { ...d.outputs[0], id: 2 }] })).toContain(
      'count: Signal names must be unique within a device.',
    );
    expect(
      validateOutput({ ...d.outputs[0], config: { min: 20, max: 10 } }).length,
    ).toBeGreaterThan(0);
    expect(
      validateOutput({
        ...d.outputs[0],
        dataType: 'enum',
        generator: 'weighted',
        config: { weightedValues: [{ value: 'off', weight: 0 }] },
      }).length,
    ).toBeGreaterThan(0);
    expect(sampleDevice({ ...d, payloadFormat: 'auto' }).payload).toBe('{"value":0}');
    expect(sampleDevice({ ...d, outputs: [{ ...d.outputs[0], name: '__proto__' }] }).payload).toBe(
      '{"__proto__":{"value":0}}',
    );
    for (const preset of ['sensor', 'environment', 'machine', 'blank'])
      expect(validateDevice({ ...d, outputs: presetOutputs(preset) })).toEqual([]);
  });
});

describe('simulation scheduling', () => {
  let engine: SimulationEngine;
  const publish = vi.fn();
  const sample = vi.fn();
  const error = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    publish.mockResolvedValue(undefined);
    engine = new SimulationEngine({ publish, sample, error }, () => Date.now());
  });
  afterEach(() => {
    engine.dispose();
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('waits for slow publishes without overlap or a catch-up burst', async () => {
    let resolve: () => void;
    publish.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    engine.sync([device()], true);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(2000);
    await engine.publishOnce(1);
    expect(publish).toHaveBeenCalledTimes(1);
    resolve!();
    await vi.advanceTimersByTimeAsync(0);
    expect(sample).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(publish).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith({
      topic: 'machine',
      payload: '{"count":{"value":1}}',
      qos: 1,
      retain: true,
    });
  });

  it('uses current settings and reschedules only the edited device', async () => {
    const a = device();
    const b = { ...device(), id: 2, topic: 'other', publishInterval: 150 };
    engine.sync([a, b], true);
    await vi.advanceTimersByTimeAsync(50);
    engine.sync([{ ...a, topic: 'edited', publishInterval: 200 }, b], true);
    await vi.advanceTimersByTimeAsync(100);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0].topic).toBe('other');
    await vi.advanceTimersByTimeAsync(100);
    expect(publish.mock.calls[1][0].topic).toBe('edited');
  });

  it('does not report stale failures after stop, disconnect or disposal', async () => {
    let reject: (error: Error) => void;
    publish.mockImplementationOnce(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        }),
    );
    engine.sync([device()], true);
    await vi.advanceTimersByTimeAsync(100);
    engine.sync([device()], false);
    reject!(new Error('Disconnected'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(sample).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops on a real publish failure and refuses invalid configurations', async () => {
    publish.mockRejectedValueOnce(new Error('Denied'));
    engine.sync([device()], true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(error).toHaveBeenCalledWith(1, 'Denied');
    expect(publish).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    engine.sync([{ ...device(), publishInterval: NaN }], true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resets the sequence when restarting and releases removed device timers', async () => {
    engine.sync([device()], true);
    await vi.advanceTimersByTimeAsync(200);
    engine.stop(1);
    engine.sync([device()], true);
    await vi.advanceTimersByTimeAsync(100);
    expect(publish.mock.calls.map(([message]) => JSON.parse(message.payload).count.value)).toEqual([
      0, 1, 0,
    ]);
    engine.sync([], true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(publish).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Sparkplug B devices', () => {
  const publish = vi.fn();
  // The real encoder runs in main; JSON keeps the payloads readable here.
  const encodeSparkplug = vi.fn(async (payload: object) => JSON.stringify(payload));
  let engine: SimulationEngine;
  beforeEach(() => {
    vi.useFakeTimers();
    publish.mockResolvedValue(undefined);
    engine = new SimulationEngine(
      { publish, sample: vi.fn(), error: vi.fn(), encodeSparkplug },
      () => Date.now(),
    );
  });
  afterEach(() => {
    engine.dispose();
    vi.useRealTimers();
    vi.resetAllMocks();
  });
  const sent = () =>
    publish.mock.calls.map(([message]) => ({
      topic: message.topic,
      encoding: message.encoding,
      ...JSON.parse(message.payload),
    }));

  it('publishes births, aliased data and deaths with sequence numbers', async () => {
    const pump = {
      ...device(),
      outputs: [
        ...device().outputs,
        {
          id: 2,
          name: 'running',
          dataType: 'boolean',
          generator: 'static',
          config: { value: true },
        },
      ],
      sparkplug: { group: 'Plant', edgeNode: 'Edge1', device: 'Pump' },
    };
    expect(validateDevice(pump)).toEqual([]);
    engine.sync([pump], true);
    await vi.advanceTimersByTimeAsync(200);
    engine.sync([{ ...pump, isPublishing: false }], true);
    await vi.advanceTimersByTimeAsync(0);
    const messages = sent();
    expect(messages.map(({ topic }) => topic)).toEqual([
      'spBv1.0/Plant/NBIRTH/Edge1',
      'spBv1.0/Plant/DBIRTH/Edge1/Pump',
      'spBv1.0/Plant/DDATA/Edge1/Pump',
      'spBv1.0/Plant/DDEATH/Edge1/Pump',
      'spBv1.0/Plant/NDEATH/Edge1',
    ]);
    expect(messages.every(({ encoding }) => encoding === 'base64')).toBe(true);
    expect(messages.map(({ seq }) => seq)).toEqual([0, 1, 2, 3, undefined]);
    expect(messages[0].metrics.map(({ name }: { name: string }) => name)).toEqual([
      'bdSeq',
      'Node Control/Rebirth',
    ]);
    expect(messages[1].metrics).toEqual([
      { name: 'count', alias: 1, type: 'Double', value: 0 },
      { name: 'running', alias: 2, type: 'Boolean', value: true },
    ]);
    expect(messages[2].metrics[0]).toEqual({ name: '', alias: 1, type: 'Double', value: 1 });
    expect(messages[4].metrics).toEqual([{ name: 'bdSeq', type: 'UInt64', value: 0 }]);
    // The next session counts bdSeq up and sends its births again.
    engine.sync([pump], true);
    await vi.advanceTimersByTimeAsync(100);
    expect(sent()[5]).toMatchObject({ topic: 'spBv1.0/Plant/NBIRTH/Edge1', seq: 0 });
    expect(sent()[5].metrics[0].value).toBe(1);
  });

  it('puts node signals in the node birth and refuses invalid IDs', async () => {
    const node = { ...device(), sparkplug: { group: 'Plant', edgeNode: 'Edge1' } };
    engine.sync([node], true);
    await vi.advanceTimersByTimeAsync(200);
    expect(sent().map(({ topic }) => topic)).toEqual([
      'spBv1.0/Plant/NBIRTH/Edge1',
      'spBv1.0/Plant/NDATA/Edge1',
    ]);
    expect(sent()[0].metrics).toHaveLength(3);
    expect(validateDevice({ ...node, sparkplug: { group: 'a/b', edgeNode: 'Edge1' } })).toContain(
      'Sparkplug group, edge node and device IDs need text without /, + or #.',
    );
    expect(validateDevice({ ...node, publishMode: 'signals' })).toContain(
      'Sparkplug devices publish all signals in one message.',
    );
  });
});
