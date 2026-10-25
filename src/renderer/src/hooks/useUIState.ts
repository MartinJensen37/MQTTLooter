import { useState, useEffect, useCallback } from 'react';

export const TABS = ['logging', 'publishing', 'recording', 'simulation'] as const;
export type Tab = (typeof TABS)[number];
const isTab = (value: unknown): value is Tab => TABS.includes(value as Tab);
export const SPLIT_LIMITS = { min: 0.25, max: 0.75 };
/** Connection list width; dragging it narrower than `collapseBelow` collapses it. */
export const SIDEBAR_LIMITS = { min: 200, max: 420, initial: 260, collapseBelow: 140 };
const clampSidebar = (value: number) =>
  Math.round(Math.min(SIDEBAR_LIMITS.max, Math.max(SIDEBAR_LIMITS.min, value)));
const clampRatio = (value: number) => Math.min(SPLIT_LIMITS.max, Math.max(SPLIT_LIMITS.min, value));
/** A pinned second pane keeps this connection and topic instead of following the sidebar. */
export interface PanePin {
  connectionId: string;
  topic: { topicPath: string; connectionId: string } | null;
}

export function useUIState(selectedConnection: string | null) {
  const [initialState] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('mqtt-sidebar-state') || '{}');
    } catch {
      return {};
    }
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(Boolean(initialState.collapsed));
  const [sidebarWidth, setSidebarWidthState] = useState(
    Number.isFinite(initialState.sidebarWidth)
      ? clampSidebar(initialState.sidebarWidth)
      : SIDEBAR_LIMITS.initial,
  );
  const [topicTreeWidth, setTopicTreeWidth] = useState(
    Number.isFinite(initialState.topicTreeWidth) ? Math.max(50, initialState.topicTreeWidth) : 500,
  );
  const [showTopicTree, setShowTopicTree] = useState(true);
  const [topicTreeReady, setTopicTreeReady] = useState(false);
  const [activeTab, setActiveTabState] = useState<Tab>('logging');
  // Split view shows a second tab beside the active one; each panel is still mounted once.
  const [splitTab, setSplitTabState] = useState<Tab | null>(
    isTab(initialState.splitTab) && initialState.splitTab !== 'logging'
      ? initialState.splitTab
      : null,
  );
  const [splitRatio, setSplitRatioState] = useState(
    Number.isFinite(initialState.splitRatio) ? clampRatio(initialState.splitRatio) : 0.5,
  );
  // Not persisted: the pinned connection may not be connected after a restart.
  const [panePin, setPanePin] = useState<PanePin | null>(null);

  // Persist UI state.
  useEffect(() => {
    try {
      localStorage.setItem(
        'mqtt-sidebar-state',
        JSON.stringify({
          collapsed: sidebarCollapsed,
          sidebarWidth,
          topicTreeWidth,
          splitTab,
          splitRatio,
        }),
      );
    } catch {
      /* Layout persistence is optional. */
    }
  }, [sidebarCollapsed, sidebarWidth, topicTreeWidth, splitTab, splitRatio]);

  /** Dragging the connection list fully in collapses it, like the logo button. */
  const resizeSidebar = useCallback((width: number) => {
    if (width < SIDEBAR_LIMITS.collapseBelow) return setSidebarCollapsed(true);
    setSidebarCollapsed(false);
    setSidebarWidthState(clampSidebar(width));
  }, []);

  /** Choosing the tab shown in the second pane swaps the two panes and ends its pin. */
  const setActiveTab = useCallback(
    (tab: string) => {
      if (!isTab(tab)) return;
      if (tab === splitTab) {
        setSplitTabState(activeTab);
        setPanePin(null);
      }
      setActiveTabState(tab);
    },
    [splitTab, activeTab],
  );

  const setSplitTab = useCallback(
    (tab: string | null) => {
      if (tab === null) {
        setPanePin(null);
        return setSplitTabState(null);
      }
      if (isTab(tab) && tab !== activeTab) setSplitTabState(tab);
    },
    [activeTab],
  );

  const setSplitRatio = useCallback((ratio: number) => setSplitRatioState(clampRatio(ratio)), []);

  // Tab shortcuts (F1–F4) choose the first pane.
  useEffect(() => {
    if (!selectedConnection) return;
    const onKey = (e: KeyboardEvent) => {
      const index = ['F1', 'F2', 'F3', 'F4'].indexOf(e.key);
      if (index === -1) return;
      e.preventDefault();
      // A key press makes Chromium draw the focus ring on whatever was last clicked, which then
      // lingers on a control in the panel being left. Tab buttons keep focus; App moves it.
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && !focused.classList.contains('tab-btn')) focused.blur();
      setActiveTab(TABS[index]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedConnection, setActiveTab]);

  const handleToggleSidebarCollapse = useCallback(() => setSidebarCollapsed((p) => !p), []);

  return {
    sidebarCollapsed,
    setSidebarCollapsed,
    sidebarWidth,
    resizeSidebar,
    topicTreeWidth,
    setTopicTreeWidth,
    showTopicTree,
    setShowTopicTree,
    topicTreeReady,
    setTopicTreeReady,
    activeTab,
    setActiveTab,
    splitTab,
    setSplitTab,
    splitRatio,
    setSplitRatio,
    panePin,
    setPanePin,
    handleToggleSidebarCollapse,
  };
}
