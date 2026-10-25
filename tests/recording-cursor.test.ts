import { expect, it, vi } from 'vitest';
import { RecordingCursor } from '../src/renderer/src/services/RecordingCursor';
import type { RecordingPage, StoredRecordingMessage } from '../src/shared/recording';

const messages = (count: number): StoredRecordingMessage[] =>
  Array.from({ length: count }, (_, i) => ({
    seq: (i + 1) * 2, // Filtered sequences need not be contiguous.
    topic: 't',
    message: String(i),
    encoding: 'utf8',
    timestamp: i,
    qos: 0,
    retain: false,
  }));

/** Pages like main: ascending, with a cursor; `sparse` adds empty partial pages. */
const loader = (data: StoredRecordingMessage[], sparse = false) =>
  vi.fn(async ({ after, before, limit }): Promise<RecordingPage> => {
    if (before !== undefined) {
      const earlier = data.filter((m) => m.seq < before);
      const page = earlier.slice(-limit);
      return { messages: page, cursor: earlier.length > limit ? page[0].seq : null };
    }
    const later = data.filter((m) => m.seq > (after ?? 0));
    if (sparse && later.length && (after ?? 0) % 4 === 0)
      return { messages: [], cursor: (after ?? 0) + 1 };
    const page = later.slice(0, limit);
    return { messages: page, cursor: later.length > limit ? page.at(-1)!.seq : null };
  });

it('reads by index across pages, steps back and restarts for far jumps', async () => {
  const data = messages(5000);
  const load = loader(data);
  const cursor = new RecordingCursor(load);
  expect((await cursor.at(0))?.message).toBe('0');
  for (let i = 0; i < 4000; i++) expect((await cursor.at(i))?.seq).toBe(data[i].seq);
  // The window was trimmed; short backward steps page backwards.
  expect((await cursor.at(3980))?.message).toBe('3980');
  expect((await cursor.at(1200))?.message).toBe('1200');
  expect((await cursor.at(0))?.message).toBe('0');
  expect(await cursor.at(5000)).toBeUndefined();
  expect(await cursor.at(-1)).toBeUndefined();
  expect(load.mock.calls.length).toBeLessThan(80);
});

it('continues through partial pages and sees messages appended to an active capture', async () => {
  const data = messages(10);
  const cursor = new RecordingCursor(loader(data, true));
  expect((await cursor.at(9))?.message).toBe('9');
  expect(await cursor.at(10)).toBeUndefined();
  data.push({ ...data[0], seq: 100, message: 'late' });
  expect((await cursor.at(10))?.message).toBe('late');
});

it('serializes concurrent reads', async () => {
  const cursor = new RecordingCursor(loader(messages(600)));
  const results = await Promise.all([cursor.at(500), cursor.at(1), cursor.at(300)]);
  expect(results.map((m) => m?.message)).toEqual(['500', '1', '300']);
});
