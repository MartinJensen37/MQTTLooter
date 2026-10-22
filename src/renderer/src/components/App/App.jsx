import React, { useState, useEffect, useCallback } from 'react';
import { SplitPane, Pane } from 'react-split-pane';
import MQTTService from '../../services/MQTTService';
import TopicTreeService from '../../services/TopicTreeService';
import ConnectionSidebar from '../ConnectionSidebar/ConnectionSidebar';
import TopicTreeComponent from '../TopicTree/TopicTreeComponent';
import MessagePanel from '../MessagePanel/MessagePanel';
import PublishingPanel from '../PublishingPanel/PublishingPanel';
import RecordingPanel from '../RecordingPanel/RecordingPanel';
import SimulationPanel from '../SimulationPanel/SimulationPanel';
import { useConnections } from '../../hooks/useConnections';
import { useMessages } from '../../hooks/useMessages';
import { useUIState } from '../../hooks/useUIState';
import './App.css';

function App() {
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [notifications, setNotifications] = useState([]);

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

  const { connectionMessages, handleClearMessages } = useMessages(
    selectedConnection,
    selectedTopic,
    showFeedback,
  );

  const {
    sidebarCollapsed,
    topicTreeWidth,
    setTopicTreeWidth,
    showTopicTree,
    topicTreeReady,
    setTopicTreeReady,
    activeTab,
    setActiveTab,
    handleToggleSidebarCollapse,
  } = useUIState(selectedConnection);

  // ── MQTT event listeners ─────────────────────────────────────────────────
  useEffect(() => {
    setTopicTreeReady(TopicTreeService.isReady());
    const handleConnected = (data) => {
      setConnections((prev) =>
        prev.map((c) => (c.id === data.id ? { ...c, status: 'connected', isConnected: true } : c)),
      );
      showFeedback('Connected to broker', 'success');
    };
    const handleDisconnected = (data) => {
      setConnections((prev) =>
        prev.map((c) =>
          c.id === data.id ? { ...c, status: 'disconnected', isConnected: false } : c,
        ),
      );
    };
    const handleReconnecting = (data) => {
      setConnections((prev) =>
        prev.map((c) =>
          c.id === data.id ? { ...c, status: 'reconnecting', isConnected: false } : c,
        ),
      );
    };
    const handleError = (data) => {
      showFeedback(`MQTT error: ${data.error || data.message || 'Unknown error'}`, 'error');
    };
    const handleTreeCleared = () => setSelectedTopic(null);
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
  }, [setConnections, setTopicTreeReady, showFeedback]);

  // ── Small handlers ───────────────────────────────────────────────────────
  const handleTopicSelect = (topicPath, node) => {
    const topic = { topicPath, node, connectionId: selectedConnection };
    setSelectedTopic(topic);
    setLastSelectedTopics((prev) => ({ ...prev, [selectedConnection]: topic }));
  };

  const handlePublishMessage = useCallback(
    async (messageData) => {
      if (!selectedConnection) throw new Error('No connection selected');
      if (!MQTTService.isConnected(selectedConnection))
        throw new Error('Selected connection is not active');
      await MQTTService.publish(selectedConnection, {
        topic: messageData.topic,
        message: messageData.payload,
        encoding: messageData.encoding,
        qos: messageData.qos,
        retain: messageData.retain,
      });
    },
    [selectedConnection],
  );

  const getConnectionName = () =>
    connections.find((c) => c.id === selectedConnection)?.config?.name || 'Unknown Connection';

  // ── Render helpers ───────────────────────────────────────────────────────
  const isConnected = connections.find((c) => c.id === selectedConnection)?.isConnected || false;

  const renderTabContent = () => (
    <div className="tab-content-container">
      <div className={`tab-content ${activeTab === 'logging' ? 'active' : 'hidden'}`}>
        <MessagePanel
          connectionId={selectedConnection}
          messages={connectionMessages}
          selectedTopic={selectedTopic}
          connectionName={getConnectionName()}
          onClearMessages={handleClearMessages}
          showFeedback={showFeedback}
        />
      </div>
      <div className={`tab-content ${activeTab === 'publishing' ? 'active' : 'hidden'}`}>
        <PublishingPanel
          key={selectedConnection}
          connectionId={selectedConnection}
          onPublishMessage={handlePublishMessage}
          isConnected={isConnected}
          selectedTopic={selectedTopic}
          showFeedback={showFeedback}
        />
      </div>
      <div className={`tab-content ${activeTab === 'recording' ? 'active' : 'hidden'}`}>
        <RecordingPanel
          connectionName={getConnectionName()}
          selectedTopic={selectedTopic}
          onPublishMessage={handlePublishMessage}
          isConnected={isConnected}
          activeConnectionId={selectedConnection}
          showFeedback={showFeedback}
        />
      </div>
      <div className={`tab-content ${activeTab === 'simulation' ? 'active' : 'hidden'}`}>
        <SimulationPanel
          key={selectedConnection}
          connectionId={selectedConnection}
          onPublishMessage={handlePublishMessage}
          isConnected={isConnected}
          selectedTopic={selectedTopic}
          showFeedback={showFeedback}
        />
      </div>
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
          dividerSize={activeTab === 'simulation' ? 0 : 1}
          dividerStyle={activeTab === 'simulation' ? { display: 'none' } : undefined}
          onResize={(sizes) => setTopicTreeWidth(sizes[0])}
          dividerClassName="resizer-divider"
        >
          <Pane
            className="topic-browser-pane"
            minSize={activeTab === 'simulation' ? 0 : 50}
            size={activeTab === 'simulation' ? 0 : topicTreeWidth}
          >
            <div className="topic-tree-panel">
              <TopicTreeComponent
                connectionId={selectedConnection}
                onTopicSelect={handleTopicSelect}
                topicTreeService={TopicTreeService}
              />
            </div>
          </Pane>
          <Pane>{renderTabContent()}</Pane>
        </SplitPane>
      </div>
    );
  };

  // ── JSX ──────────────────────────────────────────────────────────────────
  return (
    <div className="app">
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

      <div className="app-layout">
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

        <div className="main-content">
          <div className="main-header">
            <div className="header-left">
              <h2>{selectedConnection ? getConnectionName() : 'MQTTLooter'}</h2>
              {selectedConnection && (
                <div className="connection-info">
                  <span className="connection-id">{selectedConnection}</span>
                  {activeConnections.length > 1 && (
                    <span className="multi-connection-indicator">
                      {activeConnections.length} active connections
                    </span>
                  )}
                </div>
              )}
            </div>
            {selectedConnection && (
              <div className="header-controls">
                <div className="main-tabs">
                  {[
                    { id: 'logging', icon: 'fa-list', label: 'Logging', key: 'F1' },
                    { id: 'publishing', icon: 'fa-paper-plane', label: 'Publishing', key: 'F2' },
                    { id: 'recording', icon: 'fa-video', label: 'Recording', key: 'F3' },
                    { id: 'simulation', icon: 'fa-microchip', label: 'Simulation', key: 'F4' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                      title={`${tab.key} - ${tab.label} Panel`}
                    >
                      <i className={`fas ${tab.icon}`}></i> {tab.label}{' '}
                      <span className="shortcut-hint">{tab.key}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="main-panels">{renderMainContent()}</div>
        </div>
      </div>
    </div>
  );
}

export default App;
