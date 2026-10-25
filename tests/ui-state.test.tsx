// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useUIState } from '../src/renderer/src/hooks/useUIState';

let root: Root;
let container: HTMLDivElement;
let state: ReturnType<typeof useUIState>;
function Harness() {
  state = useUIState('connection');
  return null;
}
const render = () => act(async () => root.render(<Harness />));
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it('shows a second tab beside the active one and swaps when that tab is chosen', async () => {
  await render();
  expect(state.splitTab).toBeNull();
  await act(async () => state.setSplitTab('publishing'));
  expect([state.activeTab, state.splitTab]).toEqual(['logging', 'publishing']);
  // The active tab cannot also be the second pane.
  await act(async () => state.setSplitTab('logging'));
  expect(state.splitTab).toBe('publishing');
  await act(async () => state.setActiveTab('publishing'));
  expect([state.activeTab, state.splitTab]).toEqual(['publishing', 'logging']);
  await act(async () =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3', bubbles: true })),
  );
  expect([state.activeTab, state.splitTab]).toEqual(['recording', 'logging']);
  await act(async () => state.setSplitRatio(0.9));
  expect(state.splitRatio).toBe(0.75);
  await act(async () => state.setSplitTab(null));
  expect(state.splitTab).toBeNull();
});

it('ends a pane pin when the panes swap or the split closes', async () => {
  await render();
  const pin = { connectionId: 'other', topic: { topicPath: 'a/b', connectionId: 'other' } };
  await act(async () => state.setSplitTab('publishing'));
  await act(async () => state.setPanePin(pin));
  // Changing the second pane's tab keeps the pin.
  await act(async () => state.setSplitTab('recording'));
  expect(state.panePin).toBe(pin);
  await act(async () => state.setActiveTab('publishing'));
  expect(state.panePin).toBe(pin);
  await act(async () => state.setActiveTab('recording'));
  expect([state.activeTab, state.splitTab, state.panePin]).toEqual([
    'recording',
    'publishing',
    null,
  ]);
  await act(async () => state.setPanePin(pin));
  await act(async () => state.setSplitTab(null));
  expect(state.panePin).toBeNull();
  expect(JSON.parse(localStorage.getItem('mqtt-sidebar-state')!)).not.toHaveProperty('panePin');
});

it('resizes the connection list and collapses it when dragged fully in', async () => {
  await render();
  expect([state.sidebarWidth, state.sidebarCollapsed]).toEqual([260, false]);
  await act(async () => state.resizeSidebar(1000));
  expect(state.sidebarWidth).toBe(420);
  await act(async () => state.resizeSidebar(150));
  expect([state.sidebarWidth, state.sidebarCollapsed]).toEqual([200, false]);
  // Narrower than the collapse threshold: collapsed, keeping the last width for later.
  await act(async () => state.resizeSidebar(90));
  expect([state.sidebarWidth, state.sidebarCollapsed]).toEqual([200, true]);
  await act(async () => state.resizeSidebar(300));
  expect([state.sidebarWidth, state.sidebarCollapsed]).toEqual([300, false]);
  expect(JSON.parse(localStorage.getItem('mqtt-sidebar-state')!)).toMatchObject({
    sidebarWidth: 300,
    collapsed: false,
  });
});

it('restores the split layout after a restart', async () => {
  await render();
  await act(async () => state.setSplitTab('simulation'));
  await act(async () => state.setSplitRatio(0.4));
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  expect([state.activeTab, state.splitTab, state.splitRatio]).toEqual([
    'logging',
    'simulation',
    0.4,
  ]);
  // A saved second pane equal to the starting tab is dropped.
  localStorage.setItem(
    'mqtt-sidebar-state',
    JSON.stringify({ splitTab: 'logging', splitRatio: 7 }),
  );
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  expect([state.splitTab, state.splitRatio]).toEqual([null, 0.75]);
});
