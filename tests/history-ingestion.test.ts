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
  for (let i = 0; i < 1024; i++) service.append(message(i));
  const flushed = vi.fn();
  const result = service.flush().then(flushed);
  for (let i = 1024; i < 2048; i++) service.append(message(i));
  await vi.advanceTimersByTimeAsync(0);
  const first = worker.requests.find((item: any) => item.request.action === 'append');
  expect(first.request.messages).toHaveLength(1024);
  expect(flushed).not.toHaveBeenCalled();
  worker.reply(first);
  await result;
  expect(flushed).toHaveBeenCalledOnce();
  expect(service.status().delivery.pendingMessages).toBe(1024);
});

it('keeps capturing after an overflow and writes the omission as a gap record', async () => {
  const service = new HistoryService('unused');
  const worker = workers[0];
  worker.reply(worker.requests[0]);
  for (let i = 0; i < 16_386; i++) service.append(message(i));
  expect(service.status().error).toBeUndefined();
  expect(service.status().delivery.connections.a).toMatchObject({ received: 16_386, dropped: 2 });
  await vi.advanceTimersByTimeAsync(0);
  const appends = () => worker.requests.filter((item: any) => item.request.action === 'append');
  expect(appends()[0].request.drops).toEqual([
    { connectionId: 'a', at: expect.any(Number), dropped: 2 },
  ]);
  worker.reply(appends()[0]);
  await vi.advanceTimersByTimeAsync(0);
  // Later traffic is accepted again once the queue drains.
  service.append(message(20_000));
  expect(service.status().delivery.connections.a.dropped).toBe(2);
  expect(appends()[1].request.drops).toEqual([]);
});

it('rejects outstanding queries and releases the write queue after a worker crash', async () => {
  const service = new HistoryService('unused');
  const worker = workers[0];
  worker.reply(worker.requests[0]);
  service.append(message(1));
  await vi.advanceTimersByTimeAsync(100);
  const query = service.request({ action: 'page', query: { connectionId: 'a', topic: 'a' } });
  const rejected = expect(query).rejects.toThrow('disk failed');
  worker.emit('error', new Error('disk failed'));
  await rejected;
  await service.flush();
  expect(service.status().error).toBe('disk failed');
  expect(service.status().delivery.connections.a.dropped).toBe(1);
  // Resume starts a new worker that keeps this session's database, and capture continues.
  const resumed = service.resume();
  await vi.advanceTimersByTimeAsync(0);
  expect(workers).toHaveLength(2);
  workers[1].reply(workers[1].requests[0], { messages: 0 });
  expect((await resumed).error).toBeUndefined();
  const close = service.close();
  await vi.advanceTimersByTimeAsync(0);
  for (const request of workers[1].requests.slice(1)) workers[1].reply(request);
  await close;
});
