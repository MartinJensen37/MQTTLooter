import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { RecordingDatabase } from '../src/main/recording-database';
import { RecordingService } from '../src/main/recording-service';
import { RECORDING_QUEUE, type RecordingRequest } from '../src/shared/recording';
import type { IncomingPublish } from '../src/shared/traffic';

let directory: string;
let database: RecordingDatabase;
let gate: Promise<void> | null;
let failure: ((message: string) => void) | null;
const client = (onFailure: (message: string) => void) => {
  failure = onFailure;
  return {
    failure: undefined,
    async request(request: RecordingRequest) {
      if (request.action === 'status')
        return { databaseBytes: database.usedBytes(), recovered: database.recovered };
      if (request.action === 'close') return null;
      if (request.action === 'append' && gate) await gate;
      return structuredClone(database.handle(request));
    },
    async close() {},
  };
};
const message = (id: string, sequence: number, topic = 't'): IncomingPublish => ({
  id,
  sessionId: 's',
  sequence,
  topic,
  message: `m${sequence}`,
  encoding: 'utf8',
  byteLength: 2,
  timestamp: 1000 + sequence,
  qos: 0,
  retain: false,
  protocolVersion: 5,
  properties: { contentType: 'text/plain' },
});
const service = (queueLimits = { ...RECORDING_QUEUE, flushMs: 1 }) =>
  new RecordingService(directory, { client, queueLimits });

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'mqtt-recording-service-'));
  database = new RecordingDatabase(join(directory, 'recordings.sqlite'));
  gate = null;
  failure = null;
});
afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

it('captures only the recording connection and writes everything queued before stopping', async () => {
  const recordings = service();
  const started = await recordings.start('a', 'Broker A', 'Capture');
  await expect(recordings.start('a', 'Broker A', 'Again')).rejects.toThrow('already recording');
  recordings.capture(message('b', 1, 'other'));
  for (let i = 1; i <= 300; i++) recordings.capture(message('a', i));
  const summary = (await recordings.stop('a'))!;
  expect(summary).toMatchObject({ id: started.id, state: 'complete', messageCount: 300 });
  expect(summary.connectionName).toBe('Broker A');
  const page = database.page({ recordingId: started.id, limit: 512 });
  expect(page.messages.at(-1)).toMatchObject({
    message: 'm300',
    connectionId: 'a',
    properties: { contentType: 'text/plain' },
  });
  // Messages after stop are not captured.
  recordings.capture(message('a', 301));
  expect(recordings.status().active).toEqual([]);
  expect(await recordings.stop('a')).toBeNull();
});

it('records queue overflow as a durable gap instead of claiming a complete capture', async () => {
  let release!: () => void;
  gate = new Promise((resolve) => (release = resolve));
  const recordings = service({ ...RECORDING_QUEUE, maxMessages: 4, batchMessages: 2, flushMs: 1 });
  const { id } = await recordings.start('a', 'A', 'Overflow');
  for (let i = 1; i <= 10; i++) recordings.capture(message('a', i));
  expect(recordings.status().active[0].dropped).toBe(6);
  release();
  const summary = (await recordings.stop('a'))!;
  expect(summary).toMatchObject({ messageCount: 4, dropped: 6 });
  expect(database.gaps(id)).toEqual([{ at: 1005, until: null, kind: 'queue', dropped: 6 }]);
});

it('keeps capturing through automatic reconnects and records one outage', async () => {
  const recordings = service();
  const { id } = await recordings.start('a', 'A', 'Outage');
  recordings.capture(message('a', 1));
  recordings.connectionLost('a');
  recordings.connectionLost('a');
  recordings.connectionRestored('a');
  recordings.capture(message('a', 2));
  const summary = (await recordings.stop('a'))!;
  expect(summary).toMatchObject({ messageCount: 2, outages: 1 });
  const [gap] = database.gaps(id);
  expect(gap.kind).toBe('connection');
  expect(gap.until).not.toBeNull();
});

it('finishes active captures on close and stops capturing after a storage failure', async () => {
  const recordings = service();
  const { id } = await recordings.start('a', 'A', 'Closing');
  recordings.capture(message('a', 1));
  await recordings.close();
  expect(database.summary(id)).toMatchObject({ state: 'complete', messageCount: 1 });

  const failing = service();
  await failing.start('b', 'B', 'Failing');
  failure!('disk unplugged');
  const status = failing.status();
  expect(status.active).toEqual([]);
  expect(status.error).toContain('disk unplugged');
  expect(status.notices.at(-1)).toMatchObject({ connectionId: 'b' });
  await expect(failing.start('b', 'B', 'Again')).rejects.toThrow('disk unplugged');
});

it('streams exports that the importer accepts', async () => {
  const recordings = service();
  const { id } = await recordings.start('a', 'A', 'Export');
  for (let i = 1; i <= 5; i++) recordings.capture(message('a', i, i % 2 ? 'odd' : 'even'));
  await recordings.stop('a');
  const file = join(directory, 'export.json');
  await recordings.exportTo(id, file);
  const { readFileSync } = await import('node:fs');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  expect(data.recordingInfo).toMatchObject({ name: 'Export', messageCount: 5, topic: '2 Topics' });
  expect(data.messages.map((entry: { payload: string }) => entry.payload)).toEqual([
    'm1',
    'm2',
    'm3',
    'm4',
    'm5',
  ]);
  expect(database.import(data).messageCount).toBe(5);
});
