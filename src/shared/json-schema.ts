import { Validator, type Schema, type SchemaDraft } from '@cfworker/json-schema';

export interface SchemaResult {
  valid: boolean;
  errors: string[];
}

const MAX_ERRORS = 20;

/** The dialect a schema declares; schemas without `$schema` use 2020-12. */
export function schemaDraft(schema: unknown): SchemaDraft {
  const declared =
    schema && typeof schema === 'object'
      ? String((schema as { $schema?: unknown }).$schema ?? '')
      : '';
  if (declared.includes('draft-04')) return '4';
  if (declared.includes('draft-06') || declared.includes('draft-07')) return '7';
  if (declared.includes('2019-09')) return '2019-09';
  return '2020-12';
}

/**
 * Standards-based validation without code generation, which the renderer's CSP forbids.
 * Local `$ref`s resolve within the schema; remote references are never fetched.
 */
export function validateJson(data: unknown, schema: unknown): SchemaResult {
  if (typeof schema === 'boolean')
    return { valid: schema, errors: schema ? [] : ['Rejected by schema'] };
  if (!schema || typeof schema !== 'object' || Array.isArray(schema))
    return { valid: false, errors: ['Schema error: a schema must be an object or boolean'] };
  let result;
  try {
    result = new Validator(schema as Schema, schemaDraft(schema), false).validate(data);
  } catch (error) {
    return { valid: false, errors: [`Schema error: ${(error as Error).message}`] };
  }
  if (result.valid) return { valid: true, errors: [] };
  // Combinators report a summary line per branch; keep the specific failures first.
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const unit of [...result.errors].reverse()) {
    const location = unit.instanceLocation.replace(/^#/, '') || '/';
    const message = `${location}: ${unit.error}`;
    if (seen.has(message)) continue;
    seen.add(message);
    errors.push(message);
  }
  return {
    valid: false,
    errors:
      errors.length > MAX_ERRORS
        ? [...errors.slice(0, MAX_ERRORS), `${errors.length - MAX_ERRORS} more errors`]
        : errors,
  };
}
