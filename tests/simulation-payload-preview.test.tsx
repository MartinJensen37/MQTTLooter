// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import SimulationPayloadPreview from '../src/renderer/src/components/SimulationPanel/simulationPanel/SimulationPayloadPreview';

it('bounds raw previews, copies full payloads and handles empty or non-JSON content', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  const root = createRoot(container);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  try {
    const payload = 'x'.repeat(10000);
    await act(async () => root.render(<SimulationPayloadPreview payload={payload} mode="raw" />));
    expect(container.querySelector('pre')!.textContent!.length).toBeLessThan(4200);
    expect(container.textContent).toContain('5904 more bytes');
    await act(async () => container.querySelector('button')!.click());
    expect(writeText).toHaveBeenLastCalledWith(payload);
    await act(async () => root.render(<SimulationPayloadPreview payload="" mode="raw" />));
    expect(container.querySelector('pre')!.textContent).toBe('');
    expect(container.textContent).toContain('0 UTF-8 bytes (empty payload)');
    await act(async () => {
      const select = container.querySelector('select')!;
      select.value = 'json';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.textContent).toContain('not valid JSON');
    expect(container.querySelector('pre')!.textContent).toBe('');
    writeText.mockRejectedValueOnce(new Error('denied'));
    await act(async () => container.querySelector('button')!.click());
    expect(container.querySelector('[role="status"]')!.textContent).toBe(
      'Could not copy the payload.',
    );
  } finally {
    await act(async () => root.unmount());
  }
});
