// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MessagePanel from '../src/renderer/src/components/MessagePanel/MessagePanel';
import StableScrollViewport from '../src/renderer/src/components/StableScrollViewport';

let container: HTMLDivElement;
let root: Root;
const height = (element: Element) =>
  Number(element.getAttribute('data-scroll-key')) % 2 ? 120 : 80;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
    return this.classList.contains('message-list') || this.classList.contains('tree-test')
      ? 200
      : 0;
  });
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function (this: Element) {
    if (this.classList.contains('tree-test'))
      return Number(this.firstElementChild?.getAttribute('data-count')) * 38;
    return [...this.querySelectorAll('[data-scroll-key]')].reduce(
      (sum, row) => sum + height(row),
      0,
    );
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const list = this.closest('.message-list');
    const rows = list ? [...list.querySelectorAll('[data-scroll-key]')] : [];
    const index = rows.indexOf(this);
    const top =
      index < 0
        ? 0
        : rows.slice(0, index).reduce((sum, row) => sum + height(row), 0) - list!.scrollTop;
    const size = index < 0 ? 200 : height(this);
    return {
      top,
      bottom: top + size,
      height: size,
      left: 0,
      right: 400,
      width: 400,
      x: 0,
      y: top,
      toJSON: () => ({}),
    };
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const message = (id: number) => ({
  id: String(id),
  timestamp: id,
  topic: 'sensor',
  message: `Message ${id}`,
  qos: 0,
  retain: id % 2 === 0,
  connectionId: 'a',
});
const renderMessages = async (ids: number[], connectionId = 'a') =>
  act(async () =>
    root.render(
      <MessagePanel
        connectionId={connectionId}
        messages={ids.map(message)}
        selectedTopic={{ topicPath: 'sensor' }}
      />,
    ),
  );
const scroll = async (top: number, selector = '.message-list') =>
  act(async () => {
    const list = container.querySelector(selector)!;
    list.scrollTop = top;
    list.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
const rowTop = (id: number) =>
  container.querySelector(`[data-scroll-key="${id}"]`)!.getBoundingClientRect().top;

it('automatically pins a visible message across prepends and follows again at the top', async () => {
  await renderMessages([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  await scroll(225);
  const offset = rowTop(8);
  expect(container.textContent).toContain('Pinned');
  await renderMessages([13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  expect(rowTop(8)).toBe(offset);
  // Programmatic compensation must not re-enable following.
  await act(async () =>
    container.querySelector('.message-list')!.dispatchEvent(new Event('scroll')),
  );
  expect(container.textContent).toContain('Pinned');
  await scroll(0);
  await renderMessages([14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  expect(container.querySelector('.message-list')!.scrollTop).toBe(0);
  expect(container.textContent).toContain('Following');
});

it('anchors oldest-first views through append and eviction and resets when switching brokers', async () => {
  await renderMessages([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  await act(async () => {
    const select = container.querySelector('[aria-label="Message order"]') as HTMLSelectElement;
    select.value = 'asc';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(container.querySelector('.message-list')!.scrollTop).toBe(0);
  expect(container.querySelector('.message-item')!.getAttribute('data-scroll-key')).toBe('1');
  await scroll(245);
  const offset = rowTop(3);
  await renderMessages([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  expect(rowTop(3)).toBe(offset);
  await renderMessages([10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 'b');
  expect(container.querySelector('.message-list')!.scrollTop).toBe(0);
  expect(container.textContent).toContain('Following');
});

it('preserves virtual topic anchors when earlier branches grow or topics are evicted', async () => {
  const render = async (keys: string[], query = '') =>
    act(async () =>
      root.render(
        <StableScrollViewport className="tree-test" itemKeys={keys} rowHeight={38} viewKey={query}>
          <div data-count={keys.length} />
        </StableScrollViewport>,
      ),
    );
  const keys = Array.from({ length: 2000 }, (_, index) => `topic/${index}`);
  await render(keys);
  await scroll(38005, '.tree-test');
  await render(['new/branch', ...keys]);
  expect(container.querySelector('.tree-test')!.scrollTop).toBe(38043);
  await render(keys.slice(100));
  expect(container.querySelector('.tree-test')!.scrollTop).toBe(34205);
  await render(keys.slice(1000), '1000');
  expect(container.querySelector('.tree-test')!.scrollTop).toBe(0);
});

it('orders same-millisecond bursts by arrival in both directions', async () => {
  await act(async () =>
    root.render(
      <MessagePanel
        messages={[3, 2, 1].map((id) => ({ ...message(id), timestamp: 1 }))}
        selectedTopic={{ topicPath: 'sensor' }}
      />,
    ),
  );
  expect(container.querySelector('.message-item')!.getAttribute('data-scroll-key')).toBe('3');
  await act(async () => {
    const select = container.querySelector('[aria-label="Message order"]') as HTMLSelectElement;
    select.value = 'asc';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(container.querySelector('.message-item')!.getAttribute('data-scroll-key')).toBe('1');
});
