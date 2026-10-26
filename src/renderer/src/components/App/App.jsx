import React, { Suspense, lazy, useState, useEffect, useCallback, useRef } from 'react';
import { SplitPane, Pane } from 'react-split-pane';
import MQTTService from '../../services/MQTTService';
import TopicTreeService from '../../services/TopicTreeService';
import { ConnectionNotices } from '../../services/ConnectionNotices';
import ConnectionSidebar from '../ConnectionSidebar/ConnectionSidebar';
import TopicTreeComponent from '../TopicTree/TopicTreeComponent';
import MessagePanel from '../MessagePanel/MessageWorkspace';
import RecordingPanel from '../RecordingPanel/RecordingPanel';
import SettingsDialog from './SettingsDialog';
import AboutDialog from './AboutDialog';
import { useAppearance } from '../../hooks/useAppearance';
import { useConnections } from '../../hooks/useConnections';
import { useMessages } from '../../hooks/useMessages';
import { useUIState } from '../../hooks/useUIState';
import './App.css';

// Loaded when first shown; afterwards they stay mounted like the other panels. Recording stays
// eager so captures that main stops after a reload are still reported.
const PublishingPanel = lazy(() => import('../PublishingPanel/PublishingPanel'));
const SimulationPanel = lazy(() => import('../SimulationPanel/SimulationPanel'));
const panelLoading = <p className="panel-loading">Loading…</p>;

const TAB_LIST = [
  { id: 'logging', icon: 'fa-list', label: 'Logging', key: 'F1' },
  { id: 'publishing', icon: 'fa-paper-plane', label: 'Publishing', key: 'F2' },
  { id: 'recording', icon: 'fa-video', label: 'Recording', key: 'F3' },
  { id: 'simulation', icon: 'fa-microchip', label: 'Simulation', key: 'F4' },
];

async function publishTo(connectionId, messageData) {
  if (!connectionId) throw new Error('No connection selected');
  if (!MQTTService.isConnected(connectionId)) throw new Error('Selected connection is not active');
  await MQTTService.publish(connectionId, {
    topic: messageData.topic,
    message: messageData.payload,
    encoding: messageData.encoding,
    qos: messageData.qos,
    retain: messageData.retain,
    properties: messageData.properties,
  });
}

