import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { parseRecording, type Recording } from '../shared/recording';

export interface RecordingLibrary {
  version: 1;
  revision: number;
  legacyMigrated: boolean;
  legacyMigrations: string[];
  recordings: Recording[];
}

// The current UI loads the library into memory. Bound it until lazy loading exists.
export const MAX_LIBRARY_BYTES = 64 * 1024 * 1024;

export class RecordingStore {
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  constructor(private readonly file: string) {}

  get busy() {
    return this.pending > 0;
  }
  flush() {
    return this.queue;
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    this.pending++;
    const task = this.queue.then(action);
    this.queue = task
      .catch(() => {})
      .finally(() => {
        this.pending--;
      });
    return task;
  }

  private validate(recordings: unknown): Recording[] {
    if (!Array.isArray(recordings) || recordings.length > 1000)
      throw new Error('Recording library must contain at most 1,000 recordings');
    if (Buffer.byteLength(JSON.stringify(recordings)) > MAX_LIBRARY_BYTES)
      throw new Error('Recording library exceeds 64 MiB. Export and remove older recordings.');
    if (recordings.some((recording) => !Number.isSafeInteger(recording?.id) || recording.id < 0))
      throw new Error('Invalid recording ID');
    const parsed = recordings.map(parseRecording);
    const ids = new Set<number>();
    for (const recording of parsed) {
      if (!Number.isSafeInteger(recording.id) || recording.id < 0 || ids.has(recording.id))
        throw new Error('Recording IDs must be unique nonnegative integers');
      ids.add(recording.id);
    }
    return parsed;
  }

  private async read(): Promise<RecordingLibrary> {
    try {
      if ((await stat(this.file)).size > MAX_LIBRARY_BYTES)
        throw new Error('Recording library exceeds 64 MiB');
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (
        data.version !== 1 ||
        !Number.isSafeInteger(data.revision) ||
        data.revision < 0 ||
        data.revision >= Number.MAX_SAFE_INTEGER ||
        typeof data.legacyMigrated !== 'boolean' ||
        !Array.isArray(data.legacyMigrations) ||
        data.legacyMigrations.some(
          (hash: unknown) => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash),
        )
      )
        throw new Error('Unsupported or invalid recording library');
      return { ...data, recordings: this.validate(data.recordings) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return {
          version: 1,
          revision: 0,
          legacyMigrated: false,
          legacyMigrations: [],
          recordings: [],
        };
      throw error;
    }
  }

  private async write(library: RecordingLibrary): Promise<void> {
    const json = JSON.stringify(library);
    if (Buffer.byteLength(json) > MAX_LIBRARY_BYTES)
      throw new Error('Recording library exceeds 64 MiB. Export and remove older recordings.');
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(json, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      // Same-directory rename leaves the previous library intact if the write fails.
      await rename(temporary, this.file);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }

  load(): Promise<RecordingLibrary> {
    return this.enqueue(() => this.read());
  }

  migrate(legacy: unknown): Promise<RecordingLibrary> {
    return this.enqueue(async () => {
      const current = await this.read();
      if (!Array.isArray(legacy)) throw new Error('Invalid legacy recording library');
      if (legacy.length > 1000 || Buffer.byteLength(JSON.stringify(legacy)) > MAX_LIBRARY_BYTES)
        throw new Error('Legacy recording library exceeds storage limits');
      const fingerprint = createHash('sha256').update(JSON.stringify(legacy)).digest('hex');
      if (current.legacyMigrations.includes(fingerprint)) return current;
      const ids = new Set(current.recordings.map((recording) => recording.id));
      let nextId = Date.now();
      const imported = legacy.map((data) => {
        const recording = parseRecording(data);
        if (!Number.isSafeInteger(recording.id) || recording.id < 0 || ids.has(recording.id)) {
          while (ids.has(nextId)) nextId++;
          recording.id = nextId++;
        }
        ids.add(recording.id);
        return recording;
      });
      const updated: RecordingLibrary = {
        ...current,
        revision: current.revision + 1,
        legacyMigrated: true,
        legacyMigrations: [...current.legacyMigrations, fingerprint],
        recordings: this.validate([...current.recordings, ...imported]),
      };
      await this.write(updated);
      return updated;
    });
  }

  save(recordings: unknown, revision: number): Promise<number> {
    return this.enqueue(async () => {
      const current = await this.read();
      if (revision !== current.revision)
        throw new Error(
          'Recordings changed in another session. Export unsaved recordings and reload before saving.',
        );
      const updated = {
        ...current,
        revision: current.revision + 1,
        recordings: this.validate(recordings),
      };
      await this.write(updated);
      return updated.revision;
    });
  }
}
