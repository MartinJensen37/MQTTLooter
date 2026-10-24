// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import TopicTreeComponent from '../src/renderer/src/components/TopicTree/TopicTreeComponent';

vi.mock('../src/renderer/src/components/TopicTree/TrafficStatus', () => ({ default: () => null }));
vi.mock('../src/renderer/src/components/TopicTree/HistoryControls', () => ({
  default: () => null,
}));
// Geometry/virtualization are covered in Electron; this test exercises event refresh.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }) => ({
    getTotalSize: () => count * 38,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, size: 38, start: index * 38 })),
  }),
}));

it('shows incoming topics and expansion without waiting for animation frames', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
  const host = document.createElement('div');
  const root = createRoot(host);
  const handlers = new Map();
  let nodes: any[] = [];
  const service = {
    getHistorySettings: () => ({}),
    getTopicTreeStatistics: () => null,
    getTopicTreeNodes: vi.fn(() => nodes),
    on: (event, handler) => handlers.set(event, handler),
    off: (event) => handlers.delete(event),
    expandTopicTreeToDepth: () => {
      nodes = [...nodes, { fullPath: 'sensor/value', name: 'value', depth: 1, isLeaf: true }];
      handlers.get('treeExpanded')({ connectionId: 'test' });
    },
  };
  try {
    await act(async () =>
      root.render(<TopicTreeComponent connectionId="test" topicTreeService={service} />),
    );
    expect(host.textContent).toContain('Waiting for messages');
    await act(async () => {
      nodes = [{ fullPath: 'sensor', name: 'sensor', depth: 0, hasChildren: true }];
      handlers.get('treeUpdated')({ connectionId: 'test' });
      handlers.get('treeUpdated')({ connectionId: 'test' });
      await vi.runAllTimersAsync();
    });
    expect(host.querySelector('[title="sensor"]')).not.toBeNull();
    expect(service.getTopicTreeNodes).toHaveBeenCalledTimes(2);
    await act(async () => {
      (host.querySelector('[title="Expand all topics"]') as HTMLButtonElement).click();
      await vi.runAllTimersAsync();
    });
    expect(host.querySelector('[title="sensor/value"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});
