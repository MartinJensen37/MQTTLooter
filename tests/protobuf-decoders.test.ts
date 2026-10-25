import protobuf from 'protobufjs';
import { expect, it } from 'vitest';
import { ProtobufDecoders, protoTypes } from '../src/main/protobuf-decoders';
import { matchDecoder, validateDecoders } from '../src/shared/decoders';

const proto = `
syntax = "proto3";
package demo;
message Reading {
  string id = 1;
  double value = 2;
  int64 count = 3;
  bytes raw = 4;
  enum Mode { AUTO = 0; MANUAL = 1; }
  Mode mode = 5;
  repeated Reading children = 6;
}
message Empty {}
`;
const definition = {
  id: 'reading',
  name: 'Reading',
  topicFilter: 'plant/+/reading',
  messageType: 'demo.Reading',
  proto,
};
const encode = (value: object) => {
  const type = protobuf.parse(proto).root.lookupType('demo.Reading');
  return type.encode(type.fromObject(value)).finish();
};

it('lists message types and decodes with exact 64-bit integers, base64 bytes and enum names', () => {
  expect(protoTypes(proto)).toEqual(['demo.Reading', 'demo.Empty']);
  const decoders = new ProtobufDecoders();
  expect(decoders.configure([definition])).toEqual({});
  const decoded = JSON.parse(
    decoders.decode(
      'reading',
      encode({
        id: 'pump-1',
        value: 1.5,
        count: '9007199254740993',
        raw: Buffer.from([0, 255]),
        mode: 1,
        children: [{ id: 'child' }],
      }),
    ),
  );
  expect(decoded).toEqual({
    id: 'pump-1',
    value: 1.5,
    count: '9007199254740993',
    raw: 'AP8=',
    mode: 'MANUAL',
    children: [{ id: 'child' }],
  });
});

it('reports schema, type and payload errors without throwing away other decoders', () => {
  const decoders = new ProtobufDecoders();
  const errors = decoders.configure([
    definition,
    { ...definition, id: 'broken', name: 'Broken', proto: 'message X { int32 a = ; }' },
    { ...definition, id: 'missing', name: 'Missing', messageType: 'demo.Nope' },
  ]);
  expect(Object.keys(errors)).toEqual(['broken', 'missing']);
  expect(errors.broken).toMatch(/^Broken: .*line/);
  expect(() => decoders.decode('broken', new Uint8Array())).toThrow('not available');
  expect(() => decoders.decode('reading', Uint8Array.of(0x0a, 0xff))).toThrow('does not match');
  expect(() => decoders.decode('reading', new Uint8Array(1024 * 1024 + 1))).toThrow('too large');
  expect(decoders.decode('reading', new Uint8Array())).toBe('{}');
});

it('validates definitions and matches topics in list order', () => {
  expect(() => validateDecoders([definition, definition])).toThrow('unique id');
  expect(() => validateDecoders([{ ...definition, topicFilter: 'a/#/b' }])).toThrow('filter');
  expect(() => validateDecoders([{ ...definition, proto: ' ' }])).toThrow();
  expect(() => validateDecoders(Array(33).fill(definition))).toThrow('32');
  const list = validateDecoders([definition, { ...definition, id: 'all', topicFilter: 'plant/#' }]);
  expect(matchDecoder(list, 'plant/7/reading')?.id).toBe('reading');
  expect(matchDecoder(list, 'plant/7/status')?.id).toBe('all');
  expect(matchDecoder(list, 'other')).toBeUndefined();
});

it('plots decoded fields from stored protobuf payloads, including zero values', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { HistoryDatabase } = await import('../src/main/history-database');
  const decoders = new ProtobufDecoders();
  decoders.configure([definition]);
  expect(decoders.decodeValues('reading', encode({ id: 'z' }))).toMatchObject({
    id: 'z',
    value: 0,
    count: 0,
  });
  expect(decoders.decodeValues('reading', Uint8Array.of(0x0a, 0xff))).toBeUndefined();
  expect(decoders.decodeValues('missing', new Uint8Array())).toBeUndefined();

  const directory = mkdtempSync(join(tmpdir(), 'mqtt-decoded-plot-'));
  const database = new HistoryDatabase(join(directory, 'history.sqlite'));
  try {
    const now = Date.now();
    database.append(
      [0, 5, 0, 7].map((value, index) => ({
        id: 'broker',
        sessionId: 's',
        sequence: index + 1,
        topic: 'plant/1/reading',
        message: Buffer.from(encode({ id: 'p', value, count: index })).toString('base64'),
        encoding: 'base64' as const,
        byteLength: 0,
        timestamp: now - 4000 + index * 1000,
        qos: 0,
        retain: false,
        protocolVersion: 5,
      })),
      now,
    );
    const query = {
      connectionId: 'broker',
      topic: 'plant/1/reading',
      paths: [['value']],
      from: now - 10_000,
      to: now,
      maxPoints: 64,
    };
    const series = database.series(query, (payload) =>
      payload ? decoders.decodeValues('reading', payload) : undefined,
    );
    expect(series.series[0].points.map((point) => point.y)).toEqual([0, 5, 0, 7]);
    expect(series.availablePaths).toContainEqual(['count']);
    // Without the decoder the same bytes are not numeric.
    expect(database.series(query).series[0].valid).toBe(0);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('searches decoded protobuf text and counts payloads that do not decode', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { HistoryDatabase } = await import('../src/main/history-database');
  const decoders = new ProtobufDecoders();
  decoders.configure([definition]);
  const directory = mkdtempSync(join(tmpdir(), 'mqtt-decoded-search-'));
  const database = new HistoryDatabase(join(directory, 'history.sqlite'));
  try {
    const now = Date.now();
    const payloads: [string, Uint8Array][] = [
      ['plant/1/reading', encode({ id: 'pump-1', count: '9007199254740993' })],
      ['plant/2/reading', encode({ id: 'pump-2' })],
      ['plant/3/reading', Uint8Array.of(0x0a, 0xff)],
      ['other/topic', encode({ id: 'pump-1' })],
    ];
    database.append(
      payloads.map(([topic, bytes], index) => ({
        id: 'broker',
        sessionId: 's',
        sequence: index + 1,
        topic,
        message: Buffer.from(bytes).toString('base64'),
        encoding: 'base64' as const,
        byteLength: bytes.byteLength,
        timestamp: now,
        qos: 0,
        retain: false,
        protocolVersion: 5,
      })),
      now,
    );
    const decode = (topic: string, payload: Uint8Array) => {
      const decoder = matchDecoder([definition], topic);
      if (!decoder) return undefined;
      try {
        return decoders.decode(decoder.id, payload);
      } catch {
        return undefined;
      }
    };
    const search = (term: string) =>
      database.search(
        {
          connectionId: 'broker',
          topic: '',
          scope: 'filter',
          filter: '#',
          mode: 'decoded',
          term,
          from: now - 1000,
          to: now,
        },
        now,
        decode,
      );
    // The exact 64-bit value exists only in the decoded text, not in the bytes.
    const exact = search('"9007199254740993"');
    expect(exact.messages.map((message) => message.topic)).toEqual(['plant/1/reading']);
    // Undecodable payloads and topics without a decoder are counted, not matched.
    expect(exact.skippedBinary).toBe(2);
    expect(search('pump-2').messages.map((message) => message.topic)).toEqual(['plant/2/reading']);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
