import { join } from 'node:path';
import { MessageDelivery } from './message-delivery';
import { WorkerClient } from './worker-client';
import type { IncomingPublish } from '../shared/traffic';
import {
  HISTORY_QUEUE,
  type HistoryDrop,
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

  constructor(directory: string, workerPath = join(__dirname, 'history-worker.js')) {
    this.worker = new WorkerClient(
      workerPath,
      { directory },
      {
        name: 'History',
        maxPending: (request) =>
          request.action === 'append' || request.action === 'close' ? 16 : 8,
        onFailure: (message) => this.failCapture(message),
      },
    );
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

  request(request: HistoryRequest): Promise<any> {
    return this.worker.request(request);
  }

  status(): HistoryStatus {
    return { store: this.store, delivery: this.delivery.status(), error: this.error };
  }

  async refreshStatus(): Promise<HistoryStatus> {
    if (!this.worker.failure) this.store = await this.request({ action: 'status' });
    return this.status();
  }

  async resume(): Promise<HistoryStatus> {
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

  async close(): Promise<void> {
    this.closing = true;
    await this.flush();
    await this.worker.close({ action: 'close' });
  }
}
