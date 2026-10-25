import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  INTERRUPTED,
  RecordingDatabase,
  STORAGE_FULL,
  type CaptureMessage,
} from '../src/main/recording-database';
import { parseRecording, RECORDING_LIMITS } from '../src/shared/recording';

let directory: string;
let path: string;
let database: RecordingDatabase;
const capture = (
  recordingId: number,
  sequence: number,
  topic = 'a//b',
  extra: Partial<CaptureMessage> = {},
): CaptureMessage => ({
  recordingId,
  id: 'broker',
  sessionId: 'session',
  sequence,
  topic,
  message: String(sequence),
  encoding: 'utf8',
  byteLength: String(sequence).length,
  timestamp: 1000 + sequence,
  qos: 1,
  retain: false,
  protocolVersion: 5,
  ...extra,
});
const all = (recordingId: number, topics?: string[], limit = 7) => {
  const seen: number[] = [];
  let after: number | undefined;
  for (let guard = 0; guard < 1000; guard++) {
    const page = database.page({ recordingId, after, limit, topics });
    seen.push(...page.messages.map((message) => message.seq));
    if (page.cursor === null) return seen;
    after = page.cursor;
  }
  throw new Error('Paging did not finish');
};

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'mqtt-recordings-'));
  path = join(directory, 'recordings.sqlite');
  database = new RecordingDatabase(path);
});
afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

it('captures batches in order with exact bytes, MQTT 5 properties and topic counts', () => {
  const { id } = database.create('broker', 'Broker', 'Capture', 1000);
  database.append([capture(id, 1), capture(id, 2, 'other')]);
  const result = database.append([
    capture(id, 3, 'binary', {
      message: 'AP+A',
      encoding: 'base64',
      byteLength: 3,
      properties: { correlationData: Buffer.from([0, 255]), userProperties: { k: ['a', 'b'] } },
    }),
  ]);
  expect(result.counts).toEqual([{ recordingId: id, messageCount: 3, topicCount: 3 }]);
  const page = database.page({ recordingId: id, limit: 10 });
  expect(page.cursor).toBeNull();
  expect(page.messages.map((message) => message.seq)).toEqual([1, 2, 3]);
  expect(page.messages[2]).toMatchObject({
    topic: 'binary',
    message: 'AP+A',
    encoding: 'base64',
    connectionId: 'broker',
    protocolVersion: 5,
    properties: {
      correlationData: { encoding: 'base64', data: 'AP8=' },
      userProperties: { k: ['a', 'b'] },
    },
  });
  expect(database.topics(id)).toEqual({
    topics: [
      { topic: 'a//b', messages: 1 },
      { topic: 'binary', messages: 1 },
      { topic: 'other', messages: 1 },
    ],
    total: 3,
  });
  const summary = database.finish(id, 5000)!;
  expect(summary).toMatchObject({ state: 'complete', endTime: 5000, messageCount: 3 });
  expect(summary.topic).toBe('3 Topics');
  // Messages for a finished capture are ignored rather than reopening it.
  database.append([capture(id, 4)]);
  expect(database.count(id)).toBe(3);
});

it('keeps committed messages after a crash and marks the capture interrupted', () => {
  const { id } = database.create('broker', 'Broker', 'Crash', 1000);
  database.append([capture(id, 1), capture(id, 2)]);
  database.close();
  database = new RecordingDatabase(path);
  expect(database.recovered).toBe(1);
  expect(database.summary(id)).toMatchObject({
    state: 'interrupted',
    endTime: 1002,
    messageCount: 2,
    incompleteReason: INTERRUPTED,
  });
  database.append([capture(id, 3)]);
  expect(database.count(id)).toBe(2);
});

it('pages forward and backward, with and without topic filters', () => {
  const { id } = database.create('broker', 'Broker', 'Pages', 0);
  const topics = Array.from({ length: 20 }, (_, i) => `t/${i}`);
  database.append(
    Array.from({ length: 200 }, (_, i) => capture(id, i + 1, topics[i % topics.length])),
  );
  expect(all(id)).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));
  // Index-range strategy: few topics, merged in capture order.
  const few = ['t/3', 't/17'];
  const expected = Array.from({ length: 200 }, (_, i) => i + 1).filter((seq) =>
    few.includes(topics[(seq - 1) % 20]),
  );
  expect(all(id, few)).toEqual(expected);
  // Scan strategy: more than 16 filter topics.
  const many = topics.slice(0, 18);
  expect(all(id, many)).toEqual(
    Array.from({ length: 200 }, (_, i) => i + 1).filter((seq) => (seq - 1) % 20 < 18),
  );
  expect(database.count(id, few)).toBe(expected.length);
  const back = database.page({ recordingId: id, before: 50, limit: 5 });
  expect(back.messages.map((message) => message.seq)).toEqual([45, 46, 47, 48, 49]);
  expect(back.cursor).toBe(45);
  const backFiltered = database.page({ recordingId: id, before: 50, limit: 2, topics: few });
  expect(backFiltered.messages.map((message) => message.seq)).toEqual([38, 44]);
  expect(backFiltered.cursor).toBe(38);
  expect(database.page({ recordingId: id, before: 4, limit: 5 }).cursor).toBeNull();
  expect(database.page({ recordingId: id, limit: 5, topics: [] }).messages).toEqual([]);
});

