import { payloadBytes } from './payload';

export const PUBLISH_PROPERTY_LIMITS = { pairs: 64, bytes: 65536 };
export interface PublishProperties {
  responseTopic?: string;
  contentType?: string;
  messageExpiryInterval?: number;
  payloadFormatIndicator?: boolean;
  correlationData?: { encoding: 'base64'; data: string };
  userProperties?: Record<string, string | string[]>;
}

function utf8(value: unknown, label: string): number {
  if (typeof value !== 'string' || value.length > 65535)
    throw new Error(`${label} must be a UTF-8 string of at most 65,535 bytes.`);
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (!code || (code >= 0xd800 && code <= 0xdfff))
      throw new Error(`${label} cannot contain null characters or unpaired surrogates.`);
  }
  const length = new TextEncoder().encode(value).length;
  if (length > 65535) throw new Error(`${label} exceeds 65,535 UTF-8 bytes.`);
  return length;
}

export function validatePublishTopic(topic: unknown, label = 'Topic'): asserts topic is string {
  utf8(topic, label);
  if (!topic || /[+#]/.test(topic as string))
    throw new Error(`${label} must be nonempty and cannot contain + or # wildcards.`);
}

/** Validate at both the form and main-process boundary; output is JSON-safe for saved drafts. */
export function normalizePublishProperties(
  input: unknown,
  protocolVersion: number,
  payload?: Uint8Array,
): PublishProperties | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Publish properties must be an object.');
  const source = input as Record<string, unknown>;
  const keys = Object.keys(source);
  if (!keys.length) return undefined;
  if (protocolVersion !== 5) throw new Error('Publish properties require an MQTT 5 connection.');
  const supported = [
    'responseTopic',
    'contentType',
    'messageExpiryInterval',
    'payloadFormatIndicator',
    'correlationData',
    'userProperties',
  ];
  for (const key of keys) {
    if (!supported.includes(key)) throw new Error(`Unsupported publish property: ${key}.`);
  }
  const result: PublishProperties = {};
  let bytes = 0;
  for (const key of ['responseTopic', 'contentType'] as const) {
    if (!Object.hasOwn(source, key)) continue;
    bytes += 3 + utf8(source[key], key === 'responseTopic' ? 'Response topic' : 'Content type');
    if (key === 'responseTopic') validatePublishTopic(source[key], 'Response topic');
    result[key] = source[key] as string;
  }
  if (Object.hasOwn(source, 'messageExpiryInterval')) {
    const expiry = source.messageExpiryInterval;
    if (!Number.isInteger(expiry) || (expiry as number) < 0 || (expiry as number) > 0xffffffff)
      throw new Error('Message expiry must be an integer from 0 to 4,294,967,295 seconds.');
    result.messageExpiryInterval = expiry as number;
    bytes += 5;
  }
  if (Object.hasOwn(source, 'payloadFormatIndicator')) {
    if (typeof source.payloadFormatIndicator !== 'boolean')
      throw new Error('Payload format must be unspecified bytes or UTF-8.');
    result.payloadFormatIndicator = source.payloadFormatIndicator;
    bytes += 2;
    if (result.payloadFormatIndicator && payload) {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(payload);
      } catch {
        throw new Error(
          'The payload contains invalid UTF-8 bytes for the selected payload format.',
        );
      }
    }
  }
  if (Object.hasOwn(source, 'correlationData')) {
    const correlation = source.correlationData as PublishProperties['correlationData'];
    let raw: Uint8Array;
    if (source.correlationData instanceof Uint8Array) raw = source.correlationData;
    else {
      if (
        correlation?.encoding !== 'base64' ||
        typeof correlation.data !== 'string' ||
        correlation.data.length > 87380
      )
        throw new Error('Correlation data must contain at most 65,535 bytes encoded as base64.');
      raw = payloadBytes(correlation.data, 'base64');
    }
    if (raw.length > 65535) throw new Error('Correlation data exceeds 65,535 bytes.');
    let binary = '';
    for (let i = 0; i < raw.length; i += 8192)
      binary += String.fromCharCode(...raw.subarray(i, i + 8192));
    result.correlationData = { encoding: 'base64', data: btoa(binary) };
    bytes += 3 + raw.length;
  }
  if (Object.hasOwn(source, 'userProperties')) {
    const users = source.userProperties;
    if (!users || typeof users !== 'object' || Array.isArray(users))
      throw new Error('User properties must contain string names and values.');
    const entries: [string, string | string[]][] = [];
    let count = 0;
    for (const key in users) {
      if (!Object.hasOwn(users, key)) continue;
      const values = (users as Record<string, unknown>)[key];
      const list = Array.isArray(values) ? values : [values];
      if (!list.length) throw new Error('Each user property must have a value.');
      count += list.length;
      if (count > PUBLISH_PROPERTY_LIMITS.pairs)
        throw new Error('At most 64 user property pairs are supported.');
      const keyBytes = utf8(key, 'User property name');
      for (const value of list) bytes += 5 + keyBytes + utf8(value, 'User property value');
      entries.push([key, Array.isArray(values) ? ([...values] as string[]) : (values as string)]);
      if (bytes > PUBLISH_PROPERTY_LIMITS.bytes)
        throw new Error('Publish properties exceed the 64 KiB app limit.');
    }
    if (entries.length) result.userProperties = Object.fromEntries(entries);
  }
  if (bytes > PUBLISH_PROPERTY_LIMITS.bytes)
    throw new Error('Publish properties exceed the 64 KiB app limit.');
  return result;
}
