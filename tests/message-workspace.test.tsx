// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MessageWorkspace from '../src/renderer/src/components/MessagePanel/MessageWorkspace';

vi.mock('../src/renderer/src/services/TopicTreeService', () => ({ default: {} }));
vi.mock('../src/renderer/src/components/MessagePanel/IncomingPlot', () => ({
  default: ({ topic, active }) => (
    <section className="incoming-plot" data-active={active}>
      {topic}
    </section>
  ),
}));
let root: Root;
let host: HTMLDivElement;
const message = {
  id: '1',
  topic: 'sensor',
  message: '42',
  timestamp: 1,
  qos: 1,
  retain: false,
  connectionId: 'test',
};
const render = (topic = 'sensor', active = true) =>
  act(async () =>
    root.render(
      <MessageWorkspace
        connectionId="test"
        selectedTopic={{ topicPath: topic }}
        messages={[{ ...message, topic }]}
        active={active}
      />,
    ),
  );
const choose = (label: string, value: string) =>
  act(async () => {
    const select = host.querySelector(`[aria-label="${label}"]`) as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  window.electronAPI = {
    history: {
      status: vi.fn(async () => ({
        success: true,
        data: { delivery: { connections: {} }, store: { persistent: false } },
      })),
      page: vi.fn(async () => ({
        success: true,
        data: {
          messages: [{ ...message, sessionId: 's', sequence: 1 }],
          nextBefore: 1,
          snapshot: 1,
          generation: 1,
        },
      })),
      topics: vi.fn(async () => ({ success: true, data: [{ path: 'sensor' }] })),
    },
  } as any;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it('replaces cards with a plot below topic metadata and restores message controls', async () => {
  await render();
  await choose('Message order', 'asc');
  expect(host.querySelectorAll('.message-item')).toHaveLength(1);
  await choose('Message display', 'plot');
  expect(host.querySelector('.message-list')).toBeNull();
  expect(host.querySelector('[aria-label="Message order"]')).toBeNull();
  expect(host.querySelector('.topic-actions-section')).toBeNull();
  const metadata = host.querySelector('.topic-details-box')!;
  const plot = host.querySelector('.message-panel > .incoming-plot')!;
  expect(metadata.compareDocumentPosition(plot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await render('other', false);
  expect(host.querySelector('.incoming-plot')?.textContent).toBe('other');
  expect(host.querySelector('.incoming-plot')?.getAttribute('data-active')).toBe('false');
  await choose('Message display', 'plain');
  expect(host.querySelector('.incoming-plot')).toBeNull();
  expect(host.querySelector('.message-plain-entry')?.textContent).toContain('42');
  expect((host.querySelector('[aria-label="Message order"]') as HTMLSelectElement).value).toBe(
    'asc',
  );
  await choose('Message display', 'cards');
  expect(host.querySelectorAll('.message-item')).toHaveLength(1);
});

it('hides message pagination in plot mode while keeping the stored-topic selector', async () => {
  await render();
  await choose('Message source', 'stored');
  expect(host.textContent).toContain('Older page');
  await choose('Message display', 'plot');
  expect(host.textContent).not.toContain('Older page');
  expect(host.querySelector('[aria-label="Stored topic"]')).not.toBeNull();
  expect(host.querySelector('.topic-details-box')?.textContent).toContain('sensor');
  await choose('Message display', 'cards');
  expect(host.textContent).toContain('Older page');
});