it('bounds filtered scans and page bytes, continuing from partial pages', () => {
  database.close();
  database = new RecordingDatabase(path, { ...RECORDING_LIMITS, scanRows: 10, pageBytes: 64 });
  const { id } = database.create('broker', 'Broker', 'Bounds', 0);
  const many = Array.from({ length: 17 }, (_, i) => `rare/${i}`);
  database.append([
    ...Array.from({ length: 50 }, (_, i) => capture(id, i + 1, 'busy')),
    capture(id, 51, 'rare/0'),
  ]);
  const first = database.page({ recordingId: id, limit: 5, topics: many });
  expect(first.messages).toEqual([]);
  expect(first.cursor).toBe(10);
  expect(all(id, many)).toEqual([51]);
  database.append([capture(id, 52, 'big', { message: 'x'.repeat(100), byteLength: 100 })]);
  const page = database.page({ recordingId: id, after: 50, limit: 5 });
  expect(page.messages.map((message) => message.seq)).toEqual([51]);
  expect(page.cursor).toBe(51);
  // One oversized message is still returned on its own page.
  expect(database.page({ recordingId: id, after: 51, limit: 5 }).messages).toHaveLength(1);
});

it('records queue drops and coalesced connection outages as gaps', () => {
  const { id } = database.create('broker', 'Broker', 'Gaps', 0);
  database.append([capture(id, 1)], [{ recordingId: id, at: 10, dropped: 7 }]);
  database.gap(id, 20, 'connection');
  database.gap(id, 21, 'connection');
  database.resolveGaps(id, 30);
  database.gap(id, 40, 'connection');
  database.finish(id, 50);
  expect(database.gaps(id)).toEqual([
    { at: 10, until: null, kind: 'queue', dropped: 7 },
    { at: 20, until: 30, kind: 'connection', dropped: 0 },
    { at: 40, until: 50, kind: 'connection', dropped: 0 },
  ]);
  expect(database.summary(id)).toMatchObject({ dropped: 7, outages: 2 });
});

it('stops captures at the storage limit with a storage gap', () => {
  database.close();
  database = new RecordingDatabase(path, { ...RECORDING_LIMITS, maxDatabaseBytes: 256 * 1024 });
  const { id } = database.create('broker', 'Broker', 'Full', 0);
  const big = 'x'.repeat(64 * 1024);
  let stopped: { recordingId: number; reason: string }[] = [];
  for (let i = 1; i < 10 && !stopped.length; i++)
    stopped = database.append([capture(id, i, 'big', { message: big })]).stopped;
  expect(stopped).toEqual([{ recordingId: id, reason: STORAGE_FULL }]);
  expect(database.isActive(id)).toBe(false);
  expect(database.summary(id)).toMatchObject({
    state: 'complete',
    incompleteReason: STORAGE_FULL,
    dropped: 1,
  });
  expect(database.gaps(id).at(-1)).toMatchObject({ kind: 'storage', dropped: 1 });
});

const legacy = (name: string, timestamps: number[]) => ({
  id: 1,
  name,
  startTime: 0,
  endTime: 10,
  messages: timestamps.map((timestamp, index) => ({
    topic: index % 2 ? 'odd' : 'even',
    message: `m${index}`,
    timestamp,
  })),
});

it('imports legacy libraries once, atomically, in stable timestamp order', () => {
  const library = [legacy('One', [5, 1, 5]), legacy('Two', [2])];
  expect(database.importLibrary(library, 'file')).toEqual({ imported: 2, skipped: false });
  expect(database.importLibrary(library, 'file')).toEqual({ imported: 0, skipped: true });
  const [two, one] = database.list();
  expect(one).toMatchObject({ name: 'One', state: 'complete', messageCount: 3, topicCount: 2 });
  expect(two.name).toBe('Two');
  expect(database.page({ recordingId: one.id, limit: 10 }).messages.map((m) => m.message)).toEqual([
    'm1',
    'm0',
    'm2',
  ]);
  const broken = [legacy('Three', [1]), { name: 'Bad', messages: [{ topic: '' }] }];
  expect(() => database.importLibrary(broken, 'file')).toThrow();
  expect(database.list()).toHaveLength(2);
});