function App() {
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [notifications, setNotifications] = useState([]);
  // Tools > Settings in the app menu.
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => window.electronAPI?.app?.onOpenSettings(() => setSettingsOpen(true)), []);
  // Help > About in the app menu.
  const [aboutOpen, setAboutOpen] = useState(false);
  useEffect(() => window.electronAPI?.app?.onOpenAbout?.(() => setAboutOpen(true)), []);
  useAppearance();
  const mainPanelsRef = useRef(null);
  const [panelWidth, setPanelWidth] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setPanelWidth(Math.round(entry.contentRect.width)),
    );
    observer.observe(mainPanelsRef.current);
    return () => observer.disconnect();
  }, []);
  // Clamp the rendered width without overwriting the user's preferred split on window resize.
  const maxTopicWidth = Math.max(50, panelWidth - 361);

  // ── Notifications ────────────────────────────────────────────────────────
  const showFeedback = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setNotifications((prev) => [...prev, { id, message, type, timestamp: Date.now() }]);
    setTimeout(() => setNotifications((prev) => prev.filter((n) => n.id !== id)), 2000);
  }, []);

  const removeNotification = useCallback((id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // ── Custom hooks ─────────────────────────────────────────────────────────
  const {
    connections,
    setConnections,
    selectedConnection,
    setLastSelectedTopics,
    activeConnections,
    handleConnectionCreate,
    handleConnectionSelect,
    handleConnectionToggle,
    handleConnectionDelete,
  } = useConnections(showFeedback, selectedTopic, setSelectedTopic);

  const { connectionMessages, handleClearMessages, liveSelectedTopic } = useMessages(
    selectedConnection,
    selectedTopic,
    showFeedback,
  );

  const {
    sidebarCollapsed,
    sidebarWidth,
    resizeSidebar,
    topicTreeWidth,
    setTopicTreeWidth,
    showTopicTree,
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
  } = useUIState(selectedConnection);
  const pinned = useMessages(
    panePin?.connectionId ?? null,
    panePin?.topic ?? null,
    showFeedback,
    'pane',
  );
  // A deleted connection cannot stay pinned.
  useEffect(() => {
    if (panePin && !connections.some((connection) => connection.id === panePin.connectionId))
      setPanePin(null);
  }, [connections, panePin, setPanePin]);
  const tabContainerRef = useRef(null);
  // Keyboard focus on a tab follows F-key switches to the newly active tab.
  useEffect(() => {
    if (document.activeElement?.classList.contains('tab-btn'))
      document.querySelector('.main-tabs .tab-btn.active')?.focus();
  }, [activeTab]);
  // Below 560 px of content width the panes stack instead of sitting side by side.
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    const element = tabContainerRef.current;
    if (!splitTab || !element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setStacked(entry.contentRect.width < 560));
    observer.observe(element);
    return () => observer.disconnect();
  }, [splitTab, selectedConnection]);
  // Split view places two tabs side by side with CSS, so no panel is remounted or duplicated.
  const placement = (tab) =>
    tab === activeTab ? 'active' : tab === splitTab ? 'secondary' : 'hidden';
  const visible = (tab) => tab === activeTab || tab === splitTab;
  // Tabs shown at least once; only grows, so recording it during render is harmless.
  const opened = useRef(new Set());
  opened.current.add(activeTab);
  if (splitTab) opened.current.add(splitTab);
  const startSplitDrag = (event) => {
    event.preventDefault();
    const rect = tabContainerRef.current.getBoundingClientRect();
    const move = (moveEvent) =>
      setSplitRatio(
        stacked
          ? (moveEvent.clientY - rect.top) / rect.height
          : (moveEvent.clientX - rect.left) / rect.width,
      );
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  // ── MQTT event listeners ─────────────────────────────────────────────────
  const notices = useRef(new ConnectionNotices());
  useEffect(() => {
    setTopicTreeReady(TopicTreeService.isReady());
    const handleConnected = (data) => {
      setConnections((prev) =>
        prev.map((c) => (c.id === data.id ? { ...c, status: 'connected', isConnected: true } : c)),
      );
      const kind = notices.current.connected(data.id);
      showFeedback(
        kind === 'reconnected' ? 'Reconnected to broker' : 'Connected to broker',
        'success',
      );
    };
    const handleDisconnected = (data) => {
      setConnections((prev) =>
        prev.map((c) =>
          c.id === data.id ? { ...c, status: 'disconnected', isConnected: false } : c,
        ),
      );
    };
    const handleReconnecting = (data) => {
      notices.current.reconnecting(data.id);
      setConnections((prev) =>
        prev.map((c) =>
          c.id === data.id ? { ...c, status: 'reconnecting', isConnected: false } : c,
        ),
      );
    };
    const handleError = (data) => {
      const message = data.error || data.message || 'Unknown error';
      if (notices.current.error(data.id, message)) showFeedback(`MQTT error: ${message}`, 'error');
    };
    const handleTreeCleared = ({ connectionId }) => {
      setSelectedTopic((previous) => (previous?.connectionId === connectionId ? null : previous));
      setPanePin((previous) =>
        previous?.connectionId === connectionId ? { ...previous, topic: null } : previous,
      );
      setLastSelectedTopics((previous) => {
        const next = { ...previous };
        delete next[connectionId];
        return next;
      });
    };
    const handlers = {
      connected: handleConnected,
      disconnected: handleDisconnected,
      reconnecting: handleReconnecting,
      error: handleError,
    };
    Object.entries(handlers).forEach(([event, handler]) => MQTTService.onAny(event, handler));
    TopicTreeService.on('treeCleared', handleTreeCleared);
    return () => {
      Object.entries(handlers).forEach(([event, handler]) => MQTTService.off('*', event, handler));
      TopicTreeService.off('treeCleared', handleTreeCleared);
    };
  }, [setConnections, setTopicTreeReady, setLastSelectedTopics, setPanePin, showFeedback]);

  // ── Small handlers ───────────────────────────────────────────────────────
  const handleTopicSelect = (topicPath) => {
    TopicTreeService.selectTopic(selectedConnection, topicPath);
    const topic = { topicPath, connectionId: selectedConnection };
    setSelectedTopic(topic);
    setLastSelectedTopics((prev) => ({ ...prev, [selectedConnection]: topic }));
  };

  const handlePublishMessage = useCallback(
    (messageData) => publishTo(selectedConnection, messageData),
    [selectedConnection],
  );
  const pinnedConnection = panePin?.connectionId ?? null;
  const handlePinnedPublish = useCallback(
    (messageData) => publishTo(pinnedConnection, messageData),
    [pinnedConnection],
  );

  const connectionView = (id) => connections.find((c) => c.id === id);
  const getConnectionName = (id = selectedConnection) =>
    connectionView(id)?.config?.name || 'Unknown Connection';

  // ── Render helpers ───────────────────────────────────────────────────────
  // Every panel follows the sidebar, except the one in a pinned second pane.
  const paneFor = (tab) => {
    if (!panePin || tab !== splitTab)
      return {
        connectionId: selectedConnection,
        messages: connectionMessages,
        selectedTopic: liveSelectedTopic,
        onClearMessages: handleClearMessages,
        onPublishMessage: handlePublishMessage,
      };
    return {
      connectionId: panePin.connectionId,
      messages: pinned.connectionMessages,
      selectedTopic: pinned.liveSelectedTopic,
      onClearMessages: pinned.handleClearMessages,
      onPublishMessage: handlePinnedPublish,
    };
  };
  const connectedPane = (pane) => connectionView(pane.connectionId)?.isConnected || false;
  const pinLabel = (tab) =>
    panePin && tab === splitTab ? (
      <div className="pane-pin">
        <i className="fas fa-thumbtack" aria-hidden="true"></i>
        <span>
          Pinned to <strong>{getConnectionName(panePin.connectionId)}</strong>
          {panePin.topic && <code>{panePin.topic.topicPath}</code>}
        </span>
      </div>
    ) : null;
  const logging = paneFor('logging');
  const publishing = paneFor('publishing');
  const recording = paneFor('recording');
  const simulation = paneFor('simulation');

  const renderTabContent = () => (
    <div
      ref={tabContainerRef}
      className={`tab-content-container${splitTab ? ' split' : ''}${splitTab && stacked ? ' stacked' : ''}`}
      style={splitTab ? { '--split': `${splitRatio * 100}%` } : undefined}
    >
      <div className={`tab-content ${placement('logging')}`}>
        {pinLabel('logging')}
        <MessagePanel
          active={visible('logging')}
          connectionId={logging.connectionId}
          messages={logging.messages}
          selectedTopic={logging.selectedTopic}
          connectionName={getConnectionName(logging.connectionId)}
          onClearMessages={logging.onClearMessages}
          isConnected={connectedPane(logging)}
          showFeedback={showFeedback}
        />
      </div>
      <div className={`tab-content ${placement('publishing')}`}>
        {pinLabel('publishing')}
        {opened.current.has('publishing') && (
          <Suspense fallback={panelLoading}>
            <PublishingPanel
              protocolVersion={
                connectedPane(publishing)
                  ? MQTTService.getProtocolVersion(publishing.connectionId)
                  : (connectionView(publishing.connectionId)?.config?.protocolVersion ?? 4)
              }
              key={publishing.connectionId}
              connectionId={publishing.connectionId}
              onPublishMessage={publishing.onPublishMessage}
              isConnected={connectedPane(publishing)}
              selectedTopic={publishing.selectedTopic}
              showFeedback={showFeedback}
            />
          </Suspense>
        )}
      </div>
      <div className={`tab-content ${placement('recording')}`}>
        {pinLabel('recording')}
        <RecordingPanel
          connectionName={getConnectionName(recording.connectionId)}
          selectedTopic={recording.selectedTopic}
          onPublishMessage={recording.onPublishMessage}
          isConnected={connectedPane(recording)}
          activeConnectionId={recording.connectionId}
          showFeedback={showFeedback}
        />
      </div>
      <div className={`tab-content ${placement('simulation')}`}>
        {pinLabel('simulation')}
        {opened.current.has('simulation') && (
          <Suspense fallback={panelLoading}>
            <SimulationPanel
              key={simulation.connectionId}
              connectionId={simulation.connectionId}
              onPublishMessage={simulation.onPublishMessage}
              isConnected={connectedPane(simulation)}
              selectedTopic={simulation.selectedTopic}
              showFeedback={showFeedback}
            />
          </Suspense>
        )}
      </div>
      {splitTab && (
        <div
          className="split-divider"
          role="separator"
          aria-orientation={stacked ? 'horizontal' : 'vertical'}
          aria-label="Resize split view"
          aria-valuemin={25}
          aria-valuemax={75}
          aria-valuenow={Math.round(splitRatio * 100)}
          tabIndex={0}
          onPointerDown={startSplitDrag}
          onKeyDown={(event) => {
            if (event.key === (stacked ? 'ArrowUp' : 'ArrowLeft')) setSplitRatio(splitRatio - 0.05);
            if (event.key === (stacked ? 'ArrowDown' : 'ArrowRight'))
              setSplitRatio(splitRatio + 0.05);
          }}
        />
      )}
    </div>
  );

  const renderMainContent = () => {
    if (!selectedConnection) {
      return (
        <div className="no-connection-selected">
          <div className="no-connection-icon">
            <i className="fas fa-plug"></i>
          </div>
          <h2>No Connection Selected</h2>
          <p>Select an active connection from the sidebar to view messages and topics.</p>
          <p className="hint">Create a new connection using the + button in the sidebar.</p>
        </div>
      );
    }
    if (!showTopicTree || !topicTreeReady) return renderTabContent();
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        <SplitPane
          className={activeTab === 'simulation' ? 'simulation-workspace' : ''}
          direction="horizontal"
          resizable={activeTab !== 'simulation'}
          dividerSize={activeTab === 'simulation' ? 0 : 9}
          dividerStyle={activeTab === 'simulation' ? { display: 'none' } : { width: '9px' }}
          onResize={(sizes) => setTopicTreeWidth(sizes[0])}
          dividerClassName="resizer-divider"
        >
          <Pane
            className="topic-browser-pane"
            minSize={activeTab === 'simulation' ? 0 : 50}
            maxSize={activeTab === 'simulation' ? 0 : maxTopicWidth}
            size={activeTab === 'simulation' ? 0 : Math.min(topicTreeWidth, maxTopicWidth)}
          >
            <div className="topic-tree-panel">
              <TopicTreeComponent
                connectionId={selectedConnection}
                selectedPath={selectedTopic?.topicPath ?? null}
                onTopicSelect={handleTopicSelect}
                topicTreeService={TopicTreeService}
              />
            </div>
          </Pane>
          <Pane minSize={Math.max(0, Math.min(360, panelWidth - 51))}>{renderTabContent()}</Pane>
        </SplitPane>
      </div>
    );
  };

  // ── JSX ──────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      {settingsOpen && (
        <SettingsDialog
          connections={connections.map((connection) => ({
            id: connection.id,
            name: connection.config?.name || 'Unnamed connection',
          }))}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      <div className="notification-stack">
        {notifications.map((n) => (
          <div
            key={n.id}
            className={`notification ${n.type}`}
            onClick={() => removeNotification(n.id)}
          >
            <i
              className={`fas ${n.type === 'success' ? 'fa-check-circle' : n.type === 'error' ? 'fa-exclamation-circle' : n.type === 'warning' ? 'fa-exclamation-triangle' : 'fa-info-circle'}`}
            ></i>
            <span className="notification-message">{n.message}</span>
            <button
              className="notification-close"
              onClick={(e) => {
                e.stopPropagation();
                removeNotification(n.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="app-layout" style={{ '--sidebar-width': `${sidebarWidth}px` }}>
        <ConnectionSidebar
          connections={connections}
          activeConnections={activeConnections}
          onConnectionSelect={handleConnectionSelect}
          onConnectionCreate={handleConnectionCreate}
          onConnectionDelete={handleConnectionDelete}
          onConnectionToggle={handleConnectionToggle}
          selectedConnectionId={selectedConnection}
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={handleToggleSidebarCollapse}
        />
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize connection list"
          aria-valuemin={0}
          aria-valuemax={420}
          aria-valuenow={sidebarCollapsed ? 0 : sidebarWidth}
          tabIndex={0}
          title="Drag to resize; drag fully in to collapse"
          onPointerDown={(event) => {
            event.preventDefault();
            const left = event.currentTarget.parentElement.getBoundingClientRect().left;
            const move = (moveEvent) => resizeSidebar(moveEvent.clientX - left);
            const stop = () => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', stop);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', stop);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' && !sidebarCollapsed) resizeSidebar(sidebarWidth - 20);
            if (event.key === 'ArrowRight')
              resizeSidebar(sidebarCollapsed ? sidebarWidth : sidebarWidth + 20);
          }}
        />

        <div className="main-content">
          <div className="main-header">
            <div className="header-left">
              <h2>{selectedConnection ? getConnectionName() : 'MQTTLooter'}</h2>
              {selectedConnection && activeConnections.length > 1 && (
                <div className="connection-info">
                  <span className="multi-connection-indicator">
                    {activeConnections.length} active connections
                  </span>
                </div>
              )}
            </div>
            {selectedConnection && (
              <div className="header-controls">
                <div className="main-tabs">
                  {TAB_LIST.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      // Clicking selects without focusing, so F-keys leave no focus ring behind.
                      onMouseDown={(event) => event.preventDefault()}
                      className={`tab-btn ${activeTab === tab.id ? 'active' : tab.id === splitTab ? 'secondary' : ''}`}
                      title={`${tab.key} - ${tab.label} Panel`}
                    >
                      <i className={`fas ${tab.icon}`}></i> {tab.label}{' '}
                      <span className="shortcut-hint">{tab.key}</span>
                    </button>
                  ))}
                </div>
                <div className="split-controls">
                  {splitTab && (
                    <select
                      aria-label="Second pane"
                      className="custom-select-button form-select form-select-compact"
                      value={splitTab}
                      onChange={(event) => setSplitTab(event.target.value)}
                    >
                      {TAB_LIST.filter((tab) => tab.id !== activeTab).map((tab) => (
                        <option key={tab.id} value={tab.id}>
                          {tab.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {splitTab && (
                    <button
                      className={`btn btn-sm ${panePin ? 'btn-primary' : 'btn-secondary'}`}
                      aria-pressed={Boolean(panePin)}
                      aria-label="Pin second pane"
                      onMouseDown={(event) => event.preventDefault()}
                      title={
                        panePin
                          ? 'Let the second pane follow the sidebar again'
                          : 'Keep the second pane on this connection and topic'
                      }
                      onClick={() =>
                        setPanePin(
                          panePin
                            ? null
                            : {
                                connectionId: selectedConnection,
                                topic:
                                  selectedTopic?.connectionId === selectedConnection
                                    ? selectedTopic
                                    : null,
                              },
                        )
                      }
                    >
                      <i className="fas fa-thumbtack"></i> <span className="split-label">Pin</span>
                    </button>
                  )}
                  <button
                    className={`btn btn-sm ${splitTab ? 'btn-primary' : 'btn-secondary'}`}
                    aria-pressed={Boolean(splitTab)}
                    aria-label="Split view"
                    onMouseDown={(event) => event.preventDefault()}
                    title={splitTab ? 'Close split view' : 'Show a second tab beside this one'}
                    onClick={() =>
                      setSplitTab(splitTab ? null : TAB_LIST.find((tab) => tab.id !== activeTab).id)
                    }
                  >
                    <i className="fas fa-columns"></i> <span className="split-label">Split</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="main-panels" ref={mainPanelsRef}>
            {renderMainContent()}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
