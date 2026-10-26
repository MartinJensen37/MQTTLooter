import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { HistoryDatabase } from '../src/main/history-database';
import { DISK_HISTORY, type HistoryMessage } from '../src/shared/history';
import { SEARCH_LIMITS, type HistorySearchQuery } from '../src/shared/history-search';
import type { IncomingPublish } from '../src/shared/traffic';

let directory: string;
let database: HistoryDatabase;
const now = Date.now();
const MIB = 1024 * 1024;
const store = (sequence: number, bytes: Uint8Array, topic = 'big') => {
  const text = (() => {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return null;
    }
  })();
  const message: IncomingPublish = {
    id: 'broker',
    sessionId: 's',
    sequence,
    topic,
    message: text ?? Buffer.from(bytes).toString('base64'),
    encoding: text === null ? 'base64' : 'utf8',
    byteLength: bytes.byteLength,
    timestamp: now - 1000 + sequence,
    qos: 0,
    retain: false,
    protocolVersion: 5,
  };
  database.append([message], now);
};
/** Every page of a search, as the window requests them; each call has a time budget. */
const search = (term: string, mode: HistorySearchQuery['mode'] = 'text') => {
  let query: HistorySearchQuery = {
    connectionId: 'broker',
    topic: 'big',
    term,
    mode,
    from: now - 60_000,
    to: now,
  };
  const all = { messages: [] as HistoryMessage[], skippedLarge: 0, skippedBinary: 0 };
  for (;;) {
    const page = database.search(query, now);
    all.messages.push(...page.messages);
    all.skippedLarge += page.skippedLarge;
    all.skippedBinary += page.skippedBinary;
    if (page.nextBefore === null) return all;
    query = {
      ...query,
      before: page.nextBefore,
      beforeTime: page.nextBeforeTime!,
      snapshot: page.snapshot,
    };
  }
};
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'mqtt-large-'));
  database = new HistoryDatabase(join(directory, 'history.sqlite'));
});
afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

it('pages large payloads as previews cut on a character boundary, with the full payload on request', () => {
  // A three-byte character straddles the preview limit.
  const text = 'a'.repeat(DISK_HISTORY.previewBytes - 1) + '€' + 'b'.repeat(MIB);
  store(1, new TextEncoder().encode(text));
  const [message] = database.page({ connectionId: 'broker', topic: 'big' }, now).messages;
  expect(message.truncated).toBe(true);
  expect(message.encoding).toBe('utf8');
  expect(message.byteLength).toBe(new TextEncoder().encode(text).byteLength);
  expect(message.message).toBe('a'.repeat(DISK_HISTORY.previewBytes - 1));
  const full = database.payload(message.rowId);
  expect(full.message).toBe(text);
  expect(() => database.payload(9999)).toThrow('no longer');
});

it('searches large payloads in chunks, including matches across chunk boundaries', () => {
  const size = 3 * SEARCH_LIMITS.chunkBytes;
  const padded = (needle: string, at: number) => {
    const bytes = new TextEncoder().encode('x'.repeat(size));
    bytes.set(new TextEncoder().encode(needle), at);
    return bytes;
  };
  store(1, padded('needle', SEARCH_LIMITS.chunkBytes - 3));
  store(2, padded('other', 10));
  const found = search('needle');
  expect(found.messages.map((message) => message.sequence)).toEqual([1]);
  expect(found.messages[0].truncated).toBe(true);
  expect(found.skippedLarge).toBe(0);
  // Bytes split across the boundary in hex mode too.
  expect(search('6e 65 65 64 6c 65', 'hex').messages).toHaveLength(1);
});

it('counts large binary payloads as not text in text mode and still searches their bytes', () => {
  const binary = new Uint8Array(2 * SEARCH_LIMITS.chunkBytes).fill(0xff);
  store(1, binary);
  const result = search('x');
  expect(result.skippedBinary).toBe(1);
  expect(result.messages).toEqual([]);
  expect(search('ff ff', 'hex').messages).toHaveLength(1);
});
