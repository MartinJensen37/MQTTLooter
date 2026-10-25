// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import HistorySearch from '../src/renderer/src/components/MessagePanel/HistorySearch';

vi.mock('../src/renderer/src/components/MessagePanel/MessagePanel', () => ({
  default: ({ messages }) => (
    <div data-testid="matches">
      {messages.map((message) => (
        <span key={message.id}>{message.message}</span>
      ))}
    </div>
  ),
}));
let root: Root;
let container: HTMLDivElement;
const search = vi.fn();
const page = (messages: any[] = [], nextBefore: number | null = null) => ({
  success: true,
  data: {
    messages,
    nextBefore,
    nextBeforeTime: nextBefore === null ? null : 1000 + nextBefore,
    snapshot: 99,
    generation: 0,
    expired: 0,
    scanned: 20,
    skippedLarge: 0,
    skippedBinary: 0,
  },
});
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  search.mockReset();
  (window as any).electronAPI = { history: { search } };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<HistorySearch connectionId="broker" topic="topic" />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});
const input = async (value: string) =>
  act(async () => {
    const element = container.querySelector('input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
const click = async (text: string) =>
  act(async () => {
    const button = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === text,
    )!;
    expect(button).toBeTruthy();
    button.click();
  });

const set = async (label: string, value: string) =>
  act(async () => {
    const element = container.querySelector(`[aria-label="${label}"]`) as
      | HTMLInputElement
      | HTMLSelectElement;
    const prototype =
      element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });

it('searches a custom receive-time range and rejects reversed or expired ranges', async () => {
  vi.setSystemTime(new Date(2026, 9, 14, 12, 0, 0));
  search.mockResolvedValue(page());
  await input('needle');
  await set('Content search time range', 'custom');
  // Starts as the last hour, in local time.
  expect((container.querySelector('[aria-label="Search from"]') as HTMLInputElement).value).toBe(
    '2026-10-14T11:00',
  );
  // The end input holds whole seconds; messages later in that second are still included.
  vi.setSystemTime(new Date(2026, 9, 14, 12, 0, 0, 400));
  await click('Search history');
  expect(search.mock.calls[0][0].to).toBe(Date.now());
  await set('Search from', '2026-10-14T09:30:00');
  await set('Search to', '2026-10-14T09:45:30');
  await click('Search history');
  expect(search.mock.calls[1][0]).toMatchObject({
    from: new Date(2026, 9, 14, 9, 30, 0).getTime(),
    to: new Date(2026, 9, 14, 9, 45, 30, 999).getTime(),
  });

  await set('Search from', '2026-10-14T10:00:00');
  await click('Search history');
  expect(container.querySelector('[role="alert"]')!.textContent).toContain('before the end');
  await set('Search from', '2026-10-12T08:00:00');
  await set('Search to', '2026-10-12T09:00:00');
  await click('Search history');
  expect(container.querySelector('[role="alert"]')!.textContent).toContain('older than');
  // A range reaching past retention is trimmed to the retained 24 hours.
  await set('Search to', '2026-10-14T08:00:00');
  await click('Search history');
  expect(search).toHaveBeenCalledTimes(3);
  expect(search.mock.calls[2][0].from).toBe(Date.now() - 86400000);
});

it('scans past empty chunks, preserves snapshot cursors and stops at a result page', async () => {
  search
    .mockResolvedValueOnce(page([], 50))
    .mockResolvedValueOnce(
      page([{ sessionId: 'one', sequence: 1, id: 'broker', message: 'found' }], 10),
    );
  await input('needle');
  await click('Search history');
  expect(search).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(20));
  expect(search.mock.calls[1][0]).toMatchObject({
    before: 50,
    beforeTime: 1050,
    snapshot: 99,
    generation: 0,
    term: 'needle',
  });
  expect(container.querySelector('[data-testid=matches]')!.textContent).toBe('found');
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(search).toHaveBeenCalledTimes(2);
  search.mockResolvedValueOnce(page());
  await click('Continue search');
  expect(search.mock.calls[2][0]).toMatchObject({ before: 10, snapshot: 99 });
  expect(container.textContent).toContain('Reached the end');
});

it('shows newer result pages again from the same snapshot', async () => {
  const found = (message: string, nextBefore: number | null) =>
    page([{ sessionId: 'one', sequence: message.length, id: 'broker', message }], nextBefore);
  search.mockResolvedValueOnce(found('first', 40)).mockResolvedValueOnce(found('second', 20));
  await input('needle');
  await click('Search history');
  const newer = () =>
    [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Newer matches',
    )!;
  expect(newer().disabled).toBe(true);
  await click('Continue search');
  expect(container.querySelector('[data-testid=matches]')!.textContent).toBe('second');
  // The first page is rescanned from its start, within the snapshot it was found in.
  search.mockResolvedValueOnce(found('first', 40));
  await click('Newer matches');
  expect(search.mock.calls[2][0]).toMatchObject({ snapshot: 99, generation: 0 });
  expect(search.mock.calls[2][0].before).toBeUndefined();
  expect(container.querySelector('[data-testid=matches]')!.textContent).toBe('first');
  expect(newer().disabled).toBe(true);
  search.mockResolvedValueOnce(found('second', 20));
  await click('Continue search');
  expect(search.mock.calls[3][0]).toMatchObject({ before: 40, snapshot: 99 });
  expect(newer().disabled).toBe(false);
  // Changed criteria cannot page back into the old search.
  await input('other');
  expect(newer().disabled).toBe(true);
});

it('discards a pending result after cancellation or edits and resumes from the last completed chunk', async () => {
  let resolve!: (value: any) => void;
  search.mockResolvedValueOnce(page([], 50)).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await input('old');
  await click('Search history');
  await act(async () => vi.advanceTimersByTimeAsync(20));
  await click('Stop search');
  await act(async () => resolve(page([{ sessionId: 'one', sequence: 1, message: 'stale' }], 10)));
  expect(container.querySelector('[data-testid=matches]')!.textContent).toBe('');
  search.mockResolvedValueOnce(page());
  await click('Continue search');
  expect(search.mock.calls[2][0].before).toBe(50);
  search.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await click('Search history');
  await input('new');
  await act(async () => resolve(page([{ sessionId: 'one', sequence: 1, message: 'stale' }])));
  expect(container.querySelector('[data-testid=matches]')!.textContent).toBe('');
  expect(container.textContent).toContain('0 records scanned');
});

it('stops hidden searches and exposes skipped records rather than claiming exhaustive matches', async () => {
  search.mockResolvedValueOnce({
    ...page([], 50),
    data: { ...page([], 50).data, skippedLarge: 2, skippedBinary: 3 },
  });
  await input('needle');
  await click('Search history');
  await act(async () =>
    root.render(<HistorySearch connectionId="broker" topic="topic" active={false} />),
  );
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(search).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('2 oversized records skipped');
  expect(container.textContent).toContain('3 non-UTF-8');
});

it('searches a topic filter across topics and rejects an invalid filter before scanning', async () => {
  search.mockResolvedValue(page([]));
  await input('needle');
  const set = async (label: string, value: string, event: string) =>
    act(async () => {
      const element = container.querySelector(`[aria-label="${label}"]`) as
        | HTMLInputElement
        | HTMLSelectElement;
      const prototype =
        element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new Event(event, { bubbles: true }));
    });
  await set('Content search scope', 'filter', 'change');
  await set('Content search topic filter', 'sensors/#/x', 'input');
  await click('Search history');
  expect(search).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')!.textContent).toContain('MQTT topic filter');
  await set('Content search topic filter', 'sensors/+/temp', 'input');
  await click('Search history');
  expect(search.mock.calls[0][0]).toMatchObject({
    topic: 'topic',
    scope: 'filter',
    filter: 'sensors/+/temp',
    term: 'needle',
  });
});
