import { parentPort, workerData } from 'node:worker_threads';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RecordingDatabase } from './recording-database';
import { RecordingImport } from './recording-import';
import type { RecordingRequest } from '../shared/recording';

const directory: string = workerData.directory;
mkdirSync(directory, { recursive: true });
const database = new RecordingDatabase(join(directory, 'recordings.sqlite'));

// Import the JSON library used before SQLite. Its fingerprint commits with the recordings, so a
// failed rename or crash cannot import it twice; the original stays as a recovery copy.
let migrationError: string | undefined;
const legacyPath = join(directory, 'recordings.json');
try {
  if (existsSync(legacyPath)) {
    if (statSync(legacyPath).size > 64 * 1024 * 1024)
      throw new Error('Recording library exceeds 64 MiB');
    const library = JSON.parse(readFileSync(legacyPath, 'utf8'));
    if (library?.version !== 1 || !Array.isArray(library.recordings))
      throw new Error('Unsupported or invalid recording library');
    database.importLibrary(library.recordings, 'file');
    renameSync(legacyPath, `${legacyPath}.migrated`);
  }
} catch (error) {
  migrationError = `Saved recordings could not be imported (${(error as Error).message}). The original file was kept.`;
}

// Deleted recordings are purged in short steps so captures and reads interleave.
let purging = false;
const purge = () => {
  if (purging) return;
  purging = true;
  const step = () => {
    try {
      if (database.purgeStep()) {
        setTimeout(step, 0);
        return;
      }
    } catch {
      /* Retried after the next delete or restart. */
    }
    purging = false;
  };
  setTimeout(step, 0);
};
purge();

// File imports run one bounded step per request, so captures interleave with them.
const imports = new Map<number, RecordingImport>();
const importStep = (importId: number) => {
  const session = imports.get(importId);
  if (!session) throw new Error('This import is no longer running');
  try {
    const result = session.step();
    if (result.done) imports.delete(importId);
    return result;
  } catch (error) {
    imports.delete(importId);
    purge();
    throw error;
  }
};

const status = () => ({
  databaseBytes: database.usedBytes(),
  recovered: database.recovered,
  migrationError,
});

parentPort!.on(
  'message',
  ({ requestId, request }: { requestId: number; request: RecordingRequest }) => {
    try {
      if (request.action === 'close') {
        database.close();
        parentPort!.postMessage({ requestId, data: null });
        parentPort!.close();
        return;
      }
      let data: unknown;
      if (request.action === 'status') data = status();
      else if (request.action === 'import-begin') {
        const session = new RecordingImport(database, request.path);
        imports.set(session.recordingId, session);
        data = session.recordingId;
      } else if (request.action === 'import-step') data = importStep(request.importId);
      else if (request.action === 'import-abort') {
        imports.get(request.importId)?.abort();
        imports.delete(request.importId);
        purge();
      } else data = database.handle(request);
      if (request.action === 'delete') purge();
      parentPort!.postMessage({ requestId, data: data ?? null });
    } catch (error) {
      parentPort!.postMessage({ requestId, error: (error as Error).message });
    }
  },
);
