import { Worker } from 'node:worker_threads';

interface Pending {
  resolve: (data: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Request/response over a storage worker. A timeout or crash fails every request permanently. */
export class WorkerClient<Request extends { action: string }> {
  private worker: Worker;
  private pending = new Map<number, Pending>();
  private nextId = 0;
  private closing = false;
  failure?: string;

  constructor(
    path: string,
    workerData: unknown,
    private options: {
      name: string;
      maxPending: (request: Request) => number;
      onFailure: (message: string) => void;
      timeoutMs?: number;
    },
  ) {
    this.worker = new Worker(path, { workerData });
    this.worker.on('message', ({ requestId, data, error }) => {
      const pending = this.pending.get(requestId);
      if (!pending) return;
      this.pending.delete(requestId);
      clearTimeout(pending.timer);
      if (error) pending.reject(new Error(error));
      else pending.resolve(data);
    });
    this.worker.on('error', (error) => this.fail(error.message));
    this.worker.on('exit', (code) => {
      if (!this.closing) this.fail(`${options.name} worker exited (${code})`);
    });
  }

  private fail(message: string): void {
    if (this.failure) return;
    this.failure = message;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
    this.options.onFailure(message);
  }

  request(request: Request): Promise<any> {
    if (this.failure) return Promise.reject(new Error(this.failure));
    if (this.pending.size >= this.options.maxPending(request))
      return Promise.reject(new Error(`Too many ${this.options.name} requests. Try again.`));
    const requestId = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(
          `${this.options.name} worker timed out. Capture stopped; restart the app to retry.`,
        );
        void this.worker.terminate();
      }, this.options.timeoutMs ?? 10_000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.worker.postMessage({ requestId, request });
    });
  }

  async close(request: Request): Promise<void> {
    this.closing = true;
    try {
      if (!this.failure) await this.request(request);
    } finally {
      await this.worker.terminate();
    }
  }
}
