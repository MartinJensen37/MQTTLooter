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
    const tree = new TopicTree('broker', limits({ maxBytes: 1000 }));
    tree.addMessage('a', 'a'.repeat(200));
    tree.addMessage('b', 'b'.repeat(200));
    expect(tree.getNode('a')).toBeUndefined();
    expect(tree.getStatistics().retainedBytes).toBeLessThanOrEqual(1000);
    tree.addMessage('b', 'x'.repeat(MESSAGE_HISTORY.MAX_BYTES_PER_TOPIC + 1));
    expect(tree.getNode('b')?.lastMessage).toBeNull();
    expect(tree.getStatistics()).toMatchObject({
      discardedMessages: 2,
      retainedMessages: 1,
      totalMessages: 3,
    });
    tree.addMessage('huge/path', 'z'.repeat(1000));
    expect(tree.getStatistics()).toMatchObject({
      retainedBytes: 0,
      nodeCount: 0,
      retainedMessages: 0,
      discardedMessages: 4,
    });
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

  it('stays within all defaults during a 20000-topic retained flood', () => {
    const tree = new TopicTree('broker');
    const payload = 'x'.repeat(4000);
    for (let i = 0; i < 20000; i++) tree.addMessage(`devices/${i}/value`, payload, 0, true, i);
    const stats = tree.getStatistics();
    expect(stats.nodeCount).toBeLessThanOrEqual(CONNECTION_HISTORY.maxNodes);
    expect(stats.retainedBytes).toBeLessThanOrEqual(CONNECTION_HISTORY.maxBytes);
    expect(stats.retainedMessages).toBeLessThanOrEqual(CONNECTION_HISTORY.maxMessages);
    expect(stats.discardedMessages + stats.retainedMessages).toBe(20000);
    expect(stats.evictedTopics).toBeGreaterThan(0);
    expect(tree.getNode('devices/19999/value')?.lastMessage?.retain).toBe(true);
  });
});
