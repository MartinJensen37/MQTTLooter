import { describe, expect, it } from 'vitest';
import TopicTree from '../src/renderer/src/services/models/TopicTree';
import { CONNECTION_HISTORY, MESSAGE_HISTORY } from '../src/renderer/src/config';

const limits = (overrides: Partial<typeof CONNECTION_HISTORY>) => ({
  ...CONNECTION_HISTORY,
  ...overrides,
});

describe('connection history budgets', () => {
  it('evicts least recently received topics and preserves shared parents', () => {
    const tree = new TopicTree('broker', limits({ maxNodes: 3 }));
    tree.addMessage('a', 'parent');
    tree.addMessage('a/b', 'old');
    tree.addMessage('a/c', 'child');
    tree.addMessage('a', 'recent');
    tree.addMessage('a/d', 'new');
    expect(tree.getNode('a/b')).toBeUndefined();
    expect(tree.getNode('a')?.messageCount).toBe(4);
    expect(tree.getNode('a')?.directMessageCount).toBe(2);
    expect(tree.getStatistics()).toMatchObject({
      nodeCount: 3,
      retainedMessages: 4,
      totalMessages: 5,
      discardedMessages: 1,
    });
  });

  it('releases branches and bytes, including empty topic levels', () => {
    const tree = new TopicTree('broker', limits({ maxNodes: 3 }));
    tree.addMessage('/a/', 'old');
    tree.addMessage('b//', 'new');
    expect(tree.getNode('/a/')).toBeUndefined();
    expect(tree.getNode('')).toBeUndefined();
    expect(tree.getNode('b//')?.fullPath).toBe('b//');
    const fresh = new TopicTree('broker', limits({ maxNodes: 3 }));
    fresh.addMessage('b//', 'new');
    expect(tree.getStatistics().retainedBytes).toBe(fresh.getStatistics().retainedBytes);
    tree.clearTopicMessages('b//');
    expect(tree.getStatistics().retainedMessages).toBe(0);
    tree.clear();
    expect(tree.getStatistics()).toMatchObject({
      retainedBytes: 0,
      nodeCount: 0,
      discardedMessages: 0,
    });
  });

  it('bounds encoded storage, counts discarded messages, and never caches oversized payloads', () => {
    const tree = new TopicTree('broker', limits({ maxBytes: 1100 }));
    tree.addMessage('a', 'a'.repeat(200));
    tree.addMessage('b', 'b'.repeat(200));
    expect(tree.getNode('a')?.messageHistory.count).toBe(0);
    expect(tree.getNode('a')?.directMessageCount).toBe(1);
    expect(tree.getStatistics().retainedBytes).toBeLessThanOrEqual(1100);
    tree.addMessage('b', 'x'.repeat(MESSAGE_HISTORY.MAX_BYTES_PER_TOPIC + 1));
    expect(tree.getNode('b')?.lastMessage).toBeNull();
    expect(tree.getStatistics()).toMatchObject({
      discardedMessages: 2,
      retainedMessages: 1,
      totalMessages: 3,
    });
    tree.addMessage('huge/path', 'z'.repeat(1000));
    expect(tree.getStatistics()).toMatchObject({
      retainedMessages: 0,
      discardedMessages: 4,
    });
    expect(tree.getNode('huge/path')).toBeDefined();
    expect(tree.getStatistics().retainedBytes).toBeLessThanOrEqual(1100);
  });

  it('bounds message count and keeps IDs unique across eviction and clearing', () => {
    const tree = new TopicTree('broker', limits({ maxMessages: 1 }));
    tree.addMessage('a', 'first', 0, false, 1);
    const first = tree.getNode('a')!.messageHistory.last()!.id;
    tree.addMessage('b', 'second', 0, false, 1);
    tree.addMessage('a', 'third', 0, false, 1);
    const third = tree.getNode('a')!.messageHistory.last()!.id;
    tree.clear();
    tree.addMessage('a', 'fourth', 0, false, 1);
    expect(tree.getNode('a')!.messageHistory.last()!.id).toBeGreaterThan(third);
    expect(third).toBeGreaterThan(first);
  });

  it('rejects excessive depth without growing the tree', () => {
    const tree = new TopicTree('broker', limits({ maxDepth: 2 }));
    tree.addMessage('a/b/c', 'ignored');
    expect(tree.getStatistics()).toMatchObject({
      nodeCount: 0,
      retainedBytes: 0,
      discardedMessages: 1,
      totalMessages: 1,
    });
  });

  it('preserves selected and pinned paths including empty ancestors during node pressure', () => {
    const tree = new TopicTree('broker', limits({ maxNodes: 6, maxMessages: 3 }));
    tree.addMessage('/a/', 'inspected');
    tree.addMessage('pinned', 'keep');
    tree.selectTopic('/a/');
    expect(tree.pinTopic('pinned')).toBe(true);
    for (let i = 0; i < 100; i++) tree.addMessage(`noise/${i}`, 'new');
    expect(tree.getNode('/a/')?.messageHistory.last()?.payload).toBe('inspected');
    expect(tree.getNode('')?.fullPath).toBe('');
    expect(tree.getNode('/a')?.fullPath).toBe('/a');
    expect(tree.getNode('pinned')?.messageHistory.last()?.payload).toBe('keep');
    expect(tree.getStatistics().nodeCount).toBeLessThanOrEqual(6);
    tree.selectTopic(null);
    tree.pinTopic('pinned');
    for (let i = 100; i < 110; i++) tree.addMessage(`noise/${i}`, 'new');
    expect(tree.getNode('/a/')).toBeUndefined();
    expect(tree.getNode('pinned')).toBeUndefined();
  });

  it('expires protected payloads without losing selection, counts or rates', () => {
    const tree = new TopicTree('broker', limits({ maxBytes: 1000 }));
    tree.addMessage('selected', 'first', 0, false, 10000);
    tree.selectTopic('selected');
    tree.addMessage('selected', 'x'.repeat(500), 0, false, 10000);
    tree.updateRates(10000);
    const node = tree.getNode('selected')!;
    expect(node.messageHistory.count).toBe(0);
    expect(node.lastMessage).toBeNull();
    expect(node.toJSON()).toMatchObject({ discardedHistory: 2, totalMessages: 2 });
    expect(tree.getStatistics().totalRate).toBe(2);
    expect(tree.getStatistics().selectedTopic).toBe('selected');
    expect(tree.getStatistics().retainedBytes).toBeLessThanOrEqual(1000);
    tree.clearTopicMessages('selected');
    expect(node.discardedHistory).toBe(0);
    tree.clear();
    expect(tree.getNode('selected')).toBeUndefined();
    expect(tree.getStatistics().selectedTopic).toBeNull();
  });

  it('protects one selected path per view', () => {
    const tree = new TopicTree('broker', limits({ maxNodes: 4, maxMessages: 2 }));
    tree.addMessage('main', 'kept');
    tree.addMessage('pane', 'kept');
    tree.selectTopic('main');
    tree.selectTopic('pane', 'pane');
    for (let i = 0; i < 20; i++) tree.addMessage(`noise/${i}`, 'new');
    expect(tree.getNode('main')?.lastMessage?.payload).toBe('kept');
    expect(tree.getNode('pane')?.lastMessage?.payload).toBe('kept');
    expect(tree.getStatistics().selectedTopic).toBe('main');
    // Clearing one view's selection leaves the other protected.
    tree.selectTopic(null, 'pane');
    for (let i = 20; i < 40; i++) tree.addMessage(`noise/${i}`, 'new');
    expect(tree.getNode('pane')).toBeUndefined();
    expect(tree.getNode('main')?.lastMessage?.payload).toBe('kept');
  });

  it('rejects new paths when all nodes are protected and bounds pin count', () => {
    const tree = new TopicTree('broker', limits({ maxNodes: 2 }));
    tree.addMessage('a', 'a');
    tree.addMessage('b', 'b');
    tree.selectTopic('a');
    tree.pinTopic('b');
    tree.addMessage('c', 'rejected');
    expect(tree.getStatistics()).toMatchObject({ nodeCount: 2, discardedMessages: 1 });
    expect(tree.getNode('c')).toBeUndefined();
    expect(tree.setLimits(limits({ maxNodes: 1 }))).toBe(false);
    expect(tree.getStatistics().limits.maxNodes).toBe(2);
    const pins = new TopicTree('pins');
    for (let i = 0; i < 9; i++) {
      pins.addMessage(`${i}`, 'value');
      expect(pins.pinTopic(`${i}`)).toBe(i < 8);
    }
    expect(pins.pins).toHaveLength(8);
    pins.clear();
    expect(pins.pins).toEqual([]);
  });

  it('stays within all defaults during a 50000-topic retained flood while protecting inspection', () => {
    const tree = new TopicTree('broker');
    const payload = 'x'.repeat(4000);
    tree.addMessage('inspected/leaf', 'keep', 0, true, 0);
    tree.selectTopic('inspected/leaf');
    const started = performance.now();
    for (let i = 0; i < 50000; i++) tree.addMessage(`devices/${i}/value`, payload, 0, true, i);
    const stats = tree.getStatistics();
    expect(stats.nodeCount).toBeLessThanOrEqual(CONNECTION_HISTORY.maxNodes);
    expect(stats.retainedBytes).toBeLessThanOrEqual(CONNECTION_HISTORY.maxBytes);
    expect(stats.retainedMessages).toBeLessThanOrEqual(CONNECTION_HISTORY.maxMessages);
    expect(stats.discardedMessages + stats.retainedMessages).toBe(50001);
    expect(stats.evictedTopics).toBeGreaterThan(0);
    expect(tree.getNode('devices/49999/value')?.lastMessage?.retain).toBe(true);
    expect(tree.getNode('inspected/leaf')?.lastMessage?.payload).toBe('keep');
    if (process.env.MQTT_LOAD_REPORT)
      console.log(
        JSON.stringify({
          topicsReceived: 50001,
          elapsedMs: Math.round(performance.now() - started),
          retainedBytes: stats.retainedBytes,
          nodes: stats.nodeCount,
          retainedMessages: stats.retainedMessages,
          discardedMessages: stats.discardedMessages,
          processRss: process.memoryUsage().rss,
        }),
      );
  });
});
