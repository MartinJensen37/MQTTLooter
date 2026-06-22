import React, { useState, useEffect, useRef, useCallback } from 'react';
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
    setNotifications(prev => [...prev, { id, message, type, timestamp: Date.now() }]);
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), 2000);
  }, []);

  const removeNotification = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  // ── Custom hooks ─────────────────────────────────────────────────────────
  const {
    connections, setConnections,
    selectedConnection, setSelectedConnection,
    lastSelectedTopics, setLastSelectedTopics,
    activeConnections,
    updateConnectionsList,
    handleConnectionCreate,
    handleConnectionSelect,
    handleConnectionToggle,
    handleConnectionDelete,
  } = useConnections(showFeedback, selectedTopic, setSelectedTopic);

  const {
    connectionMessages, allConnectionMessages,
    handleClearMessages,
  } = useMessages(selectedConnection, selectedTopic, connections, showFeedback);

  const {
    sidebarCollapsed,
    topicTreeWidth, setTopicTreeWidth,
    showTopicTree, topicTreeReady, setTopicTreeReady,
    activeTab, setActiveTab,
    handleToggleSidebarCollapse,
  } = useUIState(selectedConnection);

  // ── MQTT event listeners ─────────────────────────────────────────────────
  const handlersRef = useRef(null);
  const topicTreeHandlersRef = useRef(null);

  useEffect(() => {
    const checkTopicTreeReady = () => {
      if (TopicTreeService.isReady()) {
        setTopicTreeReady(true);
        setupTopicTreeListeners();
      } else {
        setTimeout(checkTopicTreeReady, 100);
      }
    };
    checkTopicTreeReady();

    const handleConnected = (data) => {
      setConnections(prev => prev.map(c =>
        c.id === data.id ? { ...c, status: 'connected', isConnected: true } : c
      ));
      setConnections(prev => {
        const name = prev.find(c => c.id === data.id)?.config?.name || data.id;
        showFeedback(`Connected to ${name}`, 'success');
        return prev;
      });
    };

    const handleDisconnected = (data) => {
      setConnections(prev => prev.map(c =>
        c.id === data.id ? { ...c, status: 'disconnected', isConnected: false } : c
      ));
      TopicTreeService.removeTopicTree(data.id);
      setSelectedTopic(cur => (cur?.connectionId === data.id ? null : cur));
      setLastSelectedTopics(prev => {
        const next = { ...prev };
        delete next[data.id];
        return next;
      });
      setSelectedConnection(cur => {
        if (cur !== data.id) return cur;
        setTimeout(() => {
          setSelectedConnection(curInner => {
            if (curInner !== data.id) return curInner;
            const fresh = MQTTService.getAllConnections()
              .filter(c => c.isConnected || c.status === 'connected')
              .filter(c => c.id !== data.id);
            const newId = fresh.length > 0 ? fresh[0].id : null;
            if (newId) {
              setLastSelectedTopics(prev => {
                setSelectedTopic(prev[newId] || null);
                return prev;
              });
            }
            return newId;
          });
        }, 100);
        return cur;
      });
    };

    const handleMessage = (_data) => {
      // Messages are now stored in per-topic ring buffers (TopicTreeService).
      // No flat array accumulation — the useMessages hook derives from the tree.
      // This handler is kept as a listener for future use (e.g. notifications).
    };

    const handleError = (data) => {
      const msg = data.code || data.error || data.message || 'Unknown error';
      setConnections(prev => {
        const name = prev.find(c => c.id === data.id)?.config?.name || data.id;
        showFeedback(`Connection error (${name}): ${msg}`, 'error');
        return prev.map(c =>
          c.id === data.id ? { ...c, status: 'disconnected', isConnected: false } : c
        );
      });
      if (data.id) {
        TopicTreeService.removeTopicTree(data.id);
        setSelectedTopic(cur => (cur?.connectionId === data.id ? null : cur));
      }
    };

    handlersRef.current = { handleConnected, handleDisconnected, handleMessage, handleError };
    MQTTService.onAny('connected', handleConnected);
    MQTTService.onAny('disconnected', handleDisconnected);
    MQTTService.onAny('message', handleMessage);
    MQTTService.onAny('error', handleError);

    return () => {
      const { handleConnected, handleDisconnected, handleMessage, handleError } = handlersRef.current;
      MQTTService.off('*', 'connected', handleConnected);
      MQTTService.off('*', 'disconnected', handleDisconnected);
      MQTTService.off('*', 'message', handleMessage);
      MQTTService.off('*', 'error', handleError);
      if (topicTreeHandlersRef.current) {
        const { handleTreeCreated, handleTreeUpdated, handleTreeCleared, handleTreeError } = topicTreeHandlersRef.current;
        if (typeof TopicTreeService.off === 'function') {
          TopicTreeService.off('treeCreated', handleTreeCreated);
          TopicTreeService.off('treeUpdated', handleTreeUpdated);
          TopicTreeService.off('treeCleared', handleTreeCleared);
          TopicTreeService.off('treeError', handleTreeError);
        }
      }
    };
  }, []);

  const setupTopicTreeListeners = () => {
    const handleTreeCreated  = () => {};
    const handleTreeUpdated  = () => {};
    const handleTreeCleared  = (data) => showFeedback(`Topic tree cleared for ${data.connectionId}`, 'info');
    const handleTreeError    = (data) => showFeedback(`Topic tree error: ${data.error}`, 'error');
    topicTreeHandlersRef.current = { handleTreeCreated, handleTreeUpdated, handleTreeCleared, handleTreeError };
    TopicTreeService.on('treeCreated', handleTreeCreated);
    TopicTreeService.on('treeUpdated', handleTreeUpdated);
    TopicTreeService.on('treeCleared', handleTreeCleared);
    TopicTreeService.on('treeError',   handleTreeError);
  };

  // ── Small handlers ───────────────────────────────────────────────────────
  const handleTopicSelect = (topicPath, node) => {
    const topic = { topicPath, node, connectionId: selectedConnection };
    setSelectedTopic(topic);
    setLastSelectedTopics(prev => ({ ...prev, [selectedConnection]: topic }));
  };

  const handlePublishMessage = async (messageData) => {
    if (!selectedConnection) { showFeedback('No active connection selected', 'error'); return; }
    const conn = connections.find(c => c.id === selectedConnection);
    if (!conn?.isConnected) { showFeedback('Selected connection is not active', 'error'); return; }
    try {
      await MQTTService.publish(selectedConnection, {
        topic: messageData.topic, message: messageData.payload, qos: messageData.qos, retain: messageData.retain,
      });
    } catch (err) {
      showFeedback(`Failed to publish message: ${err.message}`, 'error');
    }
  };

  const getConnectionName = () =>
    connections.find(c => c.id === selectedConnection)?.config?.name || 'Unknown Connection';

  // ── Render helpers ───────────────────────────────────────────────────────
  const isConnected = connections.find(c => c.id === selectedConnection)?.isConnected || false;

  const renderTabContent = () => (
    <div className="tab-content-container">
      <div className={`tab-content ${activeTab === 'logging'     ? 'active' : 'hidden'}`}>
        <MessagePanel messages={connectionMessages} selectedTopic={selectedTopic}
          connectionName={getConnectionName()} onClearMessages={handleClearMessages} showFeedback={showFeedback} />
      </div>
      <div className={`tab-content ${activeTab === 'publishing'  ? 'active' : 'hidden'}`}>
        <PublishingPanel connectionId={selectedConnection} onPublishMessage={handlePublishMessage}
          isConnected={isConnected} selectedTopic={selectedTopic} showFeedback={showFeedback} />
      </div>
      <div className={`tab-content ${activeTab === 'recording'   ? 'active' : 'hidden'}`}>
        <RecordingPanel messages={allConnectionMessages} connectionName={getConnectionName()}
          selectedTopic={selectedTopic} onPublishMessage={handlePublishMessage}
          isConnected={isConnected} activeConnectionId={selectedConnection} />
      </div>
      <div className={`tab-content ${activeTab === 'simulation'  ? 'active' : 'hidden'}`}>
        <SimulationPanel connectionId={selectedConnection} onPublishMessage={handlePublishMessage}
          isConnected={isConnected} selectedTopic={selectedTopic} />
      </div>
    </div>
  );

  const renderMainContent = () => {
    if (!selectedConnection) {
      return (
        <div className="no-connection-selected">
          <div className="no-connection-icon"><i className="fas fa-plug"></i></div>
          <h2>No Connection Selected</h2>
          <p>Select an active connection from the sidebar to view messages and topics.</p>
          <p className="hint">Create a new connection using the + button in the sidebar.</p>
        </div>
      );
    }
    if (!showTopicTree || !topicTreeReady) return renderTabContent();
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        <SplitPane direction="horizontal" onResize={(sizes) => setTopicTreeWidth(sizes[0])} dividerClassName="resizer-divider">
          <Pane minSize={50} defaultSize={topicTreeWidth}>
            <div className="topic-tree-panel">
              <TopicTreeComponent connectionId={selectedConnection} onTopicSelect={handleTopicSelect} topicTreeService={TopicTreeService} />
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
        {notifications.map(n => (
          <div key={n.id} className={`notification ${n.type}`} onClick={() => removeNotification(n.id)}>
            <i className={`fas ${n.type === 'success' ? 'fa-check-circle' : n.type === 'error' ? 'fa-exclamation-circle' : n.type === 'warning' ? 'fa-exclamation-triangle' : 'fa-info-circle'}`}></i>
            <span className="notification-message">{n.message}</span>
            <button className="notification-close" onClick={(e) => { e.stopPropagation(); removeNotification(n.id); }}>×</button>
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
                    <span className="multi-connection-indicator">{activeConnections.length} active connections</span>
                  )}
                </div>
              )}
            </div>
            {selectedConnection && (
              <div className="header-controls">
                <div className="main-tabs">
                  {[
                    { id: 'logging',    icon: 'fa-list',        label: 'Logging',    key: 'F1' },
                    { id: 'publishing', icon: 'fa-paper-plane', label: 'Publishing', key: 'F2' },
                    { id: 'recording',  icon: 'fa-video',       label: 'Recording',  key: 'F3' },
                    { id: 'simulation', icon: 'fa-microchip',   label: 'Simulation', key: 'F4' },
                  ].map(tab => (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                      className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                      title={`${tab.key} - ${tab.label} Panel`}
                    >
                      <i className={`fas ${tab.icon}`}></i> {tab.label} <span className="shortcut-hint">{tab.key}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="main-panels">
            {renderMainContent()}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
