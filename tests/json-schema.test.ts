import { expect, it } from 'vitest';
import { schemaDraft, validateJson } from '../src/shared/json-schema';

const reading = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['id', 'readings'],
  properties: {
    id: { type: 'string', minLength: 1 },
    mode: { enum: ['auto', 'manual'] },
    readings: { type: 'array', items: { $ref: '#/$defs/reading' }, minItems: 1 },
    location: {
      oneOf: [
        { type: 'object', required: ['lat', 'lon'] },
        { type: 'string', pattern: '^[A-Z]{2}$' },
      ],
    },
  },
  additionalProperties: false,
  $defs: {
    reading: {
      type: 'object',
      required: ['value'],
      properties: { value: { type: 'number', minimum: -50, maximum: 100 }, unit: { const: 'C' } },
    },
  },
};

it('validates nested objects and arrays, references, bounds, enums and combinators', () => {
  expect(
    validateJson({ id: 'a', readings: [{ value: 21.5, unit: 'C' }], location: 'DK' }, reading),
  ).toEqual({ valid: true, errors: [] });
  const result = validateJson(
    { id: '', mode: 'off', readings: [{ value: 120 }, { unit: 'F' }], location: 7, extra: 1 },
    reading,
  );
  expect(result.valid).toBe(false);
  const text = result.errors.join('\n');
  for (const location of ['/id', '/mode', '/readings/0/value', '/readings/1', '/location', '/'])
    expect(text).toContain(`${location}:`);
  expect(validateJson({ id: 'a' }, reading).errors.join()).toContain('readings');
  expect(validateJson([], reading).valid).toBe(false);
  expect(validateJson(null, { type: ['object', 'null'] }).valid).toBe(true);
});

it('treats integers, nulls and the declared dialect correctly', () => {
  const draft7 = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    definitions: { level: { type: 'integer', minimum: 0, maximum: 100 } },
    properties: { battery: { $ref: '#/definitions/level' }, tags: { items: [{ type: 'string' }] } },
  };
  expect(schemaDraft(draft7)).toBe('7');
  expect(schemaDraft({})).toBe('2020-12');
  expect(validateJson({ battery: 50, tags: ['x'] }, draft7).valid).toBe(true);
  expect(validateJson({ battery: 50.5 }, draft7).valid).toBe(false);
  expect(validateJson({ tags: [1] }, draft7).valid).toBe(false);
  expect(validateJson(5, true)).toEqual({ valid: true, errors: [] });
  expect(validateJson(5, false).valid).toBe(false);
});

it('reports schema problems instead of throwing and bounds the error list', () => {
  expect(validateJson({}, { $ref: '#/$defs/missing' }).errors[0]).toMatch(/^Schema error/);
  expect(validateJson({}, 'not a schema').errors[0]).toMatch(/^Schema error/);
  const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, 'x']));
  const result = validateJson(many, { additionalProperties: { type: 'number' } });
  expect(result.errors).toHaveLength(21);
  expect(result.errors.at(-1)).toMatch(/more errors$/);
});
