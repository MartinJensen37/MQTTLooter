// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import LinePlot from '../src/renderer/src/components/Charts/LinePlot';
import IncomingPlot from '../src/renderer/src/components/MessagePanel/IncomingPlot';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});
const click = async (text: string) =>
  act(async () => {
    const button = [...container.querySelectorAll('button')].find(
      (button) => (button.getAttribute('aria-label') || button.textContent) === text,
    );
    expect(button).toBeTruthy();
    button!.click();
  });

it('draws disconnected samples and finite axes even for opposite extreme values', async () => {
  await act(async () =>
    root.render(
      <LinePlot
        points={[
          { x: 0, y: -Number.MAX_VALUE },
          { x: 500, y: Number.MAX_VALUE, breakBefore: true },
        ]}
        min={-Number.MAX_VALUE}
        max={Number.MAX_VALUE}
        duration={1000}
        label="Test"
      />,
    ),
  );
  const path = container.querySelector('path')!.getAttribute('d')!;
  expect(path).not.toMatch(/NaN|Infinity/);
  expect(path.match(/M/g)).toHaveLength(2);
  expect(container.querySelectorAll('circle')).toHaveLength(2);
  expect(container.textContent).not.toMatch(/NaN|Infinity/);
});

it('selects a JSON field, pauses polling, bounds zoom and releases polling on close', async () => {
  const series = vi.fn(async (query) => ({
    success: true,
    data: {
      from: query.from,
      to: query.to,
      scanned: 1,
      truncated: false,
      availablePaths: [['temperature']],
      series: query.paths.map((path) => ({
        path,
        points: path.length
          ? [
              { x: query.to, y: 1 },
              { x: query.to, y: 42 },
            ]
          : [],
        valid: path.length ? 1 : 0,
        gaps: path.length ? 0 : 1,
      })),
    },
  }));
  (window as any).electronAPI = { history: { series } };
  await act(async () => root.render(<IncomingPlot connectionId="a" topic="t" />));
  expect(series.mock.calls.at(-1)![0].paths).toEqual([['temperature']]);
  expect(container.querySelector('.incoming-plot-readout')?.textContent).toContain('42');
  await click('Pause plot');
  const pausedCalls = series.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(series).toHaveBeenCalledTimes(pausedCalls);
  for (let i = 0; i < 6; i++) await click('Zoom in plot');
  await click('Plot earlier');
  expect(
    series.mock.calls.every(
      ([query]) => Number.isSafeInteger(query.from) && Number.isSafeInteger(query.to),
    ),
  ).toBe(true);
  await click('Resume live plot');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(series.mock.calls.length).toBeGreaterThan(pausedCalls);
  await act(async () => root.render(<IncomingPlot connectionId="a" topic="t" active={false} />));
  const hiddenCalls = series.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(series).toHaveBeenCalledTimes(hiddenCalls);
  await act(async () => root.render(<IncomingPlot connectionId="a" topic="t" active />));
  expect(series.mock.calls.at(-1)![0].paths).toEqual([['temperature']]);
  await act(async () => root.unmount());
  const closedCalls = series.mock.calls.length;
  await vi.advanceTimersByTimeAsync(2000);
  expect(series).toHaveBeenCalledTimes(closedCalls);
  root = createRoot(container);
});
