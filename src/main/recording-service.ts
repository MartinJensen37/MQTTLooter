import { open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { MessageDelivery } from './message-delivery';
import { WorkerClient } from './worker-client';
import type { CaptureMessage } from './recording-database';
import type { IncomingPublish, MessageBatch } from '../shared/traffic';
import {
  RECORDING_LIMITS,
  RECORDING_QUEUE,
  type RecordingGap,
  type RecordingNotice,
  type RecordingRequest,
  type RecordingStatus,
  type RecordingSummary,
} from '../shared/recording';

interface Capture {
  recordingId: number;
  connectionId: string;
  startTime: number;
  messageCount: number;
  topicCount: number;
  dropped: number;
  /** Drops not yet written as a gap record. */
  pendingDrops: number;
  firstDropAt: number;
}

/**
 * Captures run in main, ahead of renderer delivery, so renderer reloads, delivery gaps and the
 * selected connection do not affect them. Writes go through their own bounded queue and worker.
 */
export class RecordingService {
  private worker: Pick<WorkerClient<RecordingRequest>, 'request' | 'close' | 'failure'>;
  private captures = new Map<string, Capture>();
  private error?: string;
  private closing = false;
  private store?: { databaseBytes: number; recovered: number; migrationError?: string };
  private notices: RecordingNotice[] = [];
  private nextNotice = 0;
  private flushWaiters: { checkpoint: number; resolve: () => void }[] = [];
  private stopping = new Set<Promise<unknown>>();
  private delivery: MessageDelivery;

  /** `client` replaces the worker in tests; it receives the same failure callback. */
  constructor(
    directory: string,
    options: {
      workerPath?: string;
      queueLimits?: typeof RECORDING_QUEUE;
      client?: (
        onFailure: (message: string) => void,
      ) => Pick<WorkerClient<RecordingRequest>, 'request' | 'close' | 'failure'>;
    } = {},
  ) {
    this.delivery = new MessageDelivery(
      (batch) => this.write(batch),
      options.queueLimits ?? RECORDING_QUEUE,
    );
    const onFailure = (message: string) => this.fail(message);
    this.worker =
      options.client?.(onFailure) ??
      new WorkerClient(
        options.workerPath ?? join(__dirname, 'recording-worker.js'),
        { directory },
        {
          name: 'Recording',
          maxPending: (request) =>
            request.action === 'append' || request.action === 'finish' ? 32 : 16,
          onFailure,
          // Startup may import a 64 MiB legacy library before answering.
          timeoutMs: 30_000,
        },
      );
    void this.refresh().catch(() => {});
  }

  private write(batch: MessageBatch): void {
    void this.worker
      .request({
        action: 'append',
        messages: batch.messages as CaptureMessage[],
        drops: this.takeDrops(),
      })
      .then(({ counts, stopped }) => {
        for (const count of counts) {
          const capture = this.byRecording(count.recordingId);
          if (capture) Object.assign(capture, count);
        }
        for (const { recordingId, reason } of stopped) {
          const capture = this.byRecording(recordingId);
          if (!capture) continue;
          this.captures.delete(capture.connectionId);
          this.notify(capture, reason);
        }
        this.delivery.acknowledge(batch.batchId);
        this.finishFlush();
      })
      .catch((error: Error) => this.fail(error.message));
  }

  private byRecording(recordingId: number): Capture | undefined {
    for (const capture of this.captures.values())
      if (capture.recordingId === recordingId) return capture;
  }

  private notify(capture: Capture, reason: string): void {
    this.notices = [
      ...this.notices.slice(-15),
      {
        id: ++this.nextNotice,
        recordingId: capture.recordingId,
        connectionId: capture.connectionId,
        reason,
      },
    ];
  }

  private fail(message: string): void {
    if (this.error) return;
    this.error = `Recording storage failed: ${message}`;
    for (const capture of this.captures.values()) this.notify(capture, this.error);
    this.captures.clear();
    this.delivery.reset();
    this.finishFlush();
  }

  private takeDrops() {
    const drops: { recordingId: number; at: number; dropped: number }[] = [];
    for (const capture of this.captures.values()) {
      if (!capture.pendingDrops) continue;
      drops.push({
        recordingId: capture.recordingId,
        at: capture.firstDropAt,
        dropped: capture.pendingDrops,
      });
      capture.pendingDrops = 0;
    }
    return drops;
  }

  capture(message: IncomingPublish): void {
    const capture = this.captures.get(message.id);
    if (!capture || this.closing) return;
    if (
      !this.delivery.enqueue({ ...message, recordingId: capture.recordingId } as IncomingPublish)
    ) {
      if (!capture.pendingDrops) capture.firstDropAt = message.timestamp;
      capture.pendingDrops++;
      capture.dropped++;
    }
  }

  async start(
    connectionId: string,
    connectionName: string,
    name: string,
  ): Promise<RecordingSummary> {
    if (this.error) throw new Error(this.error);
    if (this.captures.has(connectionId)) throw new Error('This connection is already recording');
    const summary: RecordingSummary = await this.worker.request({
      action: 'create',
      connectionId,
      connectionName,
      name,
      at: Date.now(),
    });
    this.captures.set(connectionId, {
      recordingId: summary.id,
      connectionId,
      startTime: summary.startTime,
      messageCount: 0,
      topicCount: 0,
      dropped: 0,
      pendingDrops: 0,
      firstDropAt: 0,
    });
    return summary;
  }

  /** Stop capturing now, then write everything already queued before finishing. */
  stop(connectionId: string, reason?: string): Promise<RecordingSummary | null> {
    const capture = this.captures.get(connectionId);
    if (!capture) return Promise.resolve(null);
    this.captures.delete(connectionId);
    const stopping = this.finish(capture, reason);
    this.stopping.add(stopping);
    void stopping.catch(() => {}).finally(() => this.stopping.delete(stopping));
    return stopping;
  }

  private async finish(capture: Capture, reason?: string): Promise<RecordingSummary | null> {
    await this.flush();
    if (this.error) return null;
    if (capture.pendingDrops)
      await this.worker.request({
        action: 'append',
        messages: [],
        drops: [
          {
            recordingId: capture.recordingId,
            at: capture.firstDropAt,
            dropped: capture.pendingDrops,
          },
        ],
      });
    return this.worker.request({
      action: 'finish',
      recordingId: capture.recordingId,
      at: Date.now(),
      reason,
    });
  }

  /** One gap per outage; automatic reconnects keep the capture running. */
  connectionLost(connectionId: string): void {
    const capture = this.captures.get(connectionId);
    if (capture)
      void this.worker
        .request({
          action: 'gap',
          recordingId: capture.recordingId,
          at: Date.now(),
          kind: 'connection',
        })
        .catch(() => {});
  }

  connectionRestored(connectionId: string): void {
    const capture = this.captures.get(connectionId);
    if (capture)
      void this.worker
        .request({ action: 'resolve-gaps', recordingId: capture.recordingId, at: Date.now() })
        .catch(() => {});
  }

  private finishFlush(): void {
    this.flushWaiters = this.flushWaiters.filter((waiter) => {
      if (this.delivery.hasPendingThrough(waiter.checkpoint)) return true;
      waiter.resolve();
      return false;
    });
  }

  private async flush(): Promise<void> {
    const checkpoint = this.delivery.checkpoint();
    if (this.delivery.hasPendingThrough(checkpoint))
      await new Promise<void>((resolve) => this.flushWaiters.push({ checkpoint, resolve }));
  }

  async refresh(): Promise<RecordingStatus> {
    if (!this.worker.failure) this.store = await this.worker.request({ action: 'status' });
    return this.status();
  }

  status(): RecordingStatus {
    const delivery = this.delivery.status();
    return {
      active: [...this.captures.values()].map((capture) => ({
        recordingId: capture.recordingId,
        connectionId: capture.connectionId,
        startTime: capture.startTime,
        messageCount: capture.messageCount,
        topicCount: capture.topicCount,
        dropped: capture.dropped,
      })),
      queuedMessages: delivery.pendingMessages + delivery.inFlightMessages,
      notices: this.notices,
      databaseBytes: this.store?.databaseBytes,
      maxDatabaseBytes: RECORDING_LIMITS.maxDatabaseBytes,
      recovered: this.store?.recovered,
      migrationError: this.store?.migrationError,
      error: this.error,
    };
  }

  request(request: RecordingRequest): Promise<any> {
    return this.worker.request(request);
  }

  /** Import a recording file of any size in bounded worker steps. */
  async importFile(path: string): Promise<RecordingSummary> {
    const importId: number = await this.worker.request({ action: 'import-begin', path });
    for (;;) {
      const step = await this.worker.request({ action: 'import-step', importId });
      if (step.done) return step.summary;
    }
  }

  /** Stream a recording to a file in chunks; the target is replaced only when complete. */
  async exportTo(recordingId: number, path: string): Promise<void> {
    const summary: RecordingSummary | null = await this.request({ action: 'summary', recordingId });
    if (!summary) throw new Error('Recording not found');
    const gaps: RecordingGap[] = await this.request({ action: 'gaps', recordingId });
    const iso = (time: number | null) => (time === null ? null : new Date(time).toISOString());
    const temporary = `${path}.${process.pid}.tmp`;
    const handle = await open(temporary, 'w');
    try {
      const endTime = summary.endTime ?? Date.now();
      await handle.write(
        `{"recordingInfo":${JSON.stringify({
          name: summary.name,
          startTime: iso(summary.startTime),
          endTime: iso(endTime),
          duration: endTime - summary.startTime,
          messageCount: summary.messageCount,
          topic: summary.topic,
          connectionName: summary.connectionName,
          incompleteReason: summary.incompleteReason,
          gaps: gaps.map((gap) => ({ ...gap, at: iso(gap.at), until: iso(gap.until) })),
        })},"messages":[`,
      );
      let after = 0;
      let first = true;
      for (;;) {
        const chunk: { json: string; cursor: number | null } = await this.request({
          action: 'export-chunk',
          recordingId,
          after,
        });
        if (chunk.json) {
          await handle.write(first ? chunk.json : `,${chunk.json}`);
          first = false;
        }
        if (chunk.cursor === null) break;
        after = chunk.cursor;
      }
      await handle.write(']}');
      await handle.sync();
      await handle.close();
      await rename(temporary, path);
    } catch (error) {
      await handle.close().catch(() => {});
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }

  async close(): Promise<void> {
    for (const id of [...this.captures.keys()]) void this.stop(id);
    this.closing = true;
    await Promise.allSettled(this.stopping);
    await this.worker.close({ action: 'close' });
  }
}
