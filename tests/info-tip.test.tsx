// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import InfoTip from '../src/renderer/src/components/Controls/InfoTip';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it('explains on hover and focus, and clicking it does not toggle its label', async () => {
  await act(async () =>
    root.render(
      <label>
        <input type="checkbox" />
        Option <InfoTip text="Explains the option." />
      </label>,
    ),
  );
  const tip = container.querySelector<HTMLElement>('.info-tip')!;
  const bubble = () => document.querySelector('[role="tooltip"]')?.textContent;
  expect(tip.getAttribute('aria-label')).toBe('Explains the option.');
  expect(bubble()).toBeUndefined();
  await act(async () =>
    tip.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })),
  );
  expect(bubble()).toBe('Explains the option.');
  await act(async () =>
    tip.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })),
  );
  expect(bubble()).toBeUndefined();
  await act(async () => tip.click());
  expect(container.querySelector<HTMLInputElement>('input')!.checked).toBe(false);
  await act(async () => tip.focus());
  expect(bubble()).toBe('Explains the option.');
  await act(async () => tip.blur());
  expect(bubble()).toBeUndefined();
});
