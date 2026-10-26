import protobuf from 'protobufjs';
import { describe, expect, it } from 'vitest';
import { SparkplugCodec, SPARKPLUG_PROTO } from '../src/main/sparkplug';
import { ProtobufDecoders } from '../src/main/protobuf-decoders';
import {
  isSparkplugBirth,
  parseSparkplugTopic,
  parseSparkplugValue,
  SPARKPLUG_DECODER,
  SPARKPLUG_DECODER_ID,
  sparkplugTopic,
  validateSparkplugPayload,
} from '../src/shared/sparkplug';
import { matchDecoder } from '../src/shared/decoders';

// Raw Tahu payloads, as other Sparkplug clients write them.
const Payload = protobuf
  .parse(SPARKPLUG_PROTO, { keepCase: true })
  .root.lookupType('org.eclipse.tahu.protobuf.Payload');
const raw = (value: object) => Payload.encode(Payload.fromObject(value)).finish();
const BIRTH = 'spBv1.0/Plant/NBIRTH/Edge1';
const DATA = 'spBv1.0/Plant/NDATA/Edge1';

describe('topics', () => {
  it('parses node and device topics and rejects others', () => {
    expect(parseSparkplugTopic('spBv1.0/Plant/DDATA/Edge1/Pump')).toEqual({
      group: 'Plant',
      messageType: 'DDATA',
      edgeNode: 'Edge1',
      device: 'Pump',
    });
    expect(parseSparkplugTopic(BIRTH)).toEqual({
      group: 'Plant',
      messageType: 'NBIRTH',
      edgeNode: 'Edge1',
    });
    for (const topic of [
      'spBv1.0/STATE/host',
      'spBv1.0/Plant/NDATA/Edge1/Pump',
      'spBv1.0/Plant/DDATA/Edge1',
      'spBv1.0/Plant/FOO/Edge1',
      'spBv1.0//NDATA/Edge1',
      'plant/NDATA/Edge1',
    ])
      expect(parseSparkplugTopic(topic)).toBeUndefined();
    expect(sparkplugTopic(parseSparkplugTopic('spBv1.0/Plant/DCMD/Edge1/Pump')!)).toBe(
      'spBv1.0/Plant/DCMD/Edge1/Pump',
    );
    expect(isSparkplugBirth('spBv1.0/Plant/DBIRTH/Edge1/Pump')).toBe(true);
    expect(isSparkplugBirth(DATA)).toBe(false);
  });

  it('matches the built-in decoder after saved ones and never for STATE', () => {
    const own = { ...SPARKPLUG_DECODER, id: 'own', topicFilter: 'spBv1.0/Plant/#' };
    expect(matchDecoder([SPARKPLUG_DECODER], DATA)?.id).toBe(SPARKPLUG_DECODER_ID);
    expect(matchDecoder([own, SPARKPLUG_DECODER], DATA)?.id).toBe('own');
    expect(matchDecoder([SPARKPLUG_DECODER], 'spBv1.0/STATE/host')).toBeUndefined();
  });
});

