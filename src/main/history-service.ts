import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { MessageDelivery } from './message-delivery';
import type { IncomingPublish } from '../shared/traffic';
import type { HistoryRequest, HistoryStatus, HistoryStoreStatus } from '../shared/history';

/** Bounded writes and requests keep database work away from main's connection controls. */
export class HistoryService {
  private worker: Worker;
  private pending = new Map<
    number,
    {
      resolve: (data: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private nextId = 0;
  private error?: string;
  private workerFailed = false;
  private closing = false;
  private store?: HistoryStoreStatus;
  private flushWaiters: { checkpoint: number; resolve: () => void }[] = [];
  private delivery = new MessageDelivery((batch) => {
    void this.request({ action: 'append', messages: batch.messages })
      .then((status) => {
        this.store = status;
        this.delivery.acknowledge(batch.batchId);
        this.finishFlush();
      })
      .catch((error: Error) => this.failCapture(error.message));
  });

  constructor(directory: string, workerPath = join(__dirname, 'history-worker.js')) {
    this.worker = new Worker(workerPath, { workerData: { directory } });
    this.worker.on('message', ({ requestId, data, error }) => {
      const pending = this.pending.get(requestId);
      if (!pending) return;
      this.pending.delete(requestId);
      clearTimeout(pending.timer);
      if (error) pending.reject(new Error(error));
      else pending.resolve(data);
    });
    this.worker.on('error', (error) => this.failWorker(error.message));
    this.worker.on('exit', (code) => {
      if (!this.closing) this.failWorker(`History worker exited (${code})`);
    });
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
    if (!this.delivery.enqueue(message))
      this.failCapture('Disk history queue is full. Capture stopped; history has a gap.');
  }

  private failCapture(message: string): void {
    this.error = message;
    this.delivery.reset();
    this.finishFlush();
  }

  private failWorker(message: string): void {
    this.workerFailed = true;
    this.failCapture(message);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }

  request(request: HistoryRequest): Promise<any> {
    if (this.workerFailed) return Promise.reject(new Error(this.error ?? 'History unavailable'));
    if (this.pending.size >= (request.action === 'append' || request.action === 'close' ? 16 : 8))
      return Promise.reject(new Error('Too many history requests. Try again.'));
    const requestId = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failWorker('History worker timed out. Capture stopped; restart the app to retry.');
        void this.worker.terminate();
      }, 10_000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.worker.postMessage({ requestId, request });
    });
  }

  status(): HistoryStatus {
    return { store: this.store, delivery: this.delivery.status(), error: this.error };
  }

  async refreshStatus(): Promise<HistoryStatus> {
    if (!this.workerFailed) this.store = await this.request({ action: 'status' });
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
    try {
      if (!this.workerFailed) await this.request({ action: 'close' });
    } finally {
      await this.worker.terminate();
    }
  }
}
