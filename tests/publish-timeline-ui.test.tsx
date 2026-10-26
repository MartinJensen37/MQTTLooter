// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PublishTimeline from '../src/renderer/src/components/SimulationPanel/simulationPanel/PublishTimeline';
import { calculateTimeline } from '../src/renderer/src/components/SimulationPanel/simulationPanel/publishTimelineModel';
import type { SimulatedDevice } from '../src/renderer/src/components/SimulationPanel/simulationPanel/types';

const workers: any[] = [];
class WorkerMock {
  onmessage?: (event: any) => void;
  terminate = vi.fn();
  postMessage = vi.fn((input) => this.onmessage?.({ data: { result: calculateTimeline(input) } }));
  constructor() {
    workers.push(this);
  }
}
const device: SimulatedDevice = {
  id: 1,
  name: 'Device',
  topic: 'test',
  publishMode: 'signals',
  publishInterval: 1000,
  isPublishing: false,
  outputs: [
    {
      id: 1,
      name: 'Rare',
      dataType: 'number',
      generator: 'static',
      config: { value: 1 },
      timing: { mode: 'sync', probability: 0.01 },
    },
  ],
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  workers.length = 0;
  vi.useFakeTimers();
  vi.stubGlobal('Worker', WorkerMock);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const open = async () => {
  await act(async () =>
    container.querySelector<HTMLInputElement>('.publish-timeline input[type=checkbox]')!.click(),
  );
  await act(async () => vi.advanceTimersByTimeAsync(250));
};

it('calculates only when open or settings change, preserves rare chances and releases the worker', async () => {
  await act(async () => root.render(<PublishTimeline device={device} />));
  expect(workers).toHaveLength(0);
  await open();
  expect(workers).toHaveLength(1);
  expect(container.textContent).toContain('1%');
  expect(
    Math.max(
      ...[...container.querySelectorAll('.publish-timeline-total rect')].map((rect) =>
        Number(rect.getAttribute('height')),
      ),
    ),
  ).toBe(62);
  expect(container.querySelectorAll('.publish-timeline-lane line').length).toBeGreaterThan(1);
  await act(async () =>
    root.render(
      <PublishTimeline
        device={{
          ...device,
          isPublishing: true,
          outputs: [{ ...device.outputs[0], currentValue: 123 }],
        }}
      />,
    ),
  );
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(workers).toHaveLength(1);
  await act(async () => {
    const slider = container.querySelector('[aria-label="Timeline horizon"]') as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      slider,
      '60000',
    );
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // While the window changes, every lane stays where it was, empty, until the slider rests.
  const rows = container.querySelectorAll('.publish-timeline-row').length;
  expect(rows).toBeGreaterThan(0);
  await act(async () => vi.advanceTimersByTimeAsync(100));
  expect(container.querySelectorAll('.publish-timeline-row').length).toBe(rows);
  expect(container.querySelector('.publish-timeline-axis')!.textContent).toContain('Calculating');
  expect(container.querySelector('.publish-timeline-axis')!.textContent).toContain('60 s');
  expect(workers).toHaveLength(1);
  await act(async () => vi.advanceTimersByTimeAsync(150));
  expect(workers).toHaveLength(2);
  expect(workers[1].postMessage.mock.calls[0][0].horizon).toBe(60000);
  await open(); // Collapse.
  expect(container.querySelector('.publish-timeline-rows')).toBeNull();
  expect(workers.every((worker) => worker.terminate.mock.calls.length > 0)).toBe(true);
});

it('virtualizes large signal lists and explicitly scopes the aggregate', async () => {
  const many = {
    ...device,
    outputs: Array.from({ length: 200 }, (_, id) => ({
      ...device.outputs[0],
      id,
      name: `Signal ${id}`,
    })),
  };
  await act(async () => root.render(<PublishTimeline device={many} />));
  await open();
  expect(container.querySelectorAll('.publish-timeline-row').length).toBeLessThanOrEqual(10);
  expect(container.textContent).toContain('72 more are excluded');
  expect(workers[0].postMessage.mock.calls[0][0].signals).toHaveLength(128);
  await act(async () => {
    const scroller = container.querySelector('.publish-timeline-rows')!;
    scroller.scrollTop = 46 * 100;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  expect(container.textContent).toContain('Signal 100');
});

it('requires individual signal mode and rejects invalid timing without starting a worker', async () => {
  await act(async () =>
    root.render(<PublishTimeline device={{ ...device, publishMode: 'combined' }} />),
  );
  await open();
  expect(container.textContent).toContain('Choose one topic per signal');
  expect(workers).toHaveLength(0);
  await act(async () =>
    root.render(
      <PublishTimeline
        device={{
          ...device,
          outputs: [{ ...device.outputs[0], timing: { mode: 'sync', probability: NaN } }],
        }}
      />,
    ),
  );
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(container.textContent).toContain('Fix invalid timing');
  expect(workers).toHaveLength(0);
});
