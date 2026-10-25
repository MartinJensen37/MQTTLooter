export interface TemplateVariable {
  type?: 'text' | 'string' | 'number' | 'integer' | 'boolean' | 'json';
  default?: unknown;
  description?: string;
}

interface Template {
  topic: string;
  payload: string;
  variables?: Record<string, TemplateVariable>;
  schema?: unknown;
}

const MAX_LENGTH = 1024 * 1024;
const numberPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i;

function jsonValue(value: unknown): string {
  let nodes = 0;
  const visit = (item: unknown, depth: number) => {
    if (++nodes > 10000 || depth > 64) throw new Error('Template variable is too complex.');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (Array.isArray(item)) item.forEach((child) => visit(child, depth + 1));
    else if (item && typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype)
      Object.values(item).forEach((child) => visit(child, depth + 1));
    else throw new Error('Template variables must contain JSON values.');
  };
  visit(value, 0);
  const text = JSON.stringify(value);
  if (text.length > MAX_LENGTH) throw new Error('Template variable is too large.');
  return text;
}

export function templateDefaults(definitions: Record<string, TemplateVariable> = {}) {
  if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions))
    throw new Error('Template variables must be an object.');
  if (Object.keys(definitions).length > 128) throw new Error('Too many template variables.');
  let length = 0;
  return Object.fromEntries(
    Object.entries(definitions).map(([name, definition]) => {
      if (!definition || typeof definition !== 'object' || Array.isArray(definition))
        throw new Error(`Invalid variable definition: ${name}`);
      const value = definition.default;
      const text =
        value === undefined
          ? ''
          : typeof value === 'string' && definition.type !== 'json'
            ? value
            : jsonValue(value);
      length += name.length + text.length;
      if (length > MAX_LENGTH) throw new Error('Template variable defaults are too large.');
      return [name, text];
    }),
  );
}

function typedVariable(
  name: string,
  value: unknown,
  definition?: TemplateVariable,
  fromInput = true,
): unknown {
  const type = definition?.type;
  if (typeof value === 'string' && value.length > MAX_LENGTH)
    throw new Error(`${name}: template variable is too large.`);
  if (value === undefined) throw new Error(`Missing template variable: ${name}`);
  if (type === 'text' || type === 'string') {
    if (typeof value !== 'string') throw new Error(`${name}: expected text.`);
  } else if (type === 'number' || type === 'integer') {
    if (typeof value === 'string' && numberPattern.test(value.trim())) value = Number(value);
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      (type === 'integer' && !Number.isSafeInteger(value))
    )
      throw new Error(
        `${name}: expected a finite ${type === 'integer' ? 'safe integer' : 'number'}.`,
      );
  } else if (type === 'boolean') {
    if (value === 'true') value = true;
    if (value === 'false') value = false;
    if (typeof value !== 'boolean') throw new Error(`${name}: expected true or false.`);
  } else if (type === 'json') {
    if (fromInput && typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        throw new Error(`${name}: expected valid JSON.`);
      }
    }
  } else if (type !== undefined) throw new Error(`${name}: unsupported variable type.`);
  jsonValue(value);
  return value;
}

