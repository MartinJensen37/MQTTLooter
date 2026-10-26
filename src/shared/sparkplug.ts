/** Sparkplug B 3.0 topics, data types and command shapes. Protobuf code lives in main. */
import type { DecoderDefinition } from './decoders';

export const SPARKPLUG_NAMESPACE = 'spBv1.0';
/** Id of the built-in decoder, next to user decoders. */
export const SPARKPLUG_DECODER_ID = 'sparkplug-b';
/**
 * Listed after saved decoders, so a user's own spBv1.0 decoder wins. The filter needs four
 * levels, which leaves out spBv1.0/STATE/<host>, a JSON message.
 */
export const SPARKPLUG_DECODER: DecoderDefinition = {
  id: SPARKPLUG_DECODER_ID,
  name: 'Sparkplug B',
  topicFilter: 'spBv1.0/+/+/+/#',
  messageType: 'org.eclipse.tahu.protobuf.Payload',
  proto: '',
};

export const SPARKPLUG_MESSAGE_TYPES = [
  'NBIRTH',
  'NDEATH',
  'DBIRTH',
  'DDEATH',
  'NDATA',
  'DDATA',
  'NCMD',
  'DCMD',
] as const;
export type SparkplugMessageType = (typeof SPARKPLUG_MESSAGE_TYPES)[number];

export interface SparkplugTopic {
  group: string;
  messageType: SparkplugMessageType;
  edgeNode: string;
  /** Present for DBIRTH, DDEATH, DDATA and DCMD. */
  device?: string;
}

/** `spBv1.0/group/TYPE/edgeNode[/device]`, or undefined for any other topic (including STATE). */
export function parseSparkplugTopic(topic: string): SparkplugTopic | undefined {
  if (!topic.startsWith(`${SPARKPLUG_NAMESPACE}/`)) return undefined;
  const parts = topic.split('/');
  if (parts.length < 4 || parts.length > 5) return undefined;
  const [, group, messageType, edgeNode, device] = parts;
  if (!SPARKPLUG_MESSAGE_TYPES.includes(messageType as SparkplugMessageType)) return undefined;
  if (!group || !edgeNode || device === '' || (messageType[0] === 'D') !== (device !== undefined))
    return undefined;
  return {
    group,
    messageType: messageType as SparkplugMessageType,
    edgeNode,
    ...(device !== undefined && { device }),
  };
}

export const sparkplugTopic = ({ group, messageType, edgeNode, device }: SparkplugTopic) =>
  [SPARKPLUG_NAMESPACE, group, messageType, edgeNode, ...(device ? [device] : [])].join('/');

/** Birth messages carry metric names and aliases; later data may send aliases only. */
export const isSparkplugBirth = (topic: string) =>
  topic.startsWith(`${SPARKPLUG_NAMESPACE}/`) && /^[^/]+\/[^/]+\/[ND]BIRTH\//.test(topic);

/** Data type names by their Sparkplug enum value. */
export const SPARKPLUG_DATA_TYPES = [
  'Unknown',
  'Int8',
  'Int16',
  'Int32',
  'Int64',
  'UInt8',
  'UInt16',
  'UInt32',
  'UInt64',
  'Float',
  'Double',
  'Boolean',
  'String',
  'DateTime',
  'Text',
  'UUID',
  'DataSet',
  'Bytes',
  'File',
  'Template',
  'PropertySet',
  'PropertySetList',
  'Int8Array',
  'Int16Array',
  'Int32Array',
  'Int64Array',
  'UInt8Array',
  'UInt16Array',
  'UInt32Array',
  'UInt64Array',
  'FloatArray',
  'DoubleArray',
  'BooleanArray',
  'StringArray',
  'DateTimeArray',
] as const;
export type SparkplugDataType = (typeof SPARKPLUG_DATA_TYPES)[number];

/** Types the command builder and simulator can write. */
export const SPARKPLUG_SCALAR_TYPES = [
  'Boolean',
  'Int8',
  'Int16',
  'Int32',
  'Int64',
  'UInt8',
  'UInt16',
  'UInt32',
  'UInt64',
  'Float',
  'Double',
  'String',
  'Text',
  'DateTime',
] as const satisfies readonly SparkplugDataType[];
export type SparkplugScalarType = (typeof SPARKPLUG_SCALAR_TYPES)[number];

export interface SparkplugOutgoingMetric {
  name: string;
  /** Sent instead of the name in data messages once a birth has declared it. */
  alias?: number;
  type: SparkplugScalarType;
  value: boolean | number | string | null;
  timestamp?: number;
}

/** A payload to encode for publishing: commands, births and data. */
export interface SparkplugOutgoingPayload {
  timestamp?: number;
  seq?: number;
  metrics: SparkplugOutgoingMetric[];
}

