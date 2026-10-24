import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync, renameSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { HistoryDatabase } from './history-database';
import type { HistoryRequest } from '../shared/history';

const directory: string = workerData.directory;
mkdirSync(directory, { recursive: true });
const settingsPath = join(directory, 'settings.json');
const databasePath = join(directory, 'history.sqlite');
let persistent = false;
try {
  persistent = JSON.parse(readFileSync(settingsPath, 'utf8')).persistent === true;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const cleanSession = () => {
  // Fixed, app-owned files only; includes rollback recovery left by a crashed session.
  for (const suffix of ['', '-journal', '-wal', '-shm'])
    rmSync(databasePath + suffix, { force: true });
};
if (!persistent) cleanSession();
const database = new HistoryDatabase(databasePath);
const maintenance = setInterval(() => {
  try {
    database.append([]);
  } catch {
    /* The next request reports storage errors. */
  }
}, 30_000);
const status = () => ({ ...database.status(), persistent });
parentPort!.on(
  'message',
  ({ requestId, request }: { requestId: number; request: HistoryRequest }) => {
    try {
      let data: unknown;
      switch (request.action) {
        case 'append':
          database.append(request.messages);
          data = status();
          break;
        case 'series':
          data = database.series(request.query);
          break;
        case 'page':
          data = database.page(request.query);
          break;
        case 'search':
          data = database.search(request.query);
          break;
        case 'topics':
          data = database.topics(request.connectionId, request.search);
          break;
        case 'clear':
          database.clear(request.connectionId, request.topic);
          data = status();
          break;
        case 'status':
          data = status();
          break;
        case 'persist':
          writeFileSync(settingsPath + '.tmp', JSON.stringify({ persistent: request.enabled }));
          renameSync(settingsPath + '.tmp', settingsPath);
          persistent = request.enabled;
          data = status();
          break;
        case 'close':
          clearInterval(maintenance);
          database.close();
          if (!persistent) cleanSession();
          parentPort!.postMessage({ requestId, data: null });
          parentPort!.close();
          return;
      }
      parentPort!.postMessage({ requestId, data });
    } catch (error) {
      parentPort!.postMessage({ requestId, error: (error as Error).message });
    }
  },
);
