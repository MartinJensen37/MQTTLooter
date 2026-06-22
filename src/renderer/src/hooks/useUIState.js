import { useState, useEffect, useCallback } from 'react';

export function useUIState(selectedConnection) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [topicTreeWidth, setTopicTreeWidth] = useState(500);
  const [showTopicTree, setShowTopicTree] = useState(true);
  const [topicTreeReady, setTopicTreeReady] = useState(false);
  const [activeTab, setActiveTab] = useState('logging');

  // Load persisted UI state
  useEffect(() => {
    const saved = localStorage.getItem('mqtt-sidebar-state');
    if (saved) {
      try {
        const state = JSON.parse(saved);
        if (state.collapsed !== undefined) setSidebarCollapsed(state.collapsed);
        if (state.topicTreeWidth !== undefined) setTopicTreeWidth(state.topicTreeWidth);
      } catch {}
    }
  }, []);

  // Persist UI state
  useEffect(() => {
    localStorage.setItem('mqtt-sidebar-state', JSON.stringify({ collapsed: sidebarCollapsed, topicTreeWidth }));
  }, [sidebarCollapsed, topicTreeWidth]);

  // Keyboard shortcuts (F1–F4)
  useEffect(() => {
    if (!selectedConnection) return;
    const onKey = (e) => {
      switch (e.key) {
        case 'F1': e.preventDefault(); setActiveTab('logging');     break;
        case 'F2': e.preventDefault(); setActiveTab('publishing');  break;
        case 'F3': e.preventDefault(); setActiveTab('recording');   break;
        case 'F4': e.preventDefault(); setActiveTab('simulation');  break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedConnection]);

  const handleToggleSidebarCollapse = useCallback(() => setSidebarCollapsed(p => !p), []);

  return {
    sidebarCollapsed, setSidebarCollapsed,
    topicTreeWidth, setTopicTreeWidth,
    showTopicTree, setShowTopicTree,
    topicTreeReady, setTopicTreeReady,
    activeTab, setActiveTab,
    handleToggleSidebarCollapse,
  };
}
