// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import service from '../src/renderer/src/services/TopicTreeService';
import { useMessages } from '../src/renderer/src/hooks/useMessages';
import PayloadView from '../src/renderer/src/components/MessagePanel/PayloadView';

const handlers = vi.hoisted(() => new Map<string, (data: any) => void>());
vi.mock('../src/renderer/src/services/MQTTService', () => ({
  default: { onAny: (event, handler) => handlers.set(event, handler) },
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  service.removeTopicTree('broker');
  container.remove();
  vi.useRealTimers();
});

it('refreshes selected history after eviction caused by other topics', async () => {
  const selected = { topicPath: 'selected' };
  function Harness() {
    const { connectionMessages } = useMessages('broker', selected, () => {});
    return <span>{connectionMessages.map((m) => m.message).join(',')}</span>;
  }
  const receive = (topic: string) =>
    handlers.get('message')!({
      id: 'broker',
      topic,
      message: 'retained data',
      qos: 0,
      retain: true,
      timestamp: 1,
    });
  receive('selected');
  await act(async () => root.render(<Harness />));
  expect(container.textContent).toBe('retained data');
  await act(async () => {
    for (let i = 0; i < 5000; i++) receive(`other-${i}`);
    await vi.advanceTimersByTimeAsync(150);
  });
  expect(service.getTopicMessages('broker', 'selected')).toEqual([]);
  expect(container.textContent).toBe('');
});

it('defaults binary payloads to hex and offers an explicit text preview', async () => {
  await act(async () => root.render(<PayloadView value="/wAB" encoding="base64" />));
  expect(container.querySelector('.payload-preview')?.textContent).toBe('ff 00 01');
  expect(container.querySelector('pre')).toBeNull();
  await act(async () => {
    const select = container.querySelector('select')!;
    select.value = 'text';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(container.textContent).toContain('may replace invalid UTF-8');
});
