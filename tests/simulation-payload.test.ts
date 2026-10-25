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

const templated = (payloadMode: 'json' | 'raw', payloadTemplate: string): SimulatedDevice => ({
  ...device(0),
  name: 'Boiler 1',
  payloadMode,
  payloadFormat: 'template',
  payloadTemplate,
  outputs: [
    { ...device(21.456).outputs[0], id: 1, name: 'Temp C' },
    { ...device(true).outputs[0], id: 2, name: 'running' },
    { ...device('ok').outputs[0], id: 3, name: 'state' },
  ],
});

it('composes several signals, timestamps and UUIDs into a nested JSON template', () => {
  const template = JSON.stringify({
    id: '{{uuid}}',
    at: '{{timestamp}}',
    iso: '{{isoTimestamp}}',
    data: { temp: '{{Temp C}}', on: '{{running}}', label: 'state={{state}}' },
    list: ['{{state}}', 7],
  });
  const at = '2026-10-25T10:00:00.000Z';
  const first = sampleDevice(templated('json', template), 0, new Map(), Math.random, at);
  const payload = JSON.parse(first.payload);
  expect(payload).toMatchObject({
    at: Date.parse(at),
    iso: at,
    data: { temp: 21.46, on: true, label: 'state=ok' },
    list: ['ok', 7],
  });
  expect(payload.id).toMatch(/^[0-9a-f-]{36}$/);
  // One UUID per message, fresh for the next one.
  const second = JSON.parse(sampleDevice(templated('json', template)).payload);
  expect(second.id).not.toBe(payload.id);
  expect(first.payloadMode).toBe('json');
});

it('uses raw text templates for several signals and validates templates before publishing', () => {
  const raw = templated('raw', 'temp={{Temp C}};on={{running}};{{state}}');
  expect(validateDevice(raw)).toEqual([]);
  expect(sampleDevice(raw).payload).toBe('temp=21.46;on=true;ok');
  expect(validateDevice(templated('json', '{"t": {{Temp C}}}')).join()).toContain('valid JSON');
  expect(validateDevice(templated('json', '{"t": "{{missing}}"}')).join()).toContain(
    'Unknown template expression: missing',
  );
  expect(validateDevice(templated('raw', '  ')).join()).toContain('Enter a payload template');
  // Per-signal publishing ignores the device template.
  expect(validateDevice({ ...templated('json', '{'), publishMode: 'signals' })).toEqual([]);
  expect(loadDevices(JSON.stringify([templated('raw', 'x={{state}}')]))[0]).toMatchObject({
    payloadFormat: 'template',
    payloadTemplate: 'x={{state}}',
  });
});
