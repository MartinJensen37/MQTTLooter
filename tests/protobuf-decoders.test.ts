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
