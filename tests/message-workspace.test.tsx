// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MessageWorkspace from '../src/renderer/src/components/MessagePanel/MessageWorkspace';
import { settings } from '../src/renderer/src/services/Settings';

const clearTopicMessages = vi.fn();
vi.mock('../src/renderer/src/services/TopicTreeService', () => ({
  default: {
    getTopicTree: () => undefined,
    toggleTopicPin: () => true,
    clearTopicMessages: (...args: unknown[]) => clearTopicMessages(...args),
  },
}));
vi.mock('../src/renderer/src/components/MessagePanel/IncomingPlot', () => ({
  default: ({ topic, active }) => (
    <section className="incoming-plot" data-active={active}>
      {topic}
    </section>
  ),
}));
let root: Root;
let host: HTMLDivElement;
/** A message as both the live cache and disk history describe it. */
const stored = (sequence: number, topic = 'sensor') => ({
  id: 'test',
  sessionId: 's',
  sequence,
  rowId: sequence,
  topic,
  message: `value ${sequence}`,
  encoding: 'utf8' as const,
  byteLength: `value ${sequence}`.length,
  timestamp: sequence * 1000,
  qos: 1,
  retain: false,
  protocolVersion: 4,
});
const live = (sequence: number, topic = 'sensor') => ({
  ...stored(sequence, topic),
  id: `s:${sequence}`,
  connectionId: 'test',
});
/** Disk history of `count` messages, served newest first in pages of `size`. */
const disk = (count: number, size = 3) =>
  vi.fn(async (query: { before?: number }) => {
    const below = query.before ?? count + 1;
    const messages: ReturnType<typeof stored>[] = [];
    for (let sequence = below - 1; sequence >= 1 && messages.length < size; sequence--)
      messages.push(stored(sequence));
    const last = messages.at(-1)?.sequence ?? 1;
    return {
      success: true,
      data: {
        messages,
        nextBefore: last > 1 ? last : null,
        snapshot: count,
        generation: 1,
        expired: 0,
      },
    };
  });
const render = (messages: any[], topic = 'sensor', active = true) =>
  act(async () =>
    root.render(
      <MessageWorkspace
        connectionId="test"
        selectedTopic={{ topicPath: topic }}
        messages={messages}
        active={active}
      />,
    ),
  );
const settle = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(50);
  });
const choose = (label: string, value: string) =>
  act(async () => {
    const select = host.querySelector(`[aria-label="${label}"]`) as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
const type = (label: string, value: string) =>
  act(async () => {
    const input = host.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const shown = () =>
  [...host.querySelectorAll('.message-item .message-content')].map(
    (element) => element.textContent,
  );
const heading = () => host.querySelector('.message-panel h2')?.textContent;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  settings.set({ messagesShown: 'all' });
  clearTopicMessages.mockReset();
  window.electronAPI = {
    history: {
      status: vi.fn(async () => ({
        success: true,
        data: { delivery: { connections: {} }, store: { persistent: false } },
      })),
      page: disk(8),
      search: vi.fn(),
      clear: vi.fn(async () => ({ success: true })),
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

it('shows cached messages at once, then the rest of disk history without duplicates', async () => {
  const page = window.electronAPI.history.page;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => (release = resolve));
  window.electronAPI.history.page = vi.fn(async (query) => {
    await waiting;
    return page(query);
  });
  await render([live(8), live(7)]);
  expect(heading()).toContain('Messages (2)');
  release();
  await settle();
  expect(heading()).toContain('Messages (8)');
  expect(shown()[0]).toContain('value 8');
  expect(shown().at(-1)).toContain('value 1');
});

it('keeps the newest messages up to the Show choice as live messages arrive', async () => {
  settings.set({ messagesShown: 300 });
  window.electronAPI.history.page = disk(400, 300);
  await render([live(400)]);
  await settle();
  expect(heading()).toContain('Messages (300)');
  await render([live(402), live(401), live(400)]);
  expect(heading()).toContain('Messages (300)');
  expect(shown()[0]).toContain('value 402');
  await choose('Messages shown', 'all');
  await settle();
  expect(heading()).toContain('Messages (402)');
});

it('releases the previous topic when another topic is selected', async () => {
  await render([live(8)]);
  await settle();
  window.electronAPI.history.page = vi.fn(async () => ({
    success: true,
    data: { messages: [], nextBefore: null, snapshot: 1, generation: 1, expired: 0 },
  }));
  await render([live(9, 'other')], 'other');
  expect(heading()).toContain('Messages (1)');
  expect(shown()[0]).toContain('value 9');
});

it('searches the topic history and returns to the topic messages when the search is cleared', async () => {
  window.electronAPI.history.search = vi.fn(async () => ({
    success: true,
    data: {
      messages: [stored(3)],
      nextBefore: null,
      nextBeforeTime: null,
      snapshot: 8,
      generation: 1,
      scanned: 8,
      skippedLarge: 0,
      skippedBinary: 0,
      expired: 0,
    },
  }));
  await render([live(8)]);
  await settle();
  await type('Search message contents', 'value 3');
  await settle();
  expect(window.electronAPI.history.search).toHaveBeenCalledWith(
    expect.objectContaining({ topic: 'sensor', term: 'value 3', mode: 'text' }),
  );
  expect(heading()).toContain('Matches (1)');
  expect(host.querySelector('.message-filter-status')?.textContent).toContain('8 stored messages');
  await type('Search message contents', '');
  expect(heading()).toContain('Messages (8)');
});

it('clears cached and stored messages and starts the list over', async () => {
  await render([live(8)]);
  await settle();
  window.electronAPI.history.page = vi.fn(async () => ({
    success: true,
    data: { messages: [], nextBefore: null, snapshot: 1, generation: 2, expired: 0 },
  }));
  await act(async () => {
    (host.querySelector('.btn-danger') as HTMLButtonElement).click();
  });
  expect(window.electronAPI.history.clear).toHaveBeenCalledWith('test', 'sensor');
  expect(clearTopicMessages).toHaveBeenCalledWith('test', 'sensor');
  await settle();
  expect(heading()).toContain('Messages (0)');
});

it('replaces the list with a plot below the topic details and restores the controls', async () => {
  window.electronAPI.history.page = disk(1);
  await render([live(1)]);
  await choose('Message order', 'asc');
  expect(host.querySelectorAll('.message-item')).toHaveLength(1);
  await choose('Message display', 'plot');
  expect(host.querySelector('.message-list')).toBeNull();
  expect(host.querySelector('[aria-label="Message order"]')).toBeNull();
  expect(host.querySelector('[aria-label="Search message contents"]')).toBeNull();
  expect(host.querySelector('.topic-actions-section')).toBeNull();
  const metadata = host.querySelector('.topic-details-box')!;
  const plot = host.querySelector('.message-panel > .incoming-plot')!;
  expect(metadata.compareDocumentPosition(plot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await render([live(2, 'other')], 'other', false);
  expect(host.querySelector('.incoming-plot')?.textContent).toBe('other');
  expect(host.querySelector('.incoming-plot')?.getAttribute('data-active')).toBe('false');
  await choose('Message display', 'plain');
  expect(host.querySelector('.incoming-plot')).toBeNull();
  expect(host.querySelector('.message-plain-entry')?.textContent).toContain('value 2');
  expect((host.querySelector('[aria-label="Message order"]') as HTMLSelectElement).value).toBe(
    'asc',
  );
});
