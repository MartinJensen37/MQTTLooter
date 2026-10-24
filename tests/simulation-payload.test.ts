import { expect, it } from 'vitest';
import { sampleDevice } from '../src/renderer/src/services/SimulationSample';
import {
  loadDevices,
  validateDevice,
  validTopic,
} from '../src/renderer/src/components/SimulationPanel/simulationPanel/model';
import type { SimulatedDevice } from '../src/renderer/src/components/SimulationPanel/simulationPanel/types';

const device = (value: string | number | boolean): SimulatedDevice => ({
  id: 1,
  name: 'raw',
  topic: '/raw//value',
  isPublishing: false,
  publishInterval: 100,
  payloadMode: 'raw',
  payloadFormat: 'named',
  outputs: [
    {
      id: 1,
      name: 'signal',
      dataType: typeof value,
      generator: 'static',
      config: { value },
      includeTimestamp: true,
      unit: 'unit',
      decimalPrecision: 2,
    },
  ],
});

it('encodes scalar values without metadata, quotes, whitespace changes or trailing newlines', () => {
  for (const value of [
    '',
    '  line\r\nnext\t\0🌡️\uFEFF ',
    '{"value":42}',
    '"quoted"',
    false,
    true,
    0,
    -12.25,
  ]) {
    const sample = sampleDevice(device(value));
    expect(sample.payload).toBe(String(value));
    expect(new TextEncoder().encode(sample.payload)).toEqual(
      new TextEncoder().encode(String(value)),
    );
    expect(sample.payloadMode).toBe('raw');
  }
  expect(sampleDevice(device(1.234)).payload).toBe('1.23');
  const enumeration = device('offline');
  enumeration.outputs[0].dataType = 'enum';
  expect(sampleDevice(enumeration).payload).toBe('offline');
  expect(() => sampleDevice(device('\uD800'))).toThrow('surrogate');
});

it('rejects ambiguous combined output and invalid modes, without changing legacy JSON bytes', () => {
  const base = device(0);
  const multiple = {
    ...base,
    outputs: [base.outputs[0], { ...base.outputs[0], id: 2, name: 'second' }],
  };
  expect(validateDevice(multiple).join(' ')).toContain('exactly one signal');
  expect(() => sampleDevice(multiple)).toThrow('exactly one signal');
  expect(validateDevice({ ...multiple, publishMode: 'signals' })).toEqual([]);
  expect(validateDevice({ ...base, payloadMode: 'bad' as any })).toContain(
    'Invalid device payload mode.',
  );
  const legacy = { ...base, payloadMode: undefined, payloadFormat: undefined };
  expect(sampleDevice(legacy, 0, undefined, undefined, 'fixed').payload).toBe(
    '{"value":0,"unit":"unit","timestamp":"fixed"}',
  );
  expect(
    sampleDevice({ ...legacy, payloadFormat: 'named' }, 0, undefined, undefined, 'fixed').payload,
  ).toBe('{"signal":{"value":0,"unit":"unit","timestamp":"fixed"}}');
  expect(validTopic('\uD800')).toBe(false);
});

it('migrates unversioned devices without starting them or changing JSON envelopes and rejects future formats', () => {
  const legacy = {
    ...device(false),
    payloadMode: undefined,
    payloadFormat: undefined,
    isPublishing: true,
  };
  const loaded = loadDevices(JSON.stringify([legacy]));
  expect(loaded[0]).toMatchObject({
    schemaVersion: 1,
    payloadMode: 'json',
    payloadFormat: 'auto',
    publishMode: 'combined',
    isPublishing: false,
  });
  expect(sampleDevice(loaded[0], 0, undefined, undefined, 'fixed').payload).toBe(
    sampleDevice(legacy, 0, undefined, undefined, 'fixed').payload,
  );
  const mixed = {
    ...device('x'),
    schemaVersion: 1,
    publishMode: 'signals',
    outputs: [{ ...device('x').outputs[0], payloadMode: 'json' }],
  };
  expect(loadDevices(JSON.stringify([mixed]))[0]).toMatchObject({
    payloadMode: 'raw',
    outputs: [{ payloadMode: 'json' }],
  });
  expect(() => loadDevices(JSON.stringify([{ ...legacy, schemaVersion: 2 }]))).toThrow('version');
  expect(() => loadDevices(JSON.stringify([{ ...legacy, payloadMode: 'unknown' }]))).toThrow(
    'payload mode',
  );
});
