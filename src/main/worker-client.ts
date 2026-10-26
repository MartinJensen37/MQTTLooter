import { Worker } from 'node:worker_threads';

const TICK_MS = 500;

interface Pending {
  resolve: (data: any) => void;
  reject: (error: Error) => void;
  /** Time spent waiting while the app was running. */
  waited: number;
}

/** Request/response over a storage worker. A timeout or crash fails every request permanently. */
export class WorkerClient<Request extends { action: string }> {
  private worker: Worker;
  private pending = new Map<number, Pending>();
  private nextId = 0;
  private closing = false;
  private ticker?: ReturnType<typeof setInterval>;
  private lastTick = 0;
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
      this.unwatch();
      if (error) pending.reject(new Error(error));
      else pending.resolve(data);
    });
    this.worker.on('error', (error) => this.fail(error.message));
    this.worker.on('exit', (code) => {
      if (!this.closing) this.fail(`${options.name} worker exited (${code})`);
    });
  }

  /**
   * The watchdog counts at most two ticks per tick, so time the computer spends asleep, or the
   * app spends stalled, never counts against a request: after waking up, the worker gets its
   * full time to answer.
   */
  private tick = () => {
    const now = Date.now();
    const elapsed = Math.max(0, Math.min(now - this.lastTick, TICK_MS * 2));
    this.lastTick = now;
    for (const pending of this.pending.values()) {
      pending.waited += elapsed;
      if (pending.waited >= (this.options.timeoutMs ?? 10_000)) {
        this.fail(`${this.options.name} worker stopped responding.`);
        void this.worker.terminate();
        return;
      }
    }
  };

  private unwatch(): void {
    if (this.pending.size || !this.ticker) return;
    clearInterval(this.ticker);
    this.ticker = undefined;
  }

  private fail(message: string): void {
    if (this.failure) return;
    this.failure = message;
    for (const pending of this.pending.values()) pending.reject(new Error(message));
    this.pending.clear();
    this.unwatch();
    this.options.onFailure(message);
  }

  request(request: Request): Promise<any> {
    if (this.failure) return Promise.reject(new Error(this.failure));
    if (this.pending.size >= this.options.maxPending(request))
      return Promise.reject(new Error(`Too many ${this.options.name} requests. Try again.`));
    const requestId = ++this.nextId;
    if (!this.ticker) {
      this.lastTick = Date.now();
      this.ticker = setInterval(this.tick, TICK_MS);
    }
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, waited: 0 });
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
