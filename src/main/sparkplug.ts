import protobuf from 'protobufjs';
import {
  SPARKPLUG_DATA_TYPES,
  parseSparkplugTopic,
  type SparkplugOutgoingPayload,
  type SparkplugTopic,
} from '../shared/sparkplug';

/** Eclipse Tahu sparkplug_b.proto (Sparkplug B 3.0), with comments removed. */
export const SPARKPLUG_PROTO = `
syntax = "proto2";
package org.eclipse.tahu.protobuf;

message Payload {
  message Template {
    message Parameter {
      optional string name = 1;
      optional uint32 type = 2;
      oneof value {
        uint32 int_value = 3;
        uint64 long_value = 4;
        float float_value = 5;
        double double_value = 6;
        bool boolean_value = 7;
        string string_value = 8;
        ParameterValueExtension extension_value = 9;
      }
      message ParameterValueExtension {
        extensions 1 to max;
      }
    }
    optional string version = 1;
    repeated Metric metrics = 2;
    repeated Parameter parameters = 3;
    optional string template_ref = 4;
    optional bool is_definition = 5;
    extensions 6 to max;
  }

  message DataSet {
    message DataSetValue {
      oneof value {
        uint32 int_value = 1;
        uint64 long_value = 2;
        float float_value = 3;
        double double_value = 4;
        bool boolean_value = 5;
        string string_value = 6;
        DataSetValueExtension extension_value = 7;
      }
      message DataSetValueExtension {
        extensions 1 to max;
      }
    }
    message Row {
      repeated DataSetValue elements = 1;
      extensions 2 to max;
    }
    optional uint64 num_of_columns = 1;
    repeated string columns = 2;
    repeated uint32 types = 3;
    repeated Row rows = 4;
    extensions 5 to max;
  }

  message PropertyValue {
    optional uint32 type = 1;
    optional bool is_null = 2;
    oneof value {
      uint32 int_value = 3;
      uint64 long_value = 4;
      float float_value = 5;
      double double_value = 6;
      bool boolean_value = 7;
      string string_value = 8;
      PropertySet propertyset_value = 9;
      PropertySetList propertysets_value = 10;
      PropertyValueExtension extension_value = 11;
    }
    message PropertyValueExtension {
      extensions 1 to max;
    }
  }

  message PropertySet {
    repeated string keys = 1;
    repeated PropertyValue values = 2;
    extensions 3 to max;
  }

  message PropertySetList {
    repeated PropertySet propertyset = 1;
    extensions 2 to max;
  }

  message MetaData {
    optional bool is_multi_part = 1;
    optional string content_type = 2;
    optional uint64 size = 3;
    optional uint64 seq = 4;
    optional string file_name = 5;
    optional string file_type = 6;
    optional string md5 = 7;
    optional string description = 8;
    extensions 9 to max;
  }

  message Metric {
    optional string name = 1;
    optional uint64 alias = 2;
    optional uint64 timestamp = 3;
    optional uint32 datatype = 4;
    optional bool is_historical = 5;
    optional bool is_transient = 6;
    optional bool is_null = 7;
    optional MetaData metadata = 8;
    optional PropertySet properties = 9;
    oneof value {
      uint32 int_value = 10;
      uint64 long_value = 11;
      float float_value = 12;
      double double_value = 13;
      bool boolean_value = 14;
      string string_value = 15;
      bytes bytes_value = 16;
      DataSet dataset_value = 17;
      Template template_value = 18;
      MetricValueExtension extension_value = 19;
    }
    message MetricValueExtension {
      extensions 1 to max;
    }
  }

  optional uint64 timestamp = 1;
  repeated Metric metrics = 2;
  optional uint64 seq = 3;
  optional string uuid = 4;
  optional bytes body = 5;
  extensions 6 to max;
}
`;

type Wire = Record<string, any>;
interface Known {
  name: string;
  datatype: number;
}
/** Aliases declared by one edge node's births: its own, and each device's. */
interface NodeAliases {
  node: Map<string, Known>;
  devices: Map<string, Map<string, Known>>;
}

const TYPE = Object.fromEntries(SPARKPLUG_DATA_TYPES.map((name, index) => [name, index])) as Record<
  (typeof SPARKPLUG_DATA_TYPES)[number],
  number
