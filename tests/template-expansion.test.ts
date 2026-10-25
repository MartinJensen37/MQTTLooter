// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { expandTemplate, templateDefaults } from '../src/shared/template-expansion';
import MessageTemplateService from '../src/renderer/src/services/MessageTemplateService';

beforeEach(() => localStorage.clear());

it('replaces unchanged old examples with the two schemas, keeping edited and custom entries', () => {
  const legacy = (id: string, topic: string, payload: object) => ({
    id,
    topic,
    payload: JSON.stringify(payload, null, 2),
  });
  localStorage.setItem(
    'mqtt-message-templates',
    JSON.stringify({
      'temperature-sensor': legacy('temperature-sensor', 'sensors/temperature/{{sensorId}}', {
        temperature: '{{randomFloat(15, 35, 1)}}',
        humidity: '{{randomFloat(30, 80, 1)}}',
        timestamp: '{{timestamp}}',
        sensorId: '{{sensorId}}',
      }),
      // Edited by the user, so it stays.
      'gps-location': {
        id: 'gps-location',
        topic: 'tracking/{{vehicleId}}/location',
        payload: '{"custom":true}',
      },
      mine: { id: 'mine', name: 'Mine', topic: 'a/b', payload: '{}' },
    }),
  );
  const service = new MessageTemplateService();
  expect(service.getAllTemplates().map((item) => item.id)).toEqual([
    'gps-location',
    'mine',
    'sensor-reading',
    'device-status',
  ]);
  expect(localStorage.getItem('mqtt-message-templates-version')).toBe('2');
  // A deleted example is not added back on the next start.
  service.deleteTemplate('device-status');
  expect(new MessageTemplateService().getTemplate('device-status')).toBeUndefined();
});

it('expands all shipped templates into payloads that satisfy their existing schemas', () => {
  const service = new MessageTemplateService();
  for (const template of service.getAllTemplates()) {
    const result = service.processTemplate(template);
    expect(result.topic).not.toContain('{{');
    expect(service.validatePayload(template.id, result.payload)).toEqual({
      valid: true,
      errors: [],
    });
  }
});

it('preserves number, boolean, null, object and array substitutions at every JSON level', () => {
  const template = {
    topic: 'sensor/{{id}}',
    payload: JSON.stringify({
      n: '{{n}}',
      list: ['{{flag}}', '{{nil}}', { nested: '{{obj}}' }],
      text: 'value={{n}}',
      '{{key}}': '{{array}}',
    }),
    variables: {
      id: { type: 'text' as const, default: 'one' },
      n: { type: 'number' as const, default: 2.5 },
      flag: { type: 'boolean' as const, default: false },
      nil: { type: 'json' as const, default: null },
      obj: { type: 'json' as const, default: { count: 2 } },
      array: { type: 'json' as const, default: [1, true] },
      key: { default: 'dynamic' },
    },
  };
  const result = expandTemplate(template, templateDefaults(template.variables));
  expect(result.topic).toBe('sensor/one');
  expect(JSON.parse(result.payload)).toEqual({
    n: 2.5,
    list: [false, null, { nested: { count: 2 } }],
    text: 'value=2.5',
    dynamic: [1, true],
  });
  expect(expandTemplate({ topic: '', payload: '"{{n}}"' }, { n: 5 }).payload).toBe('5');
});

it('escapes strings once, matches variable names literally and never executes inserted tokens', () => {
  const text = '"line\\\n$& {{uuid}} \u2603';
  const result = expandTemplate(
    { topic: '{{a.b}}', payload: '{"x":"{{a.b}}","y":"prefix {{a.b}}"}' },
    { 'a.b': text },
  );
  expect(result.topic).toBe(text);
  expect(JSON.parse(result.payload)).toEqual({ x: text, y: `prefix ${text}` });
  const proto = expandTemplate(
    { topic: '', payload: '{"__proto__":"{{value}}"}' },
    { value: { polluted: true } },
  );
  expect(JSON.parse(proto.payload).__proto__).toEqual({ polluted: true });
  expect(({} as any).polluted).toBeUndefined();
});

it('leaves numeric lexemes, formatting and literal strings intact', () => {
  const source =
    '{\n "large":9007199254740993, "decimal":1.2300, "text":"\\u0041", "value":"{{n}}"\n}';
  expect(expandTemplate({ topic: '', payload: source }, { n: 7 }).payload).toBe(
    source.replace('"{{n}}"', '7'),
  );
  const raw = '  {{value}}\n{{number}}  ';
  expect(expandTemplate({ topic: '', payload: raw }, { value: 'hello', number: 3 }).payload).toBe(
    '  hello\n3  ',
  );
  expect(expandTemplate({ topic: '', payload: '' }).payload).toBe('');
});

