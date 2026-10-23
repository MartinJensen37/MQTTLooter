import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HistoryService } from '../src/main/history-service';
import type { IncomingPublish } from '../src/shared/traffic';

const workers = vi.hoisted(() => [] as any[]);
vi.mock('node:worker_threads', () => ({
  Worker: class extends EventEmitter {
    requests: any[] = [];
    constructor() {
      super();
      workers.push(this);
    }
    postMessage(message: any) {
      this.requests.push(message);
    }
    terminate = vi.fn(async () => 0);
    reply(request: any, data: any = {}, error?: string) {
      this.emit('message', { requestId: request.requestId, data, error });
    }
  },
}));

const message = (sequence: number): IncomingPublish => ({
  id: 'a',
  sessionId: 's',
  sequence,
  topic: 'a',
  message: '',
  encoding: 'utf8',
  byteLength: 0,
  timestamp: Date.now(),
  qos: 0,
  retain: false,
  protocolVersion: 5,
});
beforeEach(() => {
  vi.useFakeTimers();
  workers.length = 0;
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it('flushes a checkpoint without waiting indefinitely for subsequent live traffic', async () => {
  const service = new HistoryService('unused');
  const worker = workers[0];
  worker.reply(worker.requests[0]);
  for (let i = 0; i < 128; i++) service.append(message(i));
  const flushed = vi.fn();
  const result = service.flush().then(flushed);
  for (let i = 128; i < 256; i++) service.append(message(i));
  await vi.advanceTimersByTimeAsync(0);
  const first = worker.requests.find((item: any) => item.request.action === 'append');
  expect(first.request.messages).toHaveLength(128);
  expect(flushed).not.toHaveBeenCalled();
  worker.reply(first);
  await result;
  expect(flushed).toHaveBeenCalledOnce();
  expect(service.status().delivery.pendingMessages).toBe(128);
});

it('stops disk capture visibly on overflow and counts subsequent omissions', async () => {
  const service = new HistoryService('unused');
  workers[0].reply(workers[0].requests[0]);
  for (let i = 0; i < 8194; i++) service.append(message(i));
  expect(service.status().error).toContain('queue is full');
  expect(service.status().delivery.connections.a).toEqual({
    received: 8194,
    processed: 0,
    dropped: 8194,
  });
  expect(service.status().delivery.pendingBytes).toBe(0);
  await service.flush();
});

it('rejects outstanding queries and releases the write queue after a worker crash', async () => {
  const service = new HistoryService('unused');
  const worker = workers[0];
  worker.reply(worker.requests[0]);
  service.append(message(1));
  await vi.advanceTimersByTimeAsync(40);
  const query = service.request({ action: 'page', query: { connectionId: 'a', topic: 'a' } });
  const rejected = expect(query).rejects.toThrow('disk failed');
  worker.emit('error', new Error('disk failed'));
  await rejected;
  await service.flush();
  expect(service.status().error).toBe('disk failed');
  expect(service.status().delivery.connections.a.dropped).toBe(1);
  await expect(service.resume()).rejects.toThrow('disk failed');
  await service.close();
});
