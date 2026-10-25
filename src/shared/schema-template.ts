/**
 * Build a publishing template from a JSON Schema. Placeholders generate a fresh valid value on
 * each Apply where the schema allows it (bounded numbers, enums, uuid and date-time strings);
 * other values are fixed examples. Local `$ref`s are followed; remote references are not.
 */
const LIMITS = { depth: 16, nodes: 1000, arrayItems: 3 };

type Schema = Record<string, any>;

/** A whole-value placeholder; the expander turns it into a typed JSON value. */
const placeholder = (expression: string) => `{{${expression}}}`;
const safeArgument = (value: unknown) =>
  ['string', 'number', 'boolean'].includes(typeof value) &&
  !JSON.stringify(value).includes('{{') &&
  !JSON.stringify(value).includes('}}');

/**
 * `variables` names placeholders the caller supplies, such as simulator signals: an object
 * property with the same name becomes `{{name}}` instead of a generated value.
 */
export function templateFromSchema(
  schema: unknown,
  options: { variables?: string[] } = {},
): string {
  const variables = new Set(
    (options.variables ?? []).filter((name) => !name.includes('{{') && !name.includes('}}')),
  );
  let nodes = 0;
  const resolve = (reference: string): unknown => {
    if (!reference.startsWith('#')) return undefined;
    let target: unknown = schema;
    for (const segment of reference.slice(1).split('/').filter(Boolean)) {
      const key = decodeURIComponent(segment).replace(/~1/g, '/').replace(/~0/g, '~');
      if (!target || typeof target !== 'object' || !Object.hasOwn(target, key)) return undefined;
      target = (target as Schema)[key];
    }
    return target;
  };

  const build = (node: unknown, depth: number, seen: Set<string>): unknown => {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth) return null;
    if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
    const value = node as Schema;
    if (typeof value.$ref === 'string') {
      if (seen.has(value.$ref)) return null;
      return build(resolve(value.$ref), depth + 1, new Set([...seen, value.$ref]));
    }
    if ('const' in value) return value.const;
    if (Array.isArray(value.enum) && value.enum.length)
      return value.enum.length > 1 && value.enum.every(safeArgument)
        ? placeholder(`randomChoice(${value.enum.map((item) => JSON.stringify(item)).join(', ')})`)
        : value.enum[0];
    if ('default' in value) return value.default;
    if (Array.isArray(value.examples) && value.examples.length) return value.examples[0];
    if (Array.isArray(value.allOf) && value.allOf.length) {
      const merged: Schema = { ...value, allOf: undefined, properties: { ...value.properties } };
      for (const part of value.allOf) {
        const resolved = part?.$ref ? resolve(part.$ref) : part;
        if (!resolved || typeof resolved !== 'object') continue;
        const item = resolved as Schema;
        Object.assign(merged.properties, item.properties);
        merged.required = [...(merged.required ?? []), ...(item.required ?? [])];
        merged.type ??= item.type;
      }
      return build(merged, depth + 1, seen);
    }
    const branch = value.oneOf?.[0] ?? value.anyOf?.[0];
    if (branch && !value.type && !value.properties) return build(branch, depth + 1, seen);

    const type = Array.isArray(value.type)
      ? (value.type.find((item: string) => item !== 'null') ?? 'null')
      : (value.type ??
        (value.properties ? 'object' : value.items || value.prefixItems ? 'array' : undefined));
    switch (type) {
      case 'object': {
        const result: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value.properties ?? {}))
          result[key] = variables.has(key) ? placeholder(key) : build(child, depth + 1, seen);
        for (const key of value.required ?? []) if (!(key in result)) result[key] = null;
        return result;
      }
      case 'array': {
        const prefix = Array.isArray(value.prefixItems)
          ? value.prefixItems
          : Array.isArray(value.items)
            ? value.items
            : [];
        const count = Math.min(
          LIMITS.arrayItems,
          Math.max(prefix.length, Number.isInteger(value.minItems) ? value.minItems : 1),
        );
        const rest = Array.isArray(value.items) ? value.additionalItems : value.items;
        return Array.from({ length: count }, (_, index) =>
          build(index < prefix.length ? prefix[index] : rest, depth + 1, seen),
        );
      }
      case 'integer':
      case 'number': {
        const integer = type === 'integer';
        const step = integer ? 1 : 0.01;
        const low =
          typeof value.exclusiveMinimum === 'number'
            ? value.exclusiveMinimum + step
            : typeof value.minimum === 'number'
              ? value.minimum
              : undefined;
        const high =
          typeof value.exclusiveMaximum === 'number'
            ? value.exclusiveMaximum - step
            : typeof value.maximum === 'number'
              ? value.maximum
              : undefined;
        const min = low ?? (high !== undefined ? Math.min(0, high) : 0);
        const max = high ?? min + 100;
        if (typeof value.multipleOf === 'number' && value.multipleOf > 0)
          return Math.ceil(min / value.multipleOf) * value.multipleOf;
        if (integer) {
          const lower = Math.ceil(min);
          const upper = Math.floor(max);
          return lower <= upper ? placeholder(`randomInt(${lower}, ${upper})`) : lower;
        }
        return min <= max ? placeholder(`randomFloat(${min}, ${max}, 2)`) : min;
      }
      case 'string': {
        if (value.format === 'date-time') return placeholder('isoTimestamp');
        if (value.format === 'uuid') return placeholder('uuid');
        const example =
          value.format === 'email'
            ? 'user@example.com'
            : value.format === 'uri' || value.format === 'url'
              ? 'https://example.com/'
              : value.format === 'date'
                ? '2026-01-01'
                : 'sample';
        const length = Number.isInteger(value.minLength) ? value.minLength : 0;
        const padded = example.padEnd(Math.min(length, 1024), 'x');
        return Number.isInteger(value.maxLength) ? padded.slice(0, value.maxLength) : padded;
      }
      case 'boolean':
        return placeholder('randomChoice(true, false)');
      default:
        return null;
    }
  };

  return JSON.stringify(build(schema, 0, new Set()), null, 2);
}
