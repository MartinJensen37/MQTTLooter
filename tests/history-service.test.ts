import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TopicTreeService } from '../src/renderer/src/services/TopicTreeService';
import { MESSAGE_HISTORY } from '../src/renderer/src/config';

const source = vi.hoisted(() => ({ receive: (_data: any) => {} }));
vi.mock('../src/renderer/src/services/MQTTService', () => ({
  default: {
    onAny: (_event, handler) => {
      source.receive = handler;
    },
  },
}));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
const receive = (id: string, topic: string, length = 300) =>
  source.receive({
    id,
    topic,
    message: 'x'.repeat(length),
    timestamp: 10000,
    qos: 0,
    retain: false,
  });

it('preserves MQTT 5 properties through live history and counts them against cache budgets', () => {
  const service = new TopicTreeService();
  const message = {
    id: 'properties',
    topic: 't',
    message: '',
    timestamp: 10000,
    qos: 0,
    retain: false,
    protocolVersion: 5,
  };
  source.receive({
    ...message,
    properties: {
      correlationData: Uint8Array.of(0, 255),
      userProperties: { key: ['first', 'second'] },
      messageExpiryInterval: 0,
    },
  });
  expect(service.getTopicMessages('properties', 't')[0]).toMatchObject({
    protocolVersion: 5,
    properties: {
      correlationData: { encoding: 'base64', data: 'AP8=' },
      userProperties: { key: ['first', 'second'] },
      messageExpiryInterval: 0,
    },
  });
  const node = service.getTopicTree('properties')!.getNode('t')!;
  expect(node.toJSON().lastMessage).not.toHaveProperty('properties');
  const before = node.messageHistory.byteUsage;
  expect(before).toBeGreaterThan(256);
  // Empty payloads with large properties must still evict old history.
  for (let i = 0; i < 30; i++)
    source.receive({ ...message, properties: { userProperties: { value: 'x'.repeat(60000) } } });
  expect(node.messageHistory.count).toBeLessThan(30);
  expect(node.messageHistory.byteUsage).toBeLessThanOrEqual(MESSAGE_HISTORY.MAX_BYTES_PER_TOPIC);
  expect(node.discardedHistory).toBeGreaterThan(0);
  expect(service.getHistorySettings().retainedBytes).toBeGreaterThan(node.messageHistory.byteUsage);
  source.receive({
    ...message,
    properties: { userProperties: { value: 'x'.repeat(MESSAGE_HISTORY.MAX_BYTES_PER_TOPIC) } },
  });
  expect(node.lastMessage).toBeNull();
  expect(node.messageHistory.byteUsage).toBeLessThanOrEqual(MESSAGE_HISTORY.MAX_BYTES_PER_TOPIC);
  service.removeTopicTree('properties');
});

it('enforces a shared cache across connections and notifies a different connection when its history expires', async () => {
  const service = new TopicTreeService(2500);
  receive('a', 'selected');
  receive('b', 'old');
  service.selectTopic('a', 'selected');
  await vi.advanceTimersByTimeAsync(150);
  const updates: any[] = [];
  service.on('treeUpdated', (data) => updates.push(data));
  receive('c', 'new');
  expect(service.getHistorySettings().retainedBytes).toBeLessThanOrEqual(2500);
  expect(service.getTopicMessages('a', 'selected')).toHaveLength(1);
  expect(service.getTopicMessages('b', 'old')).toHaveLength(0);
  expect(service.getTopicTree('b')?.getNode('old')).toBeDefined();
  await vi.advanceTimersByTimeAsync(150);
  expect(updates).toEqual(
    expect.arrayContaining([expect.objectContaining({ connectionId: 'b', topics: undefined })]),
  );
  for (let i = 0; i < 100; i++) receive('c', `flood/${i}`, 1000);
  expect(service.getHistorySettings().retainedBytes).toBeLessThanOrEqual(2500);
  expect(service.getTopicTree('a')?.getNode('selected')).toBeDefined();
  service.removeTopicTree('a');
  service.removeTopicTree('b');
  service.removeTopicTree('c');
  expect(service.getHistorySettings().retainedBytes).toBe(0);
});

it('applies resource profiles to existing and future connections without clearing protected paths', () => {
  const service = new TopicTreeService();
  receive('a', '/selected/');
  service.selectTopic('a', '/selected/');
  service.toggleTopicPin('a', '/selected/');
  for (let i = 0; i < 7000; i++) receive('a', `topic/${i}`, 0);
  expect(service.setHistoryProfile('compact')).toBe(true);
  expect(service.getTopicTreeStatistics('a')!.nodeCount).toBeLessThanOrEqual(5000);
  expect(service.getTopicTree('a')?.getNode('/selected/')).toBeDefined();
  expect(service.getTopicTreeStatistics('a')!.pinnedTopics).toEqual(['/selected/']);
  receive('b', 'new');
  expect(service.getTopicTreeStatistics('b')!.limits.maxNodes).toBe(5000);
  service.clearTopicTree('a');
  expect(service.getTopicTreeStatistics('a')!.pinnedTopics).toEqual([]);
  expect(service.setHistoryProfile('larger')).toBe(true);
  expect(service.getTopicTreeStatistics('b')!.limits.maxNodes).toBe(20000);
});
