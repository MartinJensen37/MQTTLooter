import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync, renameSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { HistoryDatabase } from './history-database';
import { ProtobufDecoders } from './protobuf-decoders';
import { matchDecoder, type DecoderDefinition } from '../shared/decoders';
import { isSparkplugBirth, SPARKPLUG_DECODER } from '../shared/sparkplug';
import { payloadBytes } from '../shared/payload';
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
// Plots of protobuf topics decode stored payloads here, next to the data.
const decoders = new ProtobufDecoders();
let decoderList: DecoderDefinition[] = [];
const decodeText = (topic: string, payload: Uint8Array) => {
  const decoder = matchDecoder([...decoderList, SPARKPLUG_DECODER], topic);
  if (!decoder) return undefined;
  try {
    return decoders.decode(decoder.id, payload, topic);
  } catch {
    return undefined;
  }
};
const maintenance = setInterval(() => {
  try {
    database.append([]);
  } catch {
    /* The next request reports storage errors. */
  }
}, 30_000);
// Cleared messages are purged in short steps so appends and queries interleave.
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
      /* Retried after the next clear or restart. */
    }
    purging = false;
  };
  setTimeout(step, 0);
};
purge();
const status = () => ({ ...database.status(), persistent });
parentPort!.on(
  'message',
  ({ requestId, request }: { requestId: number; request: HistoryRequest }) => {
    try {
      let data: unknown;
      switch (request.action) {
        case 'append':
          // Births name the aliases that stored Sparkplug data uses, for plots and search.
          for (const message of request.messages)
            if (isSparkplugBirth(message.topic))
              decoders.sparkplug.observe(
                message.topic,
                payloadBytes(message.message, message.encoding),
              );
          database.append(request.messages, Date.now(), request.drops);
          data = status();
          break;
        case 'series': {
          const { decoderId, topic } = request.query;
          data = database.series(
            request.query,
            decoderId === undefined
              ? undefined
              : (payload) =>
                  payload ? decoders.decodeValues(decoderId, payload, topic) : undefined,
          );
          break;
        }
        case 'decoders':
          decoderList = request.decoders;
          data = decoders.configure(request.decoders);
          break;
        case 'page':
          data = database.page(request.query);
          break;
        case 'search':
          data = database.search(request.query, Date.now(), decodeText);
          break;
        case 'topics':
          data = database.topics(request.connectionId, request.search);
          break;
        case 'export-chunk':
          data = database.exportChunk(request.query);
          break;
        case 'clear':
          database.clear(request.connectionId, request.topic);
          purge();
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
