import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MessageDelivery } from '../src/main/message-delivery';
import { BatchProcessor } from '../src/renderer/src/services/BatchProcessor';
import {
  DELIVERY_COALESCE,
  DELIVERY_LIMITS,
  publishStorageBytes,
  type IncomingPublish,
  type MessageBatch,
} from '../src/shared/traffic';

const message = (sequence: number, id = 'a', payload = ''): IncomingPublish => ({
  id,
  sessionId: `session-${id}`,
  sequence,
  topic: '/a//b',
  message: payload,
  encoding: 'utf8',
  byteLength: payload.length,
  timestamp: 123,
  qos: 1,
  retain: true,
  properties: { correlationData: Buffer.from([0, 255]), userProperties: { key: 'value' } },
  protocolVersion: 5,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('batches in order, preserves MQTT metadata and waits for the matching acknowledgement', async () => {
  const batches: MessageBatch[] = [];
  const delivery = new MessageDelivery((batch) => batches.push(batch), {
    ...DELIVERY_LIMITS,
    batchMessages: 2,
  });
  const messages = [message(1), message(2, 'b'), message(3)];
  messages.forEach((m) => delivery.enqueue(m));
  await vi.runAllTimersAsync();
  expect(batches).toHaveLength(1);
  expect(batches[0].messages).toEqual(messages.slice(0, 2));
  delivery.acknowledge(999);
  await vi.runAllTimersAsync();
  expect(batches).toHaveLength(1);
  delivery.acknowledge(batches[0].batchId);
  await vi.runAllTimersAsync();
  expect(batches[1].messages).toEqual([messages[2]]);
  expect(delivery.status().connections.a.processed).toBe(1);
  delivery.acknowledge(batches[1].batchId);
  expect(delivery.status().connections).toEqual({
    a: { received: 2, processed: 2, dropped: 0 },
    b: { received: 1, processed: 1, dropped: 0 },
  });
});

it('flushes small batches after the latency window and bounds an unresponsive renderer', async () => {
  const send = vi.fn();
  const delivery = new MessageDelivery(send, {
    ...DELIVERY_LIMITS,
    maxMessages: 4,
    batchMessages: 2,
  });
  delivery.enqueue(message(1));
  await vi.advanceTimersByTimeAsync(39);
  expect(send).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  for (let i = 2; i <= 20; i++) delivery.enqueue(message(i));
  await vi.runAllTimersAsync();
  expect(send).toHaveBeenCalledTimes(1);
  expect(delivery.status()).toMatchObject({
    pendingMessages: 3,
    inFlightMessages: 1,
    connections: { a: { received: 20, dropped: 16 } },
  });
  delivery.acknowledge(1);
  await vi.runAllTimersAsync();
  expect(send.mock.calls[1][0].dropped.a).toBe(16);
  delivery.reset();
});

it('includes in-flight bytes in the budget, handles empty/large payloads and recovers after overflow', async () => {
  const send = vi.fn();
  const size = publishStorageBytes(message(1));
  const delivery = new MessageDelivery(send, {
    ...DELIVERY_LIMITS,
    maxBytes: size * 2,
    batchBytes: size,
  });
  expect(delivery.enqueue(message(1))).toBe(true);
  await vi.runAllTimersAsync();
  expect(delivery.enqueue(message(2))).toBe(true);
  expect(delivery.enqueue(message(3, 'b', 'x'.repeat(size)))).toBe(false);
  expect(delivery.enqueue(message(4))).toBe(false);
  expect(delivery.status().pendingBytes + delivery.status().inFlightBytes).toBe(size * 2);
  delivery.acknowledge(1);
  await vi.runAllTimersAsync();
  delivery.acknowledge(2);
  expect(delivery.enqueue(message(5))).toBe(true);
  await vi.runAllTimersAsync();
  expect(send.mock.calls[2][0].messages[0].sequence).toBe(5);
  delivery.reset();
  expect(delivery.status()).toMatchObject({
    pendingBytes: 0,
    inFlightBytes: 0,
    pendingMessages: 0,
  });
});

it("keeps each topic's newest overflowing message, in order, when coalescing", async () => {
  const send = vi.fn();
  const delivery = new MessageDelivery(
    send,
    { ...DELIVERY_LIMITS, maxMessages: 2, batchMessages: 2 },
    { ...DELIVERY_COALESCE, maxTopics: 2 },
  );
  const on = (sequence: number, topic: string) => ({ ...message(sequence), topic });
  expect([on(1, 'a'), on(2, 'b')].map((m) => delivery.enqueue(m))).toEqual([true, true]);
  // The queue is full: a and c wait as their newest message, 5 replacing 3; d finds no room.
  expect([on(3, 'a'), on(4, 'c'), on(5, 'a'), on(6, 'd')].map((m) => delivery.enqueue(m))).toEqual([
    true,
    true,
    true,
    false,
  ]);
  expect(delivery.status()).toMatchObject({
    coalescedTopics: 2,
    connections: { a: { received: 6, dropped: 2 } },
  });
  await vi.runAllTimersAsync();
  expect(send.mock.calls[0][0].messages.map((m: IncomingPublish) => m.sequence)).toEqual([1, 2]);
  delivery.acknowledge(send.mock.calls[0][0].batchId);
  await vi.runAllTimersAsync();
  expect(send.mock.calls[1][0].messages.map((m: IncomingPublish) => m.sequence)).toEqual([5, 4]);
  delivery.acknowledge(send.mock.calls[1][0].batchId);
  expect(delivery.enqueue(on(7, 'a'))).toBe(true);
  await vi.runAllTimersAsync();
  delivery.acknowledge(send.mock.calls[2][0].batchId);
  expect(delivery.status()).toMatchObject({
    coalescedTopics: 0,
    connections: { a: { received: 7, processed: 5, dropped: 2 } },
  });
  // Navigation drops coalesced messages with everything else.
  delivery.pause();
  [8, 9, 10].forEach((sequence) => delivery.enqueue(on(sequence, `t${sequence}`)));
  delivery.reset();
  expect(delivery.status()).toMatchObject({
    coalescedTopics: 0,
    connections: { a: { received: 10, dropped: 5 } },
  });
});

it('cannot acknowledge a new stream with an old batch ID after navigation', async () => {
  const send = vi.fn();
  const delivery = new MessageDelivery(send);
  delivery.enqueue(message(1));
  await vi.runAllTimersAsync();
  delivery.enqueue(message(2));
  delivery.reset();
  delivery.enqueue(message(3));
  await vi.runAllTimersAsync();
  delivery.acknowledge(1);
  expect(delivery.status().inFlightMessages).toBe(1);
  expect(delivery.status().connections.a.dropped).toBe(2);
  delivery.acknowledge(2);
  expect(delivery.status().connections.a.processed).toBe(1);
});

it('lets control tasks run between renderer slices and only acknowledges completed delivery', async () => {
  const received: number[] = [];
  const ack = vi.fn();
  const processor = new BatchProcessor((m) => received.push(m.sequence), ack);
  processor.accept({
    batchId: 7,
    dropped: {},
    messages: Array.from({ length: 128 }, (_, i) => message(i)),
  });
  const control = vi.fn(() => {
    expect(received.length).toBeLessThan(128);
    expect(ack).not.toHaveBeenCalled();
  });
  setTimeout(control, 0);
  await vi.runAllTimersAsync();
  expect(control).toHaveBeenCalledOnce();
  expect(received).toEqual(Array.from({ length: 128 }, (_, i) => i));
  expect(ack).toHaveBeenCalledExactlyOnceWith(7);
});

it('holds bounded traffic during renderer startup and resumes after listener readiness', async () => {
  const send = vi.fn();
  const delivery = new MessageDelivery(send, { ...DELIVERY_LIMITS, maxMessages: 3 });
  delivery.enqueue(message(1));
  await vi.runAllTimersAsync();
  const oldBatchId = send.mock.calls[0][0].batchId;
  delivery.pause();
  for (let i = 2; i <= 5; i++) delivery.enqueue(message(i));
  await vi.runAllTimersAsync();
  expect(send).toHaveBeenCalledTimes(1);
  expect(delivery.status()).toMatchObject({
    pendingMessages: 3,
    inFlightMessages: 0,
    connections: { a: { received: 5, processed: 0, dropped: 2 } },
  });
  delivery.resume();
  delivery.resume(); // Duplicate readiness must not reset an active stream.
  await vi.runAllTimersAsync();
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1][0].messages.map((m) => m.sequence)).toEqual([2, 3, 4]);
  delivery.acknowledge(oldBatchId);
  expect(delivery.status().inFlightMessages).toBe(3);
  delivery.acknowledge(send.mock.calls[1][0].batchId);
  expect(delivery.status().connections.a.processed).toBe(3);
});
