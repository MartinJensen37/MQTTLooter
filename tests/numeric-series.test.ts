import { expect, it } from 'vitest';
import {
  fieldPointer,
  pointerPath,
  numericPayload,
  numericField,
  NumericSampler,
} from '../src/shared/numeric-series';

const bytes = (value: string) => new TextEncoder().encode(value);
const query = {
  connectionId: 'a',
  topic: 't',
  from: 0,
  to: 1000,
  maxPoints: 16,
  paths: [[]] as string[][],
};

it('extracts finite numbers without coercing strings, null, booleans or invalid UTF-8', () => {
  for (const value of ['0', '-2', '1e3', '.5', '+12'])
    expect(numericField(numericPayload(bytes(value)), [])).toBe(Number(value));
  for (const value of ['', 'null', 'false', '"12"', 'NaN', 'Infinity', '1e400', '0x20', 'nope'])
    expect(numericField(numericPayload(bytes(value)), [])).toBeNull();
  expect(numericPayload(new Uint8Array([255, 49]))).toBeUndefined();
  expect(numericPayload(bytes(' '.repeat(65536) + '1'))).toBeUndefined();
  const value = numericPayload(bytes('{"a/b":{"~c":[0,2]},"x.y":3}'));
  expect(numericField(value, pointerPath('/a~1b/~0c/0'))).toBe(0);
  expect(numericField(value, ['x.y'])).toBe(3);
  expect(numericField(value, ['constructor'])).toBeNull();
  expect(fieldPointer(['a/b', '~c', ''])).toBe('/a~1b/~0c/');
  expect(pointerPath('/')).toEqual(['']);
  expect(() => pointerPath('/bad~2')).toThrow();
  expect(() => pointerPath('a.b')).toThrow();
});

it('preserves short extrema in bounded chronological samples with duplicate timestamps', () => {
  const sampler = new NumericSampler(query);
  for (let i = 1999; i >= 0; i--)
    sampler.add(Math.floor(i / 2), i, 'one', bytes(String(i === 999 ? 100 : i === 998 ? -90 : 1)));
  const result = sampler.result();
  expect(result.scanned).toBe(2000);
  expect(result.series[0].valid).toBe(2000);
  const points = result.series[0].points;
  expect(points.length).toBeLessThanOrEqual(16);
  expect(points.map((point) => point.y)).toContain(100);
  expect(points.map((point) => point.y)).toContain(-90);
  expect(points.map((point) => point.x)).toEqual(
    points.map((point) => point.x).sort((a, b) => a - b),
  );
});

it('breaks lines around invalid samples and reconnects, in either scan direction', () => {
  for (const reverse of [false, true]) {
    const sampler = new NumericSampler({ ...query, maxPoints: 100 });
    const samples = [
      [0, '1', 'a'],
      [100, '2', 'a'],
      [200, 'null', 'a'],
      [300, '3', 'a'],
      [400, '4', 'b'],
      [500, '5', 'b'],
    ] as const;
    for (const [x, value, session] of reverse ? [...samples].reverse() : samples)
      sampler.add(x, x, session, bytes(value));
    const series = sampler.result().series[0];
    expect(series.gaps).toBe(1);
    expect(series.points.find((point) => point.x === 300)?.breakBefore).toBe(true);
    expect(series.points.find((point) => point.x === 400)?.breakBefore).toBe(true);
    expect(series.points.map((point) => point.y)).not.toContain(0);
  }
});

it('discovers bounded JSON paths and leaves missing field values as gaps', () => {
  const sampler = new NumericSampler({ ...query, paths: [['a/b'], ['values', '0']] });
  sampler.add(0, 1, 'a', bytes('{"a/b":4,"values":[0]}'));
  sampler.add(300, 2, 'a', bytes('{"values":["1"]}'));
  sampler.add(500, 3, 'a', bytes('{"a/b":5,"values":[2]}'));
  expect(sampler.result().availablePaths.map(fieldPointer)).toEqual(['/a~1b', '/values/0']);
  expect(sampler.result().series[1].points.map((point) => point.y)).toEqual([0, 2]);
  expect(sampler.result().series[1].points[1].breakBefore).toBe(true);
});
