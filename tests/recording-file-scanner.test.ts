import { expect, it } from 'vitest';
import { RecordingFileScanner } from '../src/main/recording-file-scanner';

const file = {
  recordingInfo: {
    name: 'Pump "A" {test}',
    startTime: '2026-10-25T10:00:00.000Z',
    endTime: '2026-10-25T10:01:00.000Z',
    gaps: [{ at: 1, until: null }],
  },
  version: 2,
  flag: true,
  nothing: null,
  messages: [
    { timestamp: 1, topic: 'a/b', payload: '{"x":[1,2]}', qos: 1 },
    { timestamp: 2, topic: 'c', payload: 'quote \\" brace } bracket ] é', retain: true },
    { timestamp: 3, topic: 'd', payload: '', properties: { userProperties: { k: ['v'] } } },
  ],
  trailing: 'after messages',
};

const scan = (text: string, chunk: number) => {
  const scanner = new RecordingFileScanner();
  const messages: unknown[] = [];
  for (let index = 0; index < text.length; index += chunk)
    messages.push(...scanner.feed(text.slice(index, index + chunk)));
  scanner.end();
  return { messages, fields: scanner.fields, count: scanner.messages };
};

it('returns each message and the other fields, whatever the chunk boundaries', () => {
  for (const text of [JSON.stringify(file), JSON.stringify(file, null, 2)]) {
    const expected = {
      messages: file.messages,
      fields: { ...file, messages: undefined },
      count: 3,
    };
    delete (expected.fields as Record<string, unknown>).messages;
    for (const chunk of [1, 2, 3, 7, 64, text.length]) expect(scan(text, chunk)).toEqual(expected);
  }
  expect(scan('{}', 1)).toEqual({ messages: [], fields: {}, count: 0 });
  expect(scan('{"messages":[]}', 1).count).toBe(0);
});

it('rejects malformed, truncated and oversized files', () => {
  const full = JSON.stringify(file);
  for (const text of [
    full.slice(0, -1),
    full.slice(0, full.indexOf('"timestamp":2')),
    '[1,2]',
    '{"messages":[1]}',
    '{"a":1,}',
    `${full}x`,
    '{"a" 1}',
  ])
    expect(() => scan(text, 5), text.slice(0, 40)).toThrow();
  expect(() =>
    scan(JSON.stringify({ messages: [{ payload: 'x'.repeat(1024 * 1024) }] }), 4096),
  ).toThrow('1 MiB');
});
