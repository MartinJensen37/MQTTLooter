import { useState, useEffect, useCallback } from 'react';

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
  const [activeTab, setActiveTab] = useState('logging');

  // Persist UI state.
  useEffect(() => {
    try {
      localStorage.setItem(
        'mqtt-sidebar-state',
        JSON.stringify({ collapsed: sidebarCollapsed, topicTreeWidth }),
      );
    } catch {
      /* Layout persistence is optional. */
    }
  }, [sidebarCollapsed, topicTreeWidth]);

  // Tab shortcuts (F1–F4).
  useEffect(() => {
    if (!selectedConnection) return;
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'F1':
          e.preventDefault();
          setActiveTab('logging');
          break;
        case 'F2':
          e.preventDefault();
          setActiveTab('publishing');
          break;
        case 'F3':
          e.preventDefault();
          setActiveTab('recording');
          break;
        case 'F4':
          e.preventDefault();
          setActiveTab('simulation');
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedConnection]);

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
    handleToggleSidebarCollapse,
  };
}