>;
/** Data type implied by the value field, for data messages that leave it out. */
const FIELD_TYPES: Record<string, number> = {
  int_value: TYPE.UInt32,
  long_value: TYPE.UInt64,
  float_value: TYPE.Float,
  double_value: TYPE.Double,
  boolean_value: TYPE.Boolean,
  string_value: TYPE.String,
  bytes_value: TYPE.Bytes,
  dataset_value: TYPE.DataSet,
  template_value: TYPE.Template,
};
const MAX_NODES = 10_000;
const MAX_ALIASES = 100_000;

/** A safe integer stays a number; larger 64-bit values keep their digits as a string. */
const integer = (value: bigint): number | string =>
  value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : value.toString();

/** The shortest decimal that reads back as the same 32-bit float, e.g. 0.1 rather than 0.10000000149. */
function float32(value: number): number {
  if (!Number.isFinite(value)) return value;
  for (let digits = 1; digits <= 9; digits++) {
    const shorter = Number(value.toPrecision(digits));
    if (Math.fround(shorter) === value) return shorter;
  }
  return value;
}

const fromBase64 = (text: string) => Uint8Array.from(Buffer.from(text, 'base64'));

/** Sparkplug 3.0 packs array types little-endian into bytes_value. */
function packedArray(type: number, base64: string): unknown {
  const bytes = fromBase64(base64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const read = (size: number, get: (offset: number) => unknown) =>
    Array.from({ length: Math.floor(bytes.length / size) }, (_, index) => get(index * size));
  switch (type) {
    case TYPE.Int8Array:
      return read(1, (offset) => view.getInt8(offset));
    case TYPE.UInt8Array:
      return read(1, (offset) => view.getUint8(offset));
    case TYPE.Int16Array:
      return read(2, (offset) => view.getInt16(offset, true));
    case TYPE.UInt16Array:
      return read(2, (offset) => view.getUint16(offset, true));
    case TYPE.Int32Array:
      return read(4, (offset) => view.getInt32(offset, true));
    case TYPE.UInt32Array:
      return read(4, (offset) => view.getUint32(offset, true));
    case TYPE.Int64Array:
    case TYPE.DateTimeArray:
      return read(8, (offset) => integer(view.getBigInt64(offset, true)));
    case TYPE.UInt64Array:
      return read(8, (offset) => integer(view.getBigUint64(offset, true)));
    case TYPE.FloatArray:
      return read(4, (offset) => float32(view.getFloat32(offset, true)));
    case TYPE.DoubleArray:
      return read(8, (offset) => view.getFloat64(offset, true));
    case TYPE.BooleanArray: {
      // A 4-byte element count, then the values packed into bits, most significant first.
      const count = bytes.length >= 4 ? view.getUint32(0, true) : 0;
      return Array.from(
        { length: Math.min(count, (bytes.length - 4) * 8) },
        (_, index) => ((bytes[4 + (index >> 3)] >> (7 - (index & 7))) & 1) === 1,
      );
    }
    case TYPE.StringArray:
      return new TextDecoder().decode(bytes).split('\0').slice(0, -1);
  }
  return base64;
}

/** A value from one of the `oneof value` fields, read as the declared data type. */
function typedValue(type: number, field: string | undefined, wire: Wire): unknown {
  if (!field) return null;
  const raw = wire[field];
  switch (field) {
    case 'int_value':
      if (type === TYPE.Int8) return (raw << 24) >> 24;
      if (type === TYPE.Int16) return (raw << 16) >> 16;
      if (type === TYPE.Int32) return raw | 0;
      return raw >>> 0;
    case 'long_value': {
      const value = BigInt(raw);
      return integer(type === TYPE.Int64 || type === TYPE.Int32 ? BigInt.asIntN(64, value) : value);
    }
    case 'float_value':
      return float32(raw);
    case 'bytes_value':
      return type >= TYPE.Int8Array && type <= TYPE.DateTimeArray ? packedArray(type, raw) : raw;
    case 'dataset_value':
      return dataSet(raw);
    case 'template_value':
      return template(raw);
    case 'extension_value':
      return null;
  }
  return raw;
}

function dataSet(wire: Wire) {
  const types: number[] = wire.types ?? [];
  return {
    columns: wire.columns ?? [],
    types: types.map((type) => SPARKPLUG_DATA_TYPES[type] ?? `Type ${type}`),
    rows: (wire.rows ?? []).map((row: Wire) =>
      (row.elements ?? []).map((element: Wire, column: number) =>
        typedValue(types[column] ?? FIELD_TYPES[element.value] ?? 0, element.value, element),
      ),
    ),
  };
}

function template(wire: Wire): Record<string, unknown> {
  return {
    ...(wire.template_ref !== undefined && { templateRef: wire.template_ref }),
    ...(wire.version !== undefined && { version: wire.version }),
    ...(wire.is_definition && { isDefinition: true }),
    ...(wire.parameters?.length && {
      parameters: Object.fromEntries(
        wire.parameters.map((parameter: Wire) => [
          parameter.name ?? '',
          typedValue(
            parameter.type ?? FIELD_TYPES[parameter.value] ?? 0,
            parameter.value,
            parameter,
          ),
        ]),
      ),
    }),
    metrics: metricMap((wire.metrics ?? []).map((metric: Wire) => readMetric(metric, undefined))),
  };
}

function propertySet(wire: Wire): Record<string, unknown> {
  const values: Wire[] = wire.values ?? [];
  return Object.fromEntries(
    (wire.keys ?? []).map((key: string, index: number) => {
      const property = values[index] ?? {};
      if (property.is_null) return [key, null];
      if (property.value === 'propertyset_value')
        return [key, propertySet(property.propertyset_value)];
      if (property.value === 'propertysets_value')
        return [key, (property.propertysets_value.propertyset ?? []).map(propertySet)];
      const type = property.type ?? FIELD_TYPES[property.value] ?? 0;
      return [key, typedValue(type, property.value, property)];
    }),
  );
}

export interface DecodedMetric {
  name: string;
  value: unknown;
  type: string;
  alias?: number | string;
  timestamp?: number | string;
  historical?: true;
  transient?: true;
  properties?: Record<string, unknown>;
}

function readMetric(wire: Wire, known: Known | undefined): DecodedMetric {
  const alias = wire.alias === undefined ? undefined : integer(BigInt(wire.alias));
  const type = wire.datatype ?? known?.datatype ?? FIELD_TYPES[wire.value] ?? 0;
  return {
    name: wire.name ?? known?.name ?? `Alias ${alias ?? '?'}`,
    value: wire.is_null ? null : typedValue(type, wire.value, wire),
    type: SPARKPLUG_DATA_TYPES[type] ?? `Type ${type}`,
    ...(alias !== undefined && { alias }),
    ...(wire.timestamp !== undefined && { timestamp: integer(BigInt(wire.timestamp)) }),
    ...(wire.is_historical && { historical: true as const }),
    ...(wire.is_transient && { transient: true as const }),
    ...(wire.properties && { properties: propertySet(wire.properties) }),
  };
}

/** Metrics by name; a name repeated in one payload, as in historical batches, gets a suffix. */
function metricMap(metrics: DecodedMetric[]): Record<string, Omit<DecodedMetric, 'name'>> {
  const map: Record<string, Omit<DecodedMetric, 'name'>> = {};
  for (const { name, ...metric } of metrics) {
    let key = name;
    for (let copy = 2; key in map; copy++) key = `${name} [${copy}]`;
    map[key] = metric;
  }
  return map;
}

/** Sparkplug B payloads: decoding with alias names from births, and encoding to publish. */
export class SparkplugCodec {
  private type = protobuf
    .parse(SPARKPLUG_PROTO, { keepCase: true })
    .root.lookupType('org.eclipse.tahu.protobuf.Payload');
  private nodes = new Map<string, NodeAliases>();
  private aliasCount = 0;

  private wire(payload: Uint8Array): Wire {
    return this.type.toObject(this.type.decode(payload), {
      longs: String,
      bytes: String,
      oneofs: true,
    });
  }

  /** Remember the names and types a birth declares for its aliases. */
  observe(topic: string, payload: Uint8Array): void {
    const source = parseSparkplugTopic(topic);
    if (!source || (source.messageType !== 'NBIRTH' && source.messageType !== 'DBIRTH')) return;
    let wire: Wire;
    try {
      wire = this.wire(payload);
    } catch {
      return;
    }
    const key = `${source.group}/${source.edgeNode}`;
    let node = this.nodes.get(key);
    if (source.messageType === 'NBIRTH' || !node) {
      // A node birth starts a new session for the node and all of its devices.
      if (node) this.aliasCount -= this.count(node);
      if (!node && this.nodes.size >= MAX_NODES) return;
      node = { node: new Map(), devices: new Map() };
      this.nodes.set(key, node);
    }
    const aliases = new Map<string, Known>();
    for (const metric of wire.metrics ?? []) {
      if (metric.alias === undefined || metric.name === undefined) continue;
      if (this.aliasCount >= MAX_ALIASES) break;
      aliases.set(String(metric.alias), {
        name: metric.name,
        datatype: metric.datatype ?? FIELD_TYPES[metric.value] ?? 0,
      });
      this.aliasCount++;
    }
    if (source.device) {
      this.aliasCount -= node.devices.get(source.device)?.size ?? 0;
      node.devices.set(source.device, aliases);
    } else node.node = aliases;
  }

  private count(node: NodeAliases): number {
    let total = node.node.size;
    for (const aliases of node.devices.values()) total += aliases.size;
    return total;
  }

  private lookup(source: SparkplugTopic | undefined, alias: unknown): Known | undefined {
    if (!source || alias === undefined) return undefined;
    const node = this.nodes.get(`${source.group}/${source.edgeNode}`);
    if (!node) return undefined;
    return (
      (source.device && node.devices.get(source.device)?.get(String(alias))) ||
      node.node.get(String(alias))
    );
  }

  /** The payload with metrics keyed by name; throws when the bytes are not a Sparkplug payload. */
  decode(topic: string, payload: Uint8Array): Record<string, unknown> {
    const wire = this.wire(payload);
    const source = parseSparkplugTopic(topic);
    return {
      ...(wire.timestamp !== undefined && { timestamp: integer(BigInt(wire.timestamp)) }),
      ...(wire.seq !== undefined && { seq: integer(BigInt(wire.seq)) }),
      ...(wire.uuid !== undefined && { uuid: wire.uuid }),
      metrics: metricMap(
        (wire.metrics ?? []).map((metric: Wire) =>
          readMetric(
            metric,
            metric.name === undefined ? this.lookup(source, metric.alias) : undefined,
          ),
        ),
      ),
      ...(wire.body !== undefined && { body: wire.body }),
    };
  }

  /** Values for plotting: metrics first, so the first plottable field is a metric value. */
  values(topic: string, payload: Uint8Array): unknown {
    try {
      const { metrics, timestamp, seq } = this.decode(topic, payload) as {
        metrics: Record<string, DecodedMetric>;
        timestamp?: number;
        seq?: number;
      };
      const number = (value: unknown) =>
        typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value;
      return {
        metrics: Object.fromEntries(
          Object.entries(metrics).map(([name, metric]) => [
            name,
            {
              value: number(metric.value),
              ...(metric.timestamp !== undefined && { timestamp: number(metric.timestamp) }),
            },
          ]),
        ),
        timestamp,
        seq,
      };
    } catch {
      return undefined;
    }
  }

  encode(payload: SparkplugOutgoingPayload): Uint8Array {
    const metrics = payload.metrics.map((metric) => {
      const datatype = TYPE[metric.type];
      const wire: Wire = { datatype };
      if (metric.alias !== undefined) wire.alias = metric.alias;
      if (metric.alias === undefined || metric.name) wire.name = metric.name;
      if (metric.timestamp !== undefined) wire.timestamp = metric.timestamp;
      const value = metric.value;
      if (value === null) wire.is_null = true;
      else if (metric.type === 'Boolean') wire.boolean_value = value;
      else if (metric.type === 'Float') wire.float_value = value;
      else if (metric.type === 'Double') wire.double_value = value;
      else if (metric.type === 'String' || metric.type === 'Text') wire.string_value = value;
      else if (['Int64', 'UInt64', 'DateTime'].includes(metric.type))
        // Negative Int64 values are sent as their two's complement.
        wire.long_value = BigInt.asUintN(64, BigInt(value as number | string)).toString();
      else wire.int_value = Number(BigInt.asUintN(32, BigInt(value as number | string)));
      return wire;
    });
    const message = this.type.fromObject({
      ...(payload.timestamp !== undefined && { timestamp: payload.timestamp }),
      ...(payload.seq !== undefined && { seq: payload.seq }),
      metrics,
    });
    return this.type.encode(message).finish();
  }
}
