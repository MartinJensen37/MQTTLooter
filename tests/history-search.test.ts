import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { HistoryDatabase } from '../src/main/history-database';
import {
  SEARCH_LIMITS,
  validateSearch,
  type HistorySearchQuery,
} from '../src/shared/history-search';
import type { IncomingPublish } from '../src/shared/traffic';

let database: HistoryDatabase;
let directory: string;
const now = Date.now();
const query: HistorySearchQuery = {
  connectionId: 'broker',
  topic: 'a//b',
  mode: 'text',
  term: 'needle',
  from: now - 3600000,
  to: now,
};
const message = (sequence: number, text = 'needle'): IncomingPublish => ({
  id: 'broker',
  sessionId: 'one',
  sequence,
  topic: 'a//b',
  message: text,
  encoding: 'utf8',
  byteLength: Buffer.byteLength(text),
  timestamp: now,
  qos: 1,
  retain: false,
  protocolVersion: 5,
});
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'mqtt-search-'));
  database = new HistoryDatabase(join(directory, 'test.sqlite'));
});
afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});
function collect(initial = query) {
  let cursor = initial;
  const messages: IncomingPublish[] = [];
  let scanned = 0;
  for (let i = 0; i < 1000; i++) {
    const page = database.search(cursor, now);
    expect(page.scanned).toBeLessThanOrEqual(SEARCH_LIMITS.rows);
    expect(page.messages.length).toBeLessThanOrEqual(SEARCH_LIMITS.matches);
    messages.push(...page.messages);
    scanned += page.scanned;
    if (page.nextBefore === null) return { messages, scanned };
    expect(page.nextBefore).toBeLessThan(cursor.before ?? Infinity);
    cursor = {
      ...cursor,
      before: page.nextBefore,
      snapshot: page.snapshot,
      generation: page.generation,
    };
  }
  throw new Error('Search did not terminate');
}

it('finds sparse matches beyond loaded pages and bounds scans even when time filters reject every row', () => {
  database.append(
    Array.from({ length: 4500 }, (_, i) => message(i + 1, i === 0 ? 'needle' : 'other')),
    now,
  );
  const first = database.search(query, now);
  expect(first.messages).toEqual([]);
  expect(first.nextBefore).not.toBeNull();
  const result = collect();
  expect(result.messages.map((message) => message.sequence)).toEqual([1]);
  expect(result.scanned).toBe(4500);
  const empty = collect({ ...query, to: now - 1 });
  expect(empty.messages).toEqual([]);
  expect(empty.scanned).toBe(4500);
});

it('paginates matching bursts without duplicates, excludes new arrivals and invalidates cleared cursors', () => {
  database.append(
    Array.from({ length: 350 }, (_, i) => message(i + 1)),
    now,
  );
  const first = database.search(query, now);
  database.append([message(351)], now);
  const rest = collect({
    ...query,
    before: first.nextBefore!,
    snapshot: first.snapshot,
    generation: first.generation,
  });
  const sequences = [...first.messages, ...rest.messages].map((message) => message.sequence);
  expect(sequences).toEqual(Array.from({ length: 350 }, (_, i) => 350 - i));
  database.clear('broker', 'a//b');
  expect(() => database.search({ ...query, generation: first.generation }, now)).toThrow('cleared');
});

it('uses literal case-sensitive UTF-8 matching and explicit raw byte matching', () => {
  database.append(
    [
      message(1, 'Needle'),
      message(2, 'needle'),
      message(3, 'Å.%_🛰️'),
      { ...message(4), message: 'AP+A', encoding: 'base64' },
      message(5, '\uFEFFneedle'),
      { ...message(6), topic: 'a/b' },
      { ...message(7), id: 'other' },
    ],
    now,
  );
  const text = database.search(query, now);
  expect(text.messages.map((message) => message.sequence)).toEqual([5, 2]);
  expect(text.skippedBinary).toBe(1);
  expect(collect({ ...query, term: '.%_🛰️' }).messages.map((message) => message.sequence)).toEqual([
    3,
  ]);
  const hex = database.search({ ...query, mode: 'hex', term: '00 ff 80' }, now);
  expect(hex.messages[0]).toMatchObject({ sequence: 4, message: 'AP+A', encoding: 'base64' });
  expect(
    collect({ ...query, mode: 'hex', term: '6e 65 65 64 6c 65' }).messages.map(
      (message) => message.sequence,
    ),
  ).toEqual([5, 2]);
});

it('reports oversized records and resumes at byte boundaries without dropping matching rows', () => {
  database.append(
    [
      message(1, 'needle' + 'x'.repeat(SEARCH_LIMITS.payloadBytes)),
      ...Array.from({ length: 12 }, (_, i) => message(i + 2, 'needle' + 'x'.repeat(200000))),
    ],
    now,
  );
  const result = collect();
  expect(result.messages.map((message) => message.sequence)).toEqual(
    Array.from({ length: 12 }, (_, i) => 13 - i),
  );
  const oldest = database.search({ ...query, before: 2 }, now);
  expect(oldest.skippedLarge).toBe(1);
  expect(oldest.messages).toEqual([]);
});

it('rejects malformed requests at the shared boundary', () => {
  for (const changes of [
    { term: '' },
    { term: 'a'.repeat(1025) },
    { mode: 'regex' },
    { mode: 'hex', term: 'a' },
    { mode: 'hex', term: 'zz' },
    { mode: 'hex', term: '  ' },
    { before: -1 },
    { snapshot: NaN },
    { from: now + 1 },
    { from: 0 },
  ])
    expect(() => validateSearch({ ...query, ...changes } as HistorySearchQuery)).toThrow();
  expect(() => validateSearch({ ...query, mode: 'hex', term: '00\tff 80' })).not.toThrow();
});
