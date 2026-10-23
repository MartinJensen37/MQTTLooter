import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { HistoryDatabase } from '../src/main/history-database';
import { DISK_HISTORY } from '../src/shared/history';
import type { IncomingPublish } from '../src/shared/traffic';

let directory: string;
let database: HistoryDatabase;
const now = Date.now();
const message = (sequence: number, topic = 'a//b'): IncomingPublish => ({
  id: 'broker',
  sessionId: 'session',
  sequence,
  topic,
  message: '42',
  encoding: 'utf8',
  byteLength: 2,
  timestamp: now,
  qos: 1,
  retain: true,
  protocolVersion: 5,
  properties: {
    correlationData: Buffer.from([0, 255, 128]),
    responseTopic: 'reply',
    userProperties: { tag: ['a', 'b'] },
  },
});
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'mqtt-history-'));
  database = new HistoryDatabase(join(directory, 'test.sqlite'));
});
afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

it('pages beyond 300 messages with stable receive order, exact bytes and MQTT 5 properties', () => {
  database.append(
    Array.from({ length: 700 }, (_, i) => message(i + 1)),
    now,
  );
  database.append([{ ...message(701), message: 'AP+A', encoding: 'base64', byteLength: 3 }], now);
  const first = database.page({ connectionId: 'broker', topic: 'a//b' }, now);
  expect(first.messages).toHaveLength(300);
  expect(first.messages[0]).toMatchObject({
    sequence: 701,
    encoding: 'base64',
    message: 'AP+A',
    properties: { correlationData: { encoding: 'base64', data: 'AP+A' } },
  });
  database.append([message(702)], now);
  const second = database.page(
    {
      connectionId: 'broker',
      topic: 'a//b',
      snapshot: first.snapshot,
      before: first.nextBefore!,
      generation: first.generation,
    },
    now,
  );
  expect(second.messages[0].sequence).toBe(401);
  const third = database.page(
    { connectionId: 'broker', topic: 'a//b', snapshot: first.snapshot, before: second.nextBefore! },
    now,
  );
  expect(third.messages).toHaveLength(101);
  expect(third.messages.at(-1)!.sequence).toBe(1);
  expect(third.nextBefore).toBeNull();
  expect(database.page({ connectionId: 'broker', topic: 'a/b' }, now).messages).toEqual([]);
});

it('rolls back partial batches and retries idempotently across restart', () => {
  database.append([message(1)], now);
  expect(() =>
    database.append([message(2), { ...message(3), message: 'bad', encoding: 'base64' }], now),
  ).toThrow();
  expect(database.status().retainedMessages).toBe(1);
  database.close();
  database = new HistoryDatabase(join(directory, 'test.sqlite'));
  database.append([message(1), message(2)], now);
  expect(database.status().retainedMessages).toBe(2);
  expect(
    database.page({ connectionId: 'broker', topic: 'a//b' }, now).messages.map((m) => m.sequence),
  ).toEqual([2, 1]);
});

it('clears only the requested topic/connection and invalidates old cursors', () => {
  database.append([message(1), message(2, 'a/b'), { ...message(3), id: 'other' }], now);
  const first = database.page({ connectionId: 'broker', topic: 'a//b' }, now);
  database.clear('broker', 'a//b');
  expect(() =>
    database.page({ connectionId: 'broker', topic: 'a//b', generation: first.generation }, now),
  ).toThrow('cleared');
  expect(database.status().retainedMessages).toBe(2);
  expect(database.topics('broker', 'a/')).toEqual([{ path: 'a/b' }]);
  database.clear('broker');
  expect(database.status().retainedMessages).toBe(1);
  expect(database.page({ connectionId: 'other', topic: 'a//b' }, now).messages).toHaveLength(1);
});

it('bounds retention, excludes expired rows and keeps pages within their byte target', () => {
  database.close();
  database = new HistoryDatabase(join(directory, 'bounded.sqlite'), {
    ...DISK_HISTORY,
    maxPayloadBytes: 4000,
    pageBytes: 800,
  });
  database.append(
    [
      { ...message(1), timestamp: now - DISK_HISTORY.maxAgeMs - 1 },
      ...Array.from({ length: 5 }, (_, i) => message(i + 2)),
    ],
    now,
  );
  expect(database.status().expired).toBe(1);
  const page = database.page({ connectionId: 'broker', topic: 'a//b' }, now);
  expect(page.messages.length).toBeLessThan(5);
  expect(page.nextBefore).not.toBeNull();
  database.append(
    Array.from({ length: 20 }, (_, i) => message(i + 10)),
    now,
  );
  expect(database.status().retainedBytes).toBeLessThanOrEqual(4000);
  expect(database.status().expired).toBeGreaterThan(1);
  expect(database.page({ connectionId: 'broker', topic: 'a//b' }, now).messages[0].sequence).toBe(
    29,
  );
});

it('fails a database-full transaction without retaining a partial batch', () => {
  database.close();
  database = new HistoryDatabase(join(directory, 'full.sqlite'), {
    ...DISK_HISTORY,
    maxDatabaseBytes: 65536,
  });
  expect(() =>
    database.append([message(1), { ...message(2), message: 'x'.repeat(100_000) }], now),
  ).toThrow();
  expect(database.status().retainedMessages).toBe(0);
  expect(database.page({ connectionId: 'broker', topic: 'a//b' }, now).messages).toEqual([]);
  database.append([message(1)], now);
  expect(database.status().retainedMessages).toBe(1);
});