it('exports chunks that parse back into the same recording', () => {
  database.close();
  database = new RecordingDatabase(path, { ...RECORDING_LIMITS, exportRows: 3 });
  const { id } = database.create('broker', 'Broker', 'Export', 1000);
  database.append([
    ...Array.from({ length: 7 }, (_, i) => capture(id, i + 1)),
    capture(id, 8, 'bin', { message: 'AP8=', encoding: 'base64', byteLength: 2 }),
  ]);
  const summary = database.finish(id, 2000)!;
  const chunks: string[] = [];
  let after = 0;
  for (;;) {
    const chunk = database.exportChunk(id, after);
    chunks.push(chunk.json);
    if (chunk.cursor === null) break;
    after = chunk.cursor;
  }
  expect(chunks).toHaveLength(3);
  const file = JSON.parse(
    `{"recordingInfo":${JSON.stringify({ ...summary, startTime: 1000, endTime: 2000 })},"messages":[${chunks.join(',')}]}`,
  );
  const parsed = parseRecording(file);
  expect(parsed.messages).toHaveLength(8);
  expect(parsed.messages[7]).toMatchObject({ topic: 'bin', message: 'AP8=', encoding: 'base64' });
  const imported = database.import(file);
  expect(imported.messageCount).toBe(8);
  expect(database.page({ recordingId: imported.id, limit: 20 }).messages[7]).toMatchObject({
    message: 'AP8=',
    protocolVersion: 5,
  });
});

it('renames, refuses to delete active captures and purges deleted messages in steps', () => {
  const { id } = database.create('broker', 'Broker', 'Delete me', 0);
  database.append(Array.from({ length: 30 }, (_, i) => capture(id, i + 1)));
  expect(() => database.delete(id)).toThrow('Stop the recording');
  database.finish(id, 10);
  expect(database.rename(id, '  Renamed  ').name).toBe('Renamed');
  expect(() => database.rename(id, ' ')).toThrow();
  database.delete(id);
  expect(database.list()).toEqual([]);
  let steps = 0;
  while (database.purgeStep(10) && steps < 100) steps++;
  expect(steps).toBeGreaterThanOrEqual(3);
  expect(() => database.page({ recordingId: id, limit: 5 })).toThrow('not found');
});

it('streams imports into a hidden recording that appears only when finished', () => {
  const info = {
    name: 'Streamed',
    connectionName: 'Old broker',
    startTime: new Date(1000),
    endTime: new Date(5000),
  };
  const batch = (start: number, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      topic: `t/${(start + i) % 3}`,
      message: `m${start + i}`,
      encoding: 'utf8' as const,
      timestamp: 1000 + start + i,
    }));
  const id = database.beginImport();
  database.appendImport(id, batch(0, 600));
  database.appendImport(id, batch(600, 400));
  expect(database.list()).toEqual([]);
  expect(database.finishImport(id, info)).toMatchObject({
    name: 'Streamed',
    state: 'complete',
    messageCount: 1000,
    topicCount: 3,
    startTime: 1000,
    endTime: 5000,
  });
  expect(
    database.page({ recordingId: id, after: 998, limit: 5 }).messages.map((m) => m.message),
  ).toEqual(['m998', 'm999']);

  const aborted = database.beginImport();
  database.appendImport(aborted, batch(0, 10));
  database.abortImport(aborted);
  expect(() => database.appendImport(aborted, batch(0, 1))).toThrow('no longer running');
  // An import cut short by a crash is discarded on the next start.
  const crashed = database.beginImport();
  database.appendImport(crashed, batch(0, 10));
  database.close();
  database = new RecordingDatabase(path);
  expect(database.list().map((recording) => recording.id)).toEqual([id]);
  expect(() => database.page({ recordingId: crashed, limit: 5 })).toThrow('not found');
});

it('stops a streamed import at the storage limit', () => {
  database.close();
  database = new RecordingDatabase(path, { ...RECORDING_LIMITS, maxDatabaseBytes: 256 * 1024 });
  const id = database.beginImport();
  const big = [{ topic: 't', message: 'x'.repeat(64 * 1024), timestamp: 1 }];
  expect(() => {
    for (let i = 0; i < 10; i++) database.appendImport(id, big);
  }).toThrow(STORAGE_FULL);
});
