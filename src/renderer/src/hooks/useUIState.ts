import { useState, useEffect, useCallback } from 'react';

export const TABS = ['logging', 'publishing', 'recording', 'simulation'] as const;
export type Tab = (typeof TABS)[number];
const isTab = (value: unknown): value is Tab => TABS.includes(value as Tab);
export const SPLIT_LIMITS = { min: 0.25, max: 0.75 };
const clampRatio = (value: number) => Math.min(SPLIT_LIMITS.max, Math.max(SPLIT_LIMITS.min, value));

export function useUIState(selectedConnection: string | null) {
  const [initialState] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('mqtt-sidebar-state') || '{}');
    } catch {
      return {};
    }
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(Boolean(initialState.collapsed));
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

  // Persist UI state.
  useEffect(() => {
    try {
      localStorage.setItem(
        'mqtt-sidebar-state',
        JSON.stringify({ collapsed: sidebarCollapsed, topicTreeWidth, splitTab, splitRatio }),
      );
    } catch {
      /* Layout persistence is optional. */
    }
  }, [sidebarCollapsed, topicTreeWidth, splitTab, splitRatio]);

  /** Choosing the tab shown in the second pane swaps the two panes. */
  const setActiveTab = useCallback(
    (tab: string) => {
      if (!isTab(tab)) return;
      if (tab === splitTab) setSplitTabState(activeTab);
      setActiveTabState(tab);
    },
    [splitTab, activeTab],
  );

  const setSplitTab = useCallback(
    (tab: string | null) => {
      if (tab === null) return setSplitTabState(null);
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
      setActiveTab(TABS[index]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedConnection, setActiveTab]);

  const handleToggleSidebarCollapse = useCallback(() => setSidebarCollapsed((p) => !p), []);

  return {
    sidebarCollapsed,
    setSidebarCollapsed,
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
    handleToggleSidebarCollapse,
  };
}