export const SPARKPLUG_LIMITS = { maxMetrics: 1000, maxNameChars: 1024, maxStringChars: 65536 };

/** Rejects anything the encoder cannot write; values are checked against their type. */
export function validateSparkplugPayload(value: unknown): SparkplugOutgoingPayload {
  const payload = value as Partial<SparkplugOutgoingPayload> | null;
  const integer = (item: unknown, min: number, max: number) =>
    typeof item === 'number' && Number.isInteger(item) && item >= min && item <= max;
  if (
    !payload ||
    typeof payload !== 'object' ||
    !Array.isArray(payload.metrics) ||
    payload.metrics.length > SPARKPLUG_LIMITS.maxMetrics ||
    (payload.timestamp !== undefined && !integer(payload.timestamp, 0, Number.MAX_SAFE_INTEGER)) ||
    (payload.seq !== undefined && !integer(payload.seq, 0, 255))
  )
    throw new Error('Invalid Sparkplug payload');
  return {
    ...(payload.timestamp !== undefined && { timestamp: payload.timestamp }),
    ...(payload.seq !== undefined && { seq: payload.seq }),
    metrics: payload.metrics.map((item) => {
      const metric = item as Partial<SparkplugOutgoingMetric> | null;
      if (
        !metric ||
        typeof metric.name !== 'string' ||
        metric.name.length > SPARKPLUG_LIMITS.maxNameChars ||
        !SPARKPLUG_SCALAR_TYPES.includes(metric.type as SparkplugScalarType) ||
        (metric.alias !== undefined && !integer(metric.alias, 0, Number.MAX_SAFE_INTEGER)) ||
        (metric.timestamp !== undefined && !integer(metric.timestamp, 0, Number.MAX_SAFE_INTEGER))
      )
        throw new Error('Each Sparkplug metric needs a name and a supported type');
      const value = metric.value ?? null;
      if (value !== null) sparkplugValueError(metric.type!, value, true);
      return {
        name: metric.name,
        type: metric.type!,
        value,
        ...(metric.alias !== undefined && { alias: metric.alias }),
        ...(metric.timestamp !== undefined && { timestamp: metric.timestamp }),
      };
    }),
  };
}

const INTEGER_RANGES: Partial<Record<SparkplugScalarType, [bigint, bigint]>> = {
  Int8: [-128n, 127n],
  Int16: [-32768n, 32767n],
  Int32: [-2147483648n, 2147483647n],
  Int64: [-9223372036854775808n, 9223372036854775807n],
  UInt8: [0n, 255n],
  UInt16: [0n, 65535n],
  UInt32: [0n, 4294967295n],
  UInt64: [0n, 18446744073709551615n],
  DateTime: [0n, 18446744073709551615n],
};

/**
 * Why a value does not fit a type, or '' when it does. Integers may be given as numbers or
 * decimal strings, so 64-bit values keep their precision.
 */
export function sparkplugValueError(
  type: SparkplugScalarType,
  value: unknown,
  throws = false,
): string {
  let error = '';
  const range = INTEGER_RANGES[type];
  if (type === 'Boolean') {
    if (typeof value !== 'boolean') error = 'Use true or false.';
  } else if (type === 'String' || type === 'Text') {
    if (typeof value !== 'string' || value.length > SPARKPLUG_LIMITS.maxStringChars)
      error = 'Use text of at most 65,536 characters.';
  } else if (type === 'Float' || type === 'Double') {
    if (typeof value !== 'number' || !Number.isFinite(value)) error = 'Use a finite number.';
  } else if (range) {
    const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
    if (typeof text !== 'string' || !/^-?\d{1,20}$/.test(text)) error = 'Use a whole number.';
    else if (BigInt(text) < range[0] || BigInt(text) > range[1])
      error = `Use a whole number from ${range[0]} to ${range[1]}.`;
  }
  if (error && throws) throw new Error(`${type}: ${error}`);
  return error;
}

/** Parse text typed for a metric value; returns the value or an error message. */
export function parseSparkplugValue(
  type: SparkplugScalarType,
  text: string,
): { value: boolean | number | string } | { error: string } {
  let value: boolean | number | string = text;
  if (type === 'Boolean') {
    const lower = text.trim().toLowerCase();
    if (lower !== 'true' && lower !== 'false') return { error: 'Use true or false.' };
    value = lower === 'true';
  } else if (type === 'Float' || type === 'Double') {
    value = text.trim() === '' ? NaN : Number(text);
  } else if (INTEGER_RANGES[type]) {
    value = text.trim();
    if (/^-?\d+$/.test(value) && Number.isSafeInteger(Number(value))) value = Number(value);
  }
  const error = sparkplugValueError(type, value);
  return error ? { error } : { value };
}
