import { describe, expect, it } from 'vitest';
import TopicTree from '../src/renderer/src/services/models/TopicTree';
import RingBuffer from '../src/renderer/src/utils/RingBuffer';

describe('topic history', () => {
  it('keeps sibling order stable as new topics arrive and traffic changes', () => {
    const tree = new TopicTree('broker');
    for (let i = 2000; i > 0; i--) tree.addMessage(`sensor/${i}`, 'value');
    tree.expandToDepth(Infinity);
    const before = tree.getFlattenedNodes().map((node) => node.fullPath);
    tree.addMessage('sensor/0', 'new');
    tree.addMessage('sensor/1000', 'updated');
    tree.updateRates();
    expect(tree.getFlattenedNodes().map((node) => node.fullPath)).toEqual([...before, 'sensor/0']);
  });

  it('searches full paths through collapsed branches without changing expansion state', () => {
    const tree = new TopicTree('broker');
    for (const topic of ['Room/Temperature', 'Room/Humidity', '/Room//Temperature', 'other'])
      tree.addMessage(topic, 'payload-only-search');
    const collapsed = tree.getFlattenedNodes().map((node) => node.fullPath);
    const matches = tree.getFlattenedNodes(false, 'TEMPERATURE');
    expect(matches.filter((node) => node.searchMatch).map((node) => node.fullPath)).toEqual([
      'Room/Temperature',
      '/Room//Temperature',
    ]);
    expect(matches.map((node) => node.fullPath)).toContain('/Room/');
    expect(tree.getFlattenedNodes(false, 'payload-only-search')).toEqual([]);
    expect(tree.getFlattenedNodes().map((node) => node.fullPath)).toEqual(collapsed);
    expect(tree.getNode('Room')?.isExpanded).toBe(false);
  });

  it('preserves empty topic levels and exact paths', () => {
    const tree = new TopicTree('broker');
    const topics = ['a/b', '/a/b', 'a//b', 'a/b/', '/', '//'];
    for (const topic of topics) tree.addMessage(topic, topic);
    for (const topic of topics) {
      expect(tree.getNode(topic)?.fullPath).toBe(topic);
      expect(tree.getNode(topic)?.messageHistory.last()?.payload).toBe(topic);
    }
    expect(new Set(topics.map((topic) => tree.getNode(topic))).size).toBe(topics.length);
  });

  it('counts parents once and clears only direct messages', () => {
    const tree = new TopicTree('broker');
    tree.addMessage('a', 'parent');
    tree.addMessage('a/b', 'child');
    tree.addMessage('a/b/c', 'grandchild');
    expect(tree.getNode('a')?.toJSON().totalMessages).toBe(3);
    tree.clearTopicMessages('a');
    expect(tree.getNode('a')?.messageCount).toBe(2);
    expect(tree.getNode('a/b')?.messageCount).toBe(2);
    expect(tree.getStatistics().totalMessages).toBe(2);
    tree.clearTopicMessages('a/b/c');
    expect(tree.getNode('a')?.messageCount).toBe(1);
    expect(tree.getStatistics().totalMessages).toBe(1);
  });

  it('measures rates beyond retained history and decays when traffic stops', () => {
    const tree = new TopicTree('broker');
    for (let i = 0; i < 2000; i++) tree.addMessage('busy', 'payload', 0, false, 10000);
    tree.updateRates(10000);
    expect(tree.getNode('busy')?.messageHistory.count).toBe(300);
    expect(tree.getStatistics().totalRate).toBe(2000);
    tree.updateRates(13000);
    expect(tree.getStatistics().totalRate).toBe(0);
  });

  it('gives same-millisecond messages stable distinct IDs and counts UTF-8 bytes', () => {
    const tree = new TopicTree('broker');
    tree.addMessage('a', '🌡', 0, false, 100);
    tree.addMessage('a', 'æ', 0, false, 100);
    const node = tree.getNode('a')!;
    expect(node.messageHistory.byteUsage).toBe(6);
    expect(new Set(node.messageHistory.toArray().map((m) => m.id)).size).toBe(2);
  });
});

describe('history buffer', () => {
  it('honors both limits through compaction', () => {
    const buffer = new RingBuffer<{ length: number; value: number }>(3, 5, 2);
    for (let value = 0; value < 100; value++) buffer.add({ length: 2, value });
    expect(buffer.toArray().map((item) => item.value)).toEqual([98, 99]);
    expect(buffer.byteUsage).toBe(4);
    buffer.add({ length: 6, value: 100 });
    expect(buffer.count).toBe(2);
    expect(buffer.byteUsage).toBe(4);
  });

  it('rejects invalid capacities rather than looping forever', () => {
    expect(() => new RingBuffer(0)).toThrow(RangeError);
    expect(() => new RingBuffer(2, -1)).toThrow(RangeError);
  });
});