/** Expands once into an editable draft. Inserted values are never evaluated as expressions. */
export function expandTemplate(
  template: Template,
  variables: Record<string, unknown> = {},
  context: { now?: () => number; random?: () => number; uuid?: () => string } = {},
) {
  if (typeof template.topic !== 'string' || typeof template.payload !== 'string')
    throw new Error('Template topic and payload must be text.');
  if (template.topic.length + template.payload.length > MAX_LENGTH)
    throw new Error('Template exceeds 1 MiB of text.');
  const definitions = template.variables ?? {};
  templateDefaults(definitions);
  const now = (context.now ?? Date.now)();
  const random = context.random ?? Math.random;
  let uuid: string | undefined;
  let tokens = 0;
  const resolved = new Map<string, unknown>();
  const resolve = (expression: string): unknown => {
    if (++tokens > 2000) throw new Error('Too many template expressions.');
    const name = expression.trim();
    if (Object.hasOwn(variables, name) || Object.hasOwn(definitions, name)) {
      if (!resolved.has(name))
        resolved.set(
          name,
          typedVariable(
            name,
            Object.hasOwn(variables, name) ? variables[name] : definitions[name].default,
            Object.hasOwn(definitions, name) ? definitions[name] : undefined,
            Object.hasOwn(variables, name),
          ),
        );
      return resolved.get(name);
    }
    if (name === 'timestamp') return now;
    if (name === 'uuid')
      return (uuid ??= (context.uuid ?? (() => globalThis.crypto.randomUUID()))());
    const call = /^(randomInt|randomFloat|randomChoice)\(([\s\S]*)\)$/.exec(name);
    if (!call) throw new Error(`Unknown template expression: ${name}`);
    let args: unknown[];
    try {
      const argumentsJson = call[2].replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (token) =>
        token.startsWith('"')
          ? token
          : `"${token
              .slice(1, -1)
              .replace(/\\'|\\.|"/g, (escape) =>
                escape === "\\'" ? "'" : escape === '"' ? '\\"' : escape,
              )}"`,
      );
      args = JSON.parse(`[${argumentsJson}]`);
    } catch {
      throw new Error(`Invalid arguments for ${call[1]}. Use JSON values.`);
    }
    if (call[1] === 'randomChoice') {
      if (!args.length) throw new Error('randomChoice needs at least one value.');
      return args[Math.floor(random() * args.length)];
    }
    const [min, max, decimals = 2] = args;
    if (
      args.length !== (call[1] === 'randomInt' ? 2 : 3) ||
      typeof min !== 'number' ||
      typeof max !== 'number' ||
      !Number.isFinite(min) ||
      !Number.isFinite(max) ||
      min > max ||
      !Number.isFinite(max - min)
    )
      throw new Error(`${call[1]} needs finite, ordered bounds.`);
    if (call[1] === 'randomInt') {
      if (
        !Number.isSafeInteger(min) ||
        !Number.isSafeInteger(max) ||
        !Number.isSafeInteger(max - min + 1)
      )
        throw new Error('randomInt needs safe integer bounds.');
      return Math.floor(random() * (max - min + 1)) + min;
    }
    if (
      typeof decimals !== 'number' ||
      !Number.isInteger(decimals) ||
      decimals < 0 ||
      decimals > 10
    )
      throw new Error('randomFloat decimal places must be between 0 and 10.');
    return Number((min + random() * (max - min)).toFixed(decimals));
  };
  let expandedLength = 0;
  const encode = (value: unknown, json: boolean) => {
    const encoded = jsonValue(value);
    const text = !json && typeof value === 'string' ? value : encoded;
    expandedLength += text.length;
    if (expandedLength > MAX_LENGTH) throw new Error('Expanded template exceeds 1 MiB of text.');
    return text;
  };
  const interpolate = (text: string) =>
    text.replace(/{{([\s\S]*?)}}/g, (_match, expression) => encode(resolve(expression), false));
  const topic = interpolate(template.topic);
  let isJson = false;
  try {
    JSON.parse(template.payload);
    isJson = true;
  } catch {
    if (template.schema !== undefined && template.schema !== null)
      throw new Error(
        'Template payload must be valid JSON before expansion. Put placeholders inside JSON strings.',
      );
  }
  // Replace JSON string tokens only; leave numeric lexemes and whitespace untouched.
  const payload = isJson
    ? template.payload.replace(/"(?:[^"\\]|\\[\s\S])*"/g, (token, offset: number) => {
        const value: string = JSON.parse(token);
        if (!value.includes('{{')) return token;
        const exact = /^{{([^{}]*?)}}$/.exec(value);
        const isKey = /^\s*:/.test(template.payload.slice(offset + token.length));
        return exact && !isKey
          ? encode(resolve(exact[1]), true)
          : JSON.stringify(interpolate(value));
      })
    : interpolate(template.payload);
  if (topic.length + payload.length > MAX_LENGTH)
    throw new Error('Expanded template exceeds 1 MiB of text.');
  return { topic, payload };
}
