import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { RecordingDatabase } from '../src/main/recording-database';
import { RecordingImport, type ImportStep } from '../src/main/recording-import';

let directory: string;
let database: RecordingDatabase;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'mqtt-import-'));
  database = new RecordingDatabase(join(directory, 'recordings.sqlite'));
});
afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

const run = (path: string) => {
  const session = new RecordingImport(database, path);
  let steps = 0;
  let step: ImportStep;
  do {
    step = session.step();
    steps++;
  } while (!step.done);
  return { summary: step.summary, steps };
};

it('imports a file larger than one step, keeping order, bytes and metadata', () => {
  const pad = 'x'.repeat(200);
  const messages = Array.from({ length: 40_000 }, (_, i) => ({
    timestamp: new Date(1000 + i).toISOString(),
    topic: `plant/${i % 4}`,
    payload: i === 1 ? 'AP8=' : `${i}:${pad}`,
    encoding: i === 1 ? 'base64' : 'utf8',
    qos: 1,
    retain: false,
    protocolVersion: 5,
    properties: i === 2 ? { contentType: 'text/plain' } : undefined,
  }));
  const path = join(directory, 'big.json');
  writeFileSync(
    path,
    JSON.stringify(
      {
        recordingInfo: {
          name: 'Big',
          startTime: '2026-10-25T10:00:00.000Z',
          endTime: '2026-10-25T11:00:00.000Z',
          connectionName: 'Plant',
        },
        messages,
      },
      null,
      1,
    ),
  );
  const { summary, steps } = run(path);
  expect(steps).toBeGreaterThan(2);
  expect(summary).toMatchObject({
    name: 'Big (Imported)',
    connectionName: 'Plant',
    messageCount: 40_000,
    topicCount: 4,
    startTime: Date.parse('2026-10-25T10:00:00.000Z'),
  });
  const first = database.page({ recordingId: summary.id, limit: 3 }).messages;
  expect(first.map((message) => message.message)).toEqual([`0:${pad}`, 'AP8=', `2:${pad}`]);
  expect(first[2].properties).toEqual({ contentType: 'text/plain' });
  expect(
    database.page({ recordingId: summary.id, before: 40_001, limit: 1 }).messages[0].message,
  ).toBe(`39999:${pad}`);
});

it('round-trips an export of this app and discards failed imports', () => {
  const { id } = database.create('c', 'Broker', 'Original', 1000);
  database.append(
    Array.from({ length: 5 }, (_, i) => ({
      recordingId: id,
      id: 'c',
      sessionId: 's',
      sequence: i + 1,
      topic: 't',
      message: `m${i}`,
      encoding: 'utf8' as const,
      byteLength: 2,
      timestamp: 1000 + i,
      qos: 0,
      retain: false,
      protocolVersion: 4,
    })),
  );
  const summary = database.finish(id, 2000)!;
  const exported = join(directory, 'export.json');
  const chunk = database.exportChunk(id, 0);
  writeFileSync(
    exported,
    `{"recordingInfo":${JSON.stringify({ ...summary, startTime: 1000, endTime: 2000 })},"messages":[${chunk.json}]}`,
  );
  expect(run(exported).summary).toMatchObject({ name: 'Original (Imported)', messageCount: 5 });

  for (const [name, content] of [
    [
      'truncated.json',
      '{"recordingInfo":{"name":"x","startTime":0,"endTime":1},"messages":[{"topic":"t"',
    ],
    [
      'invalid.json',
      '{"recordingInfo":{"name":"x","startTime":0,"endTime":1},"messages":[{"topic":""}]}',
    ],
    ['binary.json', Buffer.from([0x7b, 0xff, 0x7d])],
  ] as const) {
    const path = join(directory, name);
    writeFileSync(path, content);
    expect(() => run(path), name).toThrow();
  }
  // Only the two complete recordings remain; failed imports were discarded.
  expect(database.list()).toHaveLength(2);
});
