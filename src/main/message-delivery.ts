import {
  DELIVERY_LIMITS,
  publishStorageBytes,
  type DeliveryCounts,
  type IncomingPublish,
  type MessageBatch,
  type TrafficStatus,
} from '../shared/traffic';

/** One acknowledged batch at a time bounds Electron's otherwise unbounded IPC queue. */
export class MessageDelivery {
  private queue: ({ message: IncomingPublish; bytes: number; ordinal: number } | undefined)[] = [];
  private head = 0;
  private bytes = 0;
  private inFlight: { batch: MessageBatch; bytes: number; firstOrdinal: number } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private immediate = false;
  private nextBatchId = 0;
  private ordinal = 0;
  private counts = new Map<string, DeliveryCounts>();

  constructor(
    private send: (batch: MessageBatch) => void,
    private limits = DELIVERY_LIMITS,
  ) {}

  enqueue(message: IncomingPublish): boolean {
    let counts = this.counts.get(message.id);
    if (!counts) {
      counts = { received: 0, processed: 0, dropped: 0 };
      this.counts.set(message.id, counts);
    }
    counts.received++;
    const bytes = publishStorageBytes(message);
    if (
      this.queue.length - this.head + (this.inFlight?.batch.messages.length ?? 0) >=
        this.limits.maxMessages ||
      this.bytes + (this.inFlight?.bytes ?? 0) + bytes > this.limits.maxBytes
    ) {
      counts.dropped++;
      return false;
    }
    this.queue.push({ message, bytes, ordinal: ++this.ordinal });
    this.bytes += bytes;
    this.schedule();
    return true;
  }

  discard(connectionId: string): void {
    let counts = this.counts.get(connectionId);
    if (!counts) {
      counts = { received: 0, processed: 0, dropped: 0 };
      this.counts.set(connectionId, counts);
    }
    counts.received++;
    counts.dropped++;
  }

  checkpoint(): number {
    return this.ordinal;
  }

  hasPendingThrough(checkpoint: number): boolean {
    return Boolean(
      (this.inFlight && this.inFlight.firstOrdinal <= checkpoint) ||
      (this.queue[this.head] && this.queue[this.head]!.ordinal <= checkpoint),
    );
  }

  private schedule(): void {
    if (this.inFlight || this.head === this.queue.length) return;
    const full =
      this.queue.length - this.head >= this.limits.batchMessages ||
      this.bytes >= this.limits.batchBytes;
    if (this.timer && (!full || this.immediate)) return;
    this.immediate = full;
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        this.flush();
      },
      full ? 0 : this.limits.flushMs,
    );
  }

  private flush(): void {
    if (this.inFlight) return;
    const firstOrdinal = this.queue[this.head]?.ordinal ?? 0;
    const messages: IncomingPublish[] = [];
    let bytes = 0;
    while (this.head < this.queue.length && messages.length < this.limits.batchMessages) {
      const next = this.queue[this.head]!;
      // A single large payload may exceed batchBytes, but never the aggregate cap.
      if (messages.length && bytes + next.bytes > this.limits.batchBytes) break;
      messages.push(next.message);
      bytes += next.bytes;
      this.queue[this.head++] = undefined;
    }
    this.bytes -= bytes;
    if (this.head === this.queue.length || this.head >= 1024) {
      this.queue = this.queue.slice(this.head);
      this.head = 0;
    }
    if (!messages.length) return;
    const batch = {
      batchId: ++this.nextBatchId,
      messages,
      dropped: Object.fromEntries([...this.counts].map(([id, counts]) => [id, counts.dropped])),
    };
    this.inFlight = { batch, bytes, firstOrdinal };
    this.send(batch);
  }

  acknowledge(batchId: number): void {
    if (batchId !== this.inFlight?.batch.batchId) return;
    for (const message of this.inFlight.batch.messages) this.counts.get(message.id)!.processed++;
    this.inFlight = null;
    this.schedule();
  }

  /** Navigation/crash ends delivery; an unacknowledged batch has an uncertain outcome. */
  reset(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    for (let index = this.head; index < this.queue.length; index++) {
      this.counts.get(this.queue[index]!.message.id)!.dropped++;
    }
    for (const message of this.inFlight?.batch.messages ?? [])
      this.counts.get(message.id)!.dropped++;
    this.queue = [];
    this.head = 0;
    this.bytes = 0;
    this.inFlight = null;
  }

  status(): TrafficStatus {
    return {
      connections: Object.fromEntries([...this.counts].map(([id, counts]) => [id, { ...counts }])),
      pendingMessages: this.queue.length - this.head,
      pendingBytes: this.bytes,
      inFlightMessages: this.inFlight?.batch.messages.length ?? 0,
      inFlightBytes: this.inFlight?.bytes ?? 0,
      maxMessages: this.limits.maxMessages,
      maxBytes: this.limits.maxBytes,
    };
  }
}
