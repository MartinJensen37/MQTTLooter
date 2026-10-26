import { open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { CSV_HEADER, csvRow, exportRow } from '../shared/message-export';
import type { HistorySearchPage, HistorySearchQuery } from '../shared/history-search';
import { MessageDelivery } from './message-delivery';
import { WorkerClient } from './worker-client';
import type { IncomingPublish } from '../shared/traffic';
import {
  HISTORY_QUEUE,
  type HistoryDrop,
  type HistoryExportChunk,
  type HistoryExportQuery,
  type HistoryRequest,
  type HistoryStatus,
  type HistoryStoreStatus,
} from '../shared/history';

/** Bounded writes and requests keep database work away from main's connection controls. */
export class HistoryService {
  private worker: WorkerClient<HistoryRequest>;
  private error?: string;
  private closing = false;
  private store?: HistoryStoreStatus;
  private flushWaiters: { checkpoint: number; resolve: () => void }[] = [];
  /** Overflow drops not yet written as gap records. */
  private drops = new Map<string, HistoryDrop>();
  private delivery = new MessageDelivery((batch) => {
    const drops = [...this.drops.values()];
    this.drops.clear();
    void this.request({ action: 'append', messages: batch.messages, drops })
      .then((status) => {
        this.store = status;
        this.delivery.acknowledge(batch.batchId);
        this.finishFlush();
      })
      .catch((error: Error) => this.failCapture(error.message));
  }, HISTORY_QUEUE);

  /** The latest decoder list, sent again to a restarted worker. */
  private decoders?: HistoryRequest & { action: 'decoders' };

  constructor(
    private readonly directory: string,
    private readonly workerPath = join(__dirname, 'history-worker.js'),
  ) {
    this.worker = this.startWorker(false);
    void this.request({ action: 'status' })
      .then((status) => {
        this.store = status;
      })
      .catch((error) => this.failCapture(error.message));
  }

  append(message: IncomingPublish): void {
    if (this.closing) return;
    if (this.error) {
      // Preserve receive/drop diagnostics while capture is stopped.
      this.delivery.discard(message.id);
      return;
    }
    // A burst beyond the queue becomes a durable gap; capture continues with later messages.
    if (!this.delivery.enqueue(message)) {
      const drop = this.drops.get(message.id);
      if (drop) drop.dropped++;
      else
        this.drops.set(message.id, { connectionId: message.id, at: message.timestamp, dropped: 1 });
    }
  }

  private failCapture(message: string): void {
    this.error = message;
    this.delivery.reset();
    this.finishFlush();
  }

  /** `restart` keeps this session's database, which a fresh app start would clear. */
  private startWorker(restart: boolean): WorkerClient<HistoryRequest> {
    return new WorkerClient(
      this.workerPath,
      { directory: this.directory, restart },
      {
        name: 'History',
        maxPending: (request) =>
          request.action === 'append' || request.action === 'close' ? 16 : 8,
        onFailure: (message) => this.failCapture(message),
      },
    );
  }

  request(request: HistoryRequest): Promise<any> {
    if (request.action === 'decoders') this.decoders = request;
    return this.worker.request(request);
  }

  status(): HistoryStatus {
    return { store: this.store, delivery: this.delivery.status(), error: this.error };
  }

  async refreshStatus(): Promise<HistoryStatus> {
    if (!this.worker.failure) this.store = await this.request({ action: 'status' });
    return this.status();
  }

  /** Retry capture; a worker that stopped responding or exited is replaced first. */
  async resume(): Promise<HistoryStatus> {
    if (this.worker.failure) {
      this.worker = this.startWorker(true);
      if (this.decoders) await this.request(this.decoders);
    }
    this.store = await this.request({ action: 'status' });
    this.error = undefined;
    return this.status();
  }

  private finishFlush(): void {
    this.flushWaiters = this.flushWaiters.filter((waiter) => {
      if (this.delivery.hasPendingThrough(waiter.checkpoint)) return true;
      waiter.resolve();
      return false;
    });
  }

  async flush(): Promise<void> {
    const checkpoint = this.delivery.checkpoint();
    if (this.delivery.hasPendingThrough(checkpoint))
      await new Promise<void>((resolve) => this.flushWaiters.push({ checkpoint, resolve }));
  }

  async clear(connectionId: string, topic?: string): Promise<HistoryStoreStatus> {
    await this.flush();
    this.store = await this.request({ action: 'clear', connectionId, topic });
    return this.store!;
  }

  /**
   * Write `pieces` (comma-joined JSON entries or newline-joined CSV rows) to a file. The target
   * is replaced only when the export completes.
   */
  private async writeExport(
    path: string,
    format: 'json' | 'csv',
    header: Record<string, unknown>,
    pieces: AsyncIterable<{ text: string; count: number }>,
  ): Promise<number> {
    const temporary = `${path}.${process.pid}.tmp`;
    const handle = await open(temporary, 'w');
    let count = 0;
    try {
      const fields = JSON.stringify({ exportDate: new Date().toISOString(), ...header });
      await handle.write(format === 'csv' ? CSV_HEADER : `${fields.slice(0, -1)},"messages":[`);
      for await (const piece of pieces) {
        if (!piece.count) continue;
        const separator = format === 'csv' ? '\n' : count ? ',' : '';
        await handle.write(separator + piece.text);
        count += piece.count;
      }
      if (format === 'json') await handle.write(`],"messageCount":${count}}`);
      await handle.sync();
      await handle.close();
      await rename(temporary, path);
      return count;
    } catch (error) {
      await handle.close().catch(() => {});
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }

  /** Stream a topic's retained history, oldest first, from a fixed snapshot. */
  async exportTo(
    connectionId: string,
    topic: string,
    format: 'json' | 'csv',
    path: string,
    connectionName: string,
  ): Promise<number> {
    await this.flush();
    const request = (query: HistoryExportQuery): Promise<HistoryExportChunk> =>
      this.request({ action: 'export-chunk', query });
    return this.writeExport(
      path,
      format,
      { connectionName, topic },
      (async function* () {
        let after = 0;
        let snapshot: number | undefined;
        for (;;) {
          const chunk = await request({ connectionId, topic, format, after, snapshot });
          snapshot = chunk.snapshot;
          yield chunk;
          if (chunk.cursor === null) return;
          after = chunk.cursor;
        }
      })(),
    );
  }

  /** Stream every match of a content search, newest first, through its bounded chunks. */
  async exportSearch(
    query: HistorySearchQuery,
    format: 'json' | 'csv',
    path: string,
    connectionName: string,
  ): Promise<{ count: number; scanned: number; skipped: number }> {
    await this.flush();
    const request = (cursor: HistorySearchQuery): Promise<HistorySearchPage> =>
      this.request({ action: 'search', query: cursor });
    let scanned = 0;
    let skipped = 0;
    const { topic, term, mode, from, to } = query;
    const count = await this.writeExport(
      path,
      format,
      {
        connectionName,
        search: { topic, term, mode, from, to },
      },
      (async function* () {
        let cursor: HistorySearchQuery = {
          ...query,
          before: undefined,
          beforeTime: undefined,
          snapshot: undefined,
        };
        for (;;) {
          const page = await request(cursor);
          scanned += page.scanned;
          skipped += page.skippedLarge + page.skippedBinary;
          const rows = page.messages.map((message) => ({ ...message, connectionId: message.id }));
          yield {
            text:
              format === 'csv'
                ? rows.map(csvRow).join('\n')
                : rows.map((row) => JSON.stringify(exportRow(row))).join(','),
            count: rows.length,
          };
          if (page.nextBefore === null) return;
          cursor = {
            ...cursor,
            before: page.nextBefore,
            beforeTime: page.nextBeforeTime!,
            snapshot: page.snapshot,
            generation: page.generation,
          };
        }
      })(),
    );
    return { count, scanned, skipped };
  }

  async close(): Promise<void> {
    this.closing = true;
    await this.flush();
    await this.worker.close({ action: 'close' });
  }
}
