import { expect, it } from 'vitest';
import { validateJson } from '../src/shared/json-schema';
import { templateFromSchema } from '../src/shared/schema-template';
import { expandTemplate } from '../src/shared/template-expansion';

const schemas: Record<string, unknown> = {
  telemetry: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    required: ['id', 'at', 'readings', 'state', 'ok', 'meta'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      at: { type: 'string', format: 'date-time' },
      state: { enum: ['idle', 'running', 'cooling'] },
      ok: { type: 'boolean' },
      readings: { type: 'array', minItems: 2, items: { $ref: '#/$defs/reading' } },
      meta: {
        type: 'object',
        required: ['firmware', 'site', 'contact', 'version'],
        properties: {
          firmware: { type: 'string', minLength: 10, maxLength: 12 },
          site: { const: 'plant-7' },
          contact: { type: 'string', format: 'email' },
          version: { type: 'integer', default: 3 },
          note: { type: ['string', 'null'] },
        },
      },
    },
    additionalProperties: false,
    $defs: {
      reading: {
        type: 'object',
        required: ['value', 'count', 'ratio'],
        properties: {
          value: { type: 'number', minimum: -50, maximum: 100 },
          count: { type: 'integer', exclusiveMinimum: 0, exclusiveMaximum: 10 },
          ratio: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
          step: { type: 'number', multipleOf: 0.5, minimum: 1.2 },
        },
      },
    },
  },
  combinators: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    definitions: {
      base: { type: 'object', required: ['kind'], properties: { kind: { type: 'string' } } },
    },
    allOf: [
      { $ref: '#/definitions/base' },
      { properties: { level: { type: 'integer', minimum: 1, maximum: 5 } }, required: ['level'] },
    ],
  },
  choice: {
    type: 'object',
    properties: {
      target: { oneOf: [{ type: 'integer', minimum: 7, maximum: 7 }, { type: 'string' }] },
    },
    required: ['target'],
  },
  tuple: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number', maximum: -1 }] },
};

it('builds templates whose expansions satisfy their schemas', () => {
  for (const [name, schema] of Object.entries(schemas)) {
    const template = templateFromSchema(schema);
    expect(() => JSON.parse(template), name).not.toThrow();
    for (let run = 0; run < 25; run++) {
      const { payload } = expandTemplate({ topic: '', payload: template, schema });
      expect(validateJson(JSON.parse(payload), schema), `${name}: ${payload}`).toEqual({
        valid: true,
        errors: [],
      });
    }
  }
});

it('generates fresh values per expansion and terminates on recursive references', () => {
  const template = templateFromSchema(schemas.telemetry);
  const first = JSON.parse(expandTemplate({ topic: '', payload: template }).payload);
  const second = JSON.parse(expandTemplate({ topic: '', payload: template }).payload);
  expect(first.id).not.toBe(second.id);
  expect(new Date(first.at).toISOString()).toBe(first.at);
  const recursive = {
    $defs: { node: { type: 'object', properties: { child: { $ref: '#/$defs/node' } } } },
    $ref: '#/$defs/node',
  };
  expect(JSON.parse(templateFromSchema(recursive))).toEqual({ child: null });
  expect(templateFromSchema({ $ref: 'https://example.com/remote.json' })).toBe('null');
  // Enum values that look like placeholders stay literal rather than becoming expressions.
  expect(JSON.parse(templateFromSchema({ enum: ['{{uuid}}', 'x'] }))).toBe('{{uuid}}');
});

it('binds properties named like supplied variables to their placeholders', () => {
  const schema = {
    type: 'object',
    properties: {
      device: { const: 'boiler' },
      values: {
        type: 'object',
        properties: { temperature: { type: 'number' }, running: { type: 'boolean' } },
      },
    },
  };
  const template = templateFromSchema(schema, { variables: ['temperature', 'running', 'x}}'] });
  expect(JSON.parse(template)).toEqual({
    device: 'boiler',
    values: { temperature: '{{temperature}}', running: '{{running}}' },
  });
  const { payload } = expandTemplate(
    { topic: '', payload: template },
    {
      temperature: 21.5,
      running: true,
    },
  );
  expect(JSON.parse(payload)).toEqual({
    device: 'boiler',
    values: { temperature: 21.5, running: true },
  });
});
