import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RecordingStore, MAX_LIBRARY_BYTES } from '../src/main/recording-store';

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const recording = (id = 1, name = 'Binary capture') => ({
  id,
  name,
  startTime: 0,
  endTime: 100,
  messages: [
    { topic: 'binary', message: '/wAB', encoding: 'base64', timestamp: 1, qos: 0, retain: true },
  ],
});
let directory: string;
let file: string;
let store: RecordingStore;
beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'mqttlooter-recordings-'));
  file = join(directory, 'recordings.json');
  store = new RecordingStore(file);
});
afterEach(async () => {
  await store.flush();
  await fs.rm(directory, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('recording disk storage', () => {
  it('persists binary captures, renames and deletions across store instances', async () => {
    expect((await store.load()).recordings).toEqual([]);
    expect(await store.save([recording()], 0)).toBe(1);
    let reopened = new RecordingStore(file);
    expect((await reopened.load()).recordings[0].messages[0]).toMatchObject({
      message: '/wAB',
      encoding: 'base64',
      retain: true,
    });
    await reopened.save([recording(1, 'Renamed')], 1);
    reopened = new RecordingStore(file);
    expect((await reopened.load()).recordings[0].name).toBe('Renamed');
    await reopened.save([], 2);
    expect((await new RecordingStore(file).load()).recordings).toEqual([]);
  });

  it('migrates once, merges safely and repairs duplicate legacy IDs', async () => {
    await store.save([recording(1, 'Disk')], 0);
    const legacy = [recording(1, 'Legacy A'), recording(1, 'Legacy B')];
    const migrated = await store.migrate(legacy);
    expect(migrated.recordings.map((item) => item.name)).toEqual(['Disk', 'Legacy A', 'Legacy B']);
    expect(new Set(migrated.recordings.map((item) => item.id)).size).toBe(3);
    const repeated = await new RecordingStore(file).migrate(legacy);
    expect(repeated).toEqual(migrated);
    const otherOrigin = await store.migrate([recording(1, 'Other profile')]);
    expect(otherOrigin.recordings.map((item) => item.name)).toEqual([
      'Disk',
      'Legacy A',
      'Legacy B',
      'Other profile',
    ]);
    expect(otherOrigin.legacyMigrations).toHaveLength(2);
  });

  it('rejects stale concurrent saves without overwriting the successful one', async () => {
    const first = store.save([recording(1, 'First')], 0);
    const second = store.save([recording(1, 'Stale')], 0);
    await expect(first).resolves.toBe(1);
    await expect(second).rejects.toThrow('another session');
    expect((await store.load()).recordings[0].name).toBe('First');
  });

  it('retains the last good library when atomic replacement fails and allows retry', async () => {
    await store.save([recording()], 0);
    const original = await fs.readFile(file, 'utf8');
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error('Disk write failed'));
    await expect(store.save([recording(1, 'New')], 1)).rejects.toThrow('Disk write failed');
    expect(await fs.readFile(file, 'utf8')).toBe(original);
    expect(await fs.readdir(directory)).toEqual(['recordings.json']);
    await expect(store.save([recording(1, 'New')], 1)).resolves.toBe(2);
  });

  it('does not overwrite corrupt, unsupported or oversized libraries', async () => {
    for (const contents of ['broken JSON', JSON.stringify({ version: 99 })]) {
      await fs.writeFile(file, contents);
      await expect(store.load()).rejects.toThrow();
      await expect(store.save([], 0)).rejects.toThrow();
      expect(await fs.readFile(file, 'utf8')).toBe(contents);
    }
    await fs.truncate(file, MAX_LIBRARY_BYTES + 1);
    await expect(store.load()).rejects.toThrow('64 MiB');
  });

  it('rejects malformed payloads and duplicate IDs before replacing data', async () => {
    await store.save([recording()], 0);
    await expect(store.save([recording(), recording()], 1)).rejects.toThrow('unique');
    await expect(store.migrate([{ ...recording(), messages: [null] }])).rejects.toThrow();
    const library = await store.load();
    expect(library.legacyMigrated).toBe(false);
    expect(library.revision).toBe(1);
    expect(library.recordings).toHaveLength(1);
  });
});