describe('decoding', () => {
  it('names aliased data metrics from the latest birth and reads their declared types', () => {
    const codec = new SparkplugCodec();
    codec.observe(
      BIRTH,
      raw({
        timestamp: 1000,
        seq: 0,
        metrics: [
          { name: 'bdSeq', alias: 0, datatype: 8, long_value: 3 },
          { name: 'Temperature', alias: 1, datatype: 9, float_value: 20.5 },
          { name: 'Offset', alias: 2, datatype: 1, int_value: 0 },
        ],
      }),
    );
    const data = raw({
      timestamp: 2000,
      seq: 1,
      metrics: [
        { alias: 1, float_value: 0.1 },
        // Int8 -5 travels as a sign-extended uint32.
        { alias: 2, int_value: 0xfffffffb },
        { alias: 9, int_value: 7 },
      ],
    });
    expect(codec.decode(DATA, data)).toEqual({
      timestamp: 2000,
      seq: 1,
      metrics: {
        Temperature: { value: 0.1, type: 'Float', alias: 1 },
        Offset: { value: -5, type: 'Int8', alias: 2 },
        'Alias 9': { value: 7, type: 'UInt32', alias: 9 },
      },
    });
    // Another edge node, or no birth yet: aliases stay unnamed.
    expect(Object.keys(codec.decode('spBv1.0/Plant/NDATA/Edge2', data).metrics as object)).toEqual([
      'Alias 1',
      'Alias 2',
      'Alias 9',
    ]);
    // A new node birth replaces the old names.
    codec.observe(BIRTH, raw({ metrics: [{ name: 'Pressure', alias: 1, datatype: 10 }] }));
    expect(Object.keys(codec.decode(DATA, data).metrics as object)[0]).toBe('Pressure');
  });

  it('resolves device aliases before node aliases', () => {
    const codec = new SparkplugCodec();
    codec.observe(BIRTH, raw({ metrics: [{ name: 'Node metric', alias: 5, datatype: 3 }] }));
    codec.observe(
      'spBv1.0/Plant/DBIRTH/Edge1/Pump',
      raw({ metrics: [{ name: 'Speed', alias: 6, datatype: 10 }] }),
    );
    const metrics = codec.decode(
      'spBv1.0/Plant/DDATA/Edge1/Pump',
      raw({
        metrics: [
          { alias: 6, double_value: 1.5 },
          { alias: 5, int_value: 1 },
        ],
      }),
    ).metrics;
    expect(Object.keys(metrics as object)).toEqual(['Speed', 'Node metric']);
  });

  it('reads 64-bit, date, null, bytes, array, data set, template and property values', () => {
    const codec = new SparkplugCodec();
    const floats = new DataView(new ArrayBuffer(8));
    floats.setFloat32(0, 1.5, true);
    floats.setFloat32(4, -2, true);
    const metrics = codec.decode(
      DATA,
      raw({
        metrics: [
          { name: 'Big', datatype: 4, long_value: '18446744073709551615' },
          { name: 'Huge', datatype: 8, long_value: '18446744073709551615' },
          { name: 'When', datatype: 13, long_value: 1700000000000 },
          { name: 'Missing', datatype: 9, is_null: true },
          { name: 'Raw', datatype: 17, bytes_value: Buffer.from([1, 2]) },
          { name: 'Floats', datatype: 30, bytes_value: new Uint8Array(floats.buffer) },
          // Count 3, then bits 101 packed from the most significant bit.
          { name: 'Flags', datatype: 32, bytes_value: Buffer.from([3, 0, 0, 0, 0b10100000]) },
          { name: 'Names', datatype: 33, bytes_value: Buffer.from('a\0bc\0') },
          {
            name: 'Table',
            datatype: 16,
            dataset_value: {
              num_of_columns: 2,
              columns: ['id', 'ok'],
              types: [3, 11],
              rows: [{ elements: [{ int_value: 0xffffffff }, { boolean_value: true }] }],
            },
          },
          {
            name: 'Motor',
            datatype: 19,
            template_value: {
              template_ref: 'MotorType',
              parameters: [{ name: 'Rating', type: 10, double_value: 5.5 }],
              metrics: [{ name: 'RPM', datatype: 7, int_value: 1500 }],
            },
          },
          {
            name: 'Tagged',
            datatype: 3,
            int_value: 1,
            properties: {
              keys: ['engUnit', 'quality'],
              values: [
                { type: 12, string_value: 'C' },
                { type: 3, int_value: 192 },
              ],
            },
            is_historical: true,
          },
        ],
      }),
    ).metrics as Record<string, { value: unknown }>;
    expect(metrics.Big.value).toBe(-1);
    expect(metrics.Huge.value).toBe('18446744073709551615');
    expect(metrics.When.value).toBe(1700000000000);
    expect(metrics.Missing.value).toBeNull();
    expect(metrics.Raw.value).toBe('AQI=');
    expect(metrics.Floats.value).toEqual([1.5, -2]);
    expect(metrics.Flags.value).toEqual([true, false, true]);
    expect(metrics.Names.value).toEqual(['a', 'bc']);
    expect(metrics.Table.value).toEqual({
      columns: ['id', 'ok'],
      types: ['Int32', 'Boolean'],
      rows: [[-1, true]],
    });
    expect(metrics.Motor.value).toEqual({
      templateRef: 'MotorType',
      parameters: { Rating: 5.5 },
      metrics: { RPM: { value: 1500, type: 'UInt32' } },
    });
    expect(metrics.Tagged).toEqual({
      value: 1,
      type: 'Int32',
      historical: true,
      properties: { engUnit: 'C', quality: 192 },
    });
  });

  it('keeps repeated names and gives plots metrics first', () => {
    const codec = new SparkplugCodec();
    const payload = raw({
      timestamp: 5,
      seq: 2,
      metrics: [
        { name: 'Level', datatype: 10, double_value: 1, timestamp: 3 },
        { name: 'Level', datatype: 10, double_value: 2, timestamp: 4 },
        { name: 'Count', datatype: 8, long_value: 12 },
      ],
    });
    expect(Object.keys(codec.decode(DATA, payload).metrics as object)).toEqual([
      'Level',
      'Level [2]',
      'Count',
    ]);
    const values = codec.values(DATA, payload) as Record<string, unknown>;
    expect(Object.keys(values)[0]).toBe('metrics');
    expect(values).toMatchObject({
      metrics: { Level: { value: 1, timestamp: 3 }, Count: { value: 12 } },
      timestamp: 5,
      seq: 2,
    });
    expect(codec.values(DATA, new Uint8Array([0xff, 0xff]))).toBeUndefined();
  });

  it('runs under the built-in decoder id, with the topic for aliases', () => {
    const decoders = new ProtobufDecoders();
    decoders.configure([]);
    decoders.sparkplug.observe(BIRTH, raw({ metrics: [{ name: 'Speed', alias: 1, datatype: 3 }] }));
    const data = raw({ metrics: [{ alias: 1, int_value: 9 }] });
    expect(JSON.parse(decoders.decode(SPARKPLUG_DECODER_ID, data, DATA)).metrics.Speed.value).toBe(
      9,
    );
    expect(decoders.decodeValues(SPARKPLUG_DECODER_ID, data, DATA)).toMatchObject({
      metrics: { Speed: { value: 9 } },
    });
    expect(() => decoders.decode(SPARKPLUG_DECODER_ID, new Uint8Array([0xff]), DATA)).toThrow(
      /Sparkplug B payload/,
    );
  });
});