it('shares a timestamp and UUID within an application, regenerating only on the next call', () => {
  let count = 0;
  const template = {
    topic: '{{uuid}}/{{timestamp}}',
    payload: '["{{uuid}}", "{{timestamp}}", "{{uuid}}"]',
  };
  const context = { now: () => 123, uuid: () => `id-${++count}` };
  expect(expandTemplate(template, {}, context)).toEqual({
    topic: 'id-1/123',
    payload: '["id-1", 123, "id-1"]',
  });
  expect(expandTemplate(template, {}, context).topic).toBe('id-2/123');
});

it('handles negative bounds and quoted/comma choices without evaluation', () => {
  expect(
    expandTemplate(
      { topic: '', payload: "{{randomChoice('a,b', 'it\\'s')}}" },
      {},
      { random: () => 0.9 },
    ).payload,
  ).toBe("it's");
  const payload = JSON.stringify([
    '{{randomInt(-10, -2)}}',
    '{{randomFloat(-2, 2, 1)}}',
    '{{randomChoice("a,b", "a\\"b")}}',
  ]);
  expect(
    JSON.parse(expandTemplate({ topic: '', payload }, {}, { random: () => 0.5 }).payload),
  ).toEqual([-6, 0, 'a"b']);
  for (const expression of [
    'randomInt(2, 1)',
    'randomInt(0.1, 2)',
    'randomFloat(0, 1, 100)',
    'randomChoice()',
    'randomChoice(process.exit())',
    'missing',
    'constructor',
  ]) {
    expect(() =>
      expandTemplate({ topic: '', payload: JSON.stringify(`{{${expression}}}`) }),
    ).toThrow();
  }
});

it('rejects invalid typed values and preserves JSON string defaults', () => {
  for (const [type, value] of [
    ['number', ''],
    ['number', 'Infinity'],
    ['integer', '2.5'],
    ['boolean', 'yes'],
    ['json', '{bad'],
  ]) {
    expect(() =>
      expandTemplate(
        { topic: '', payload: '"{{v}}"', variables: { v: { type: type as any } } },
        { v: value },
      ),
    ).toThrow();
  }
  const variables = { v: { type: 'json' as const, default: 'word' } };
  expect(expandTemplate({ topic: '', payload: '"{{v}}"', variables }).payload).toBe('"word"');
  expect(
    expandTemplate({ topic: '', payload: '"{{v}}"', variables }, templateDefaults(variables))
      .payload,
  ).toBe('"word"');
  expect(() => expandTemplate({ topic: '', payload: '"{{v}}"' }, { v: Infinity })).toThrow();
  expect(() => expandTemplate({ topic: '', payload: '{"n": {{timestamp}}}', schema: {} })).toThrow(
    'valid JSON before expansion',
  );
});

it('bounds expansion size, variable counts, nesting and placeholder work', () => {
  expect(() => templateDefaults({ v: { default: 'x'.repeat(1048577) } })).toThrow('too large');
  expect(() =>
    expandTemplate(
      { topic: '', payload: '"{{v}}"', variables: { v: { type: 'json' } } },
      { v: ' '.repeat(1048577) },
    ),
  ).toThrow('too large');
  expect(() => expandTemplate({ topic: '', payload: '{{v}}'.repeat(2001) }, { v: '' })).toThrow(
    'expressions',
  );
  expect(() =>
    expandTemplate({ topic: '', payload: '{{v}}'.repeat(100) }, { v: 'x'.repeat(20000) }),
  ).toThrow('1 MiB');
  expect(() =>
    templateDefaults(Object.fromEntries(Array.from({ length: 129 }, (_, i) => [String(i), {}]))),
  ).toThrow('Too many');
  let value: unknown = 1;
  for (let i = 0; i < 65; i++) value = [value];
  expect(() => expandTemplate({ topic: '', payload: '"{{v}}"' }, { v: value })).toThrow('complex');
});

it('imports a standalone schema as a template whose applications pass validation', async () => {
  const service = new MessageTemplateService();
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Pump Reading',
    type: 'object',
    required: ['pump', 'flow', 'mode', 'at'],
    properties: {
      pump: { type: 'string', format: 'uuid' },
      flow: { type: 'number', minimum: 0, maximum: 12.5 },
      mode: { enum: ['auto', 'manual'] },
      at: { type: 'string', format: 'date-time' },
    },
  };
  const file = { text: async () => JSON.stringify(schema) };
  await service.importTemplates(file);
  const template = service.getAllTemplates().find((item) => item.name === 'Pump Reading')!;
  expect(template.category).toBe('Imported');
  for (let run = 0; run < 10; run++) {
    const { payload } = service.processTemplate(template);
    expect(service.validatePayload(template.id, payload)).toEqual({ valid: true, errors: [] });
  }
});