describe('encoding', () => {
  it('writes commands other clients read back with the declared types', () => {
    const codec = new SparkplugCodec();
    const bytes = codec.encode(
      validateSparkplugPayload({
        timestamp: 1700000000000,
        metrics: [
          { name: 'Node Control/Rebirth', type: 'Boolean', value: true },
          { name: 'Setpoint', type: 'Float', value: 0.1 },
          { name: 'Delta', type: 'Int16', value: -2 },
          { name: 'Total', type: 'Int64', value: '-9223372036854775808' },
          { name: 'Label', type: 'String', value: 'run' },
          { name: 'Unset', type: 'Double', value: null },
          { name: 'Fast', alias: 4, type: 'UInt32', value: 4294967295 },
        ],
      }),
    );
    const wire = Payload.toObject(Payload.decode(bytes), { longs: String });
    expect(wire.metrics[0]).toMatchObject({
      name: 'Node Control/Rebirth',
      datatype: 11,
      boolean_value: true,
    });
    // Sign-extended to 32 bits, as the Tahu Java and JavaScript libraries write it.
    expect(wire.metrics[2].int_value).toBe(0xfffffffe);
    expect(wire.metrics[3].long_value).toBe('9223372036854775808');
    expect(codec.decode('spBv1.0/Plant/NCMD/Edge1', bytes)).toMatchObject({
      timestamp: 1700000000000,
      metrics: {
        'Node Control/Rebirth': { value: true, type: 'Boolean' },
        Setpoint: { value: 0.1, type: 'Float' },
        Delta: { value: -2, type: 'Int16' },
        Total: { value: '-9223372036854775808', type: 'Int64' },
        Label: { value: 'run', type: 'String' },
        Unset: { value: null, type: 'Double' },
        Fast: { value: 4294967295, type: 'UInt32', alias: 4 },
      },
    });
  });

  it('validates payloads and typed values', () => {
    expect(() =>
      validateSparkplugPayload({ metrics: [{ name: 'x', type: 'Int8', value: 200 }] }),
    ).toThrow(/Int8/);
    expect(() =>
      validateSparkplugPayload({ metrics: [{ name: 'x', type: 'DataSet', value: 1 }] }),
    ).toThrow();
    expect(() => validateSparkplugPayload({ seq: 256, metrics: [] })).toThrow();
    expect(parseSparkplugValue('Boolean', 'TRUE')).toEqual({ value: true });
    expect(parseSparkplugValue('UInt64', '18446744073709551615')).toEqual({
      value: '18446744073709551615',
    });
    expect(parseSparkplugValue('Int32', '12')).toEqual({ value: 12 });
    expect(parseSparkplugValue('Double', 'abc')).toHaveProperty('error');
    expect(parseSparkplugValue('UInt8', '-1')).toHaveProperty('error');
  });
});
