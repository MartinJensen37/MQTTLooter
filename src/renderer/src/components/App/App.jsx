import React, { useState, useEffect } from 'react';
import SplitPane from 'react-split-pane';
import { toast, ToastContainer } from 'react-toastify';
import MQTTService from '../../services/MQTTService.js';
import TopicTreeService from '../../services/TopicTreeService.js';
import ConnectionSidebar from '../ConnectionSidebar/ConnectionSidebar';
import TopicTreeComponent from '../TopicTree/TopicTreeComponent';
import MessagePanel from '../MessagePanel/MessagePanel.jsx';
import 'react-toastify/dist/ReactToastify.css';
import './App.css';

function App() {
  const [connections, setConnections] = useState([]);
  const [messages, setMessages] = useState([]);
  const [activeConnections, setActiveConnections] = useState([]); // Support multiple active connections
  const [selectedConnection, setSelectedConnection] = useState(null); // Currently viewed connection
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [showTopicTree, setShowTopicTree] = useState(true);
  const [topicTreeReady, setTopicTreeReady] = useState(false);
  
  // Panel size states
  const [connectionSidebarWidth, setConnectionSidebarWidth] = useState(280);
  const [topicTreeWidth, setTopicTreeWidth] = useState(350);

  useEffect(() => {
    // Wait for TopicTreeService to be ready
    const checkTopicTreeReady = () => {
      if (TopicTreeService.isReady()) {
        setTopicTreeReady(true);
        setupTopicTreeListeners();
      } else {
        setTimeout(checkTopicTreeReady, 100);
      }
    };
    checkTopicTreeReady();

    // Set up MQTT event handlers
    MQTTService.onAny('connected', (data) => {
      toast.success(`Connected to ${data.id}`);
      updateConnectionsList();
      
      // Add to active connections
      setActiveConnections(prev => [...prev.filter(id => id !== data.id), data.id]);
      
      // Set as selected connection if it's the first one
      if (!selectedConnection) {
        setSelectedConnection(data.id);
      }
    });

    MQTTService.onAny('disconnected', (data) => {
      toast.info(`Disconnected from ${data.id}`);
      updateConnectionsList();
      
      // Remove from active connections
      setActiveConnections(prev => prev.filter(id => id !== data.id));
      
      // Clear selected connection if it was disconnected
      if (selectedConnection === data.id) {
        const remaining = activeConnections.filter(id => id !== data.id);
        setSelectedConnection(remaining.length > 0 ? remaining[0] : null);
      }
    });

    MQTTService.onAny('message', (data) => {
      const newMessage = {
        id: Date.now() + Math.random(),
        connectionId: data.id,
        topic: data.topic,
        message: data.message,
        qos: data.qos,
        retain: data.retain,
        timestamp: data.timestamp || Date.now()
      };
      
      setMessages(prev => [newMessage, ...prev.slice(0, 999)]); // Keep last 1000 messages
    });

    MQTTService.onAny('error', (data) => {
      toast.error(`Connection error: ${data.error}`);
      updateConnectionsList();
    });

    updateConnectionsList();
  }, [selectedConnection, activeConnections]);

  const setupTopicTreeListeners = () => {
    TopicTreeService.on('treeCreated', (data) => {
      console.log('Topic tree created for connection:', data.connectionId);
    });

    TopicTreeService.on('treeUpdated', (data) => {
      console.log('Topic tree updated:', data.connectionId, data.topic);
    });

    TopicTreeService.on('treeCleared', (data) => {
      toast.info(`Topic tree cleared for ${data.connectionId}`);
    });

    TopicTreeService.on('treeError', (data) => {
      toast.error(`Topic tree error: ${data.error}`);
    });
  };

  const updateConnectionsList = () => {
    setConnections(MQTTService.getAllConnections());
  };

  const handleConnectionCreate = async (connectionData) => {
    try {
      const connectionId = connectionData.id || `connection_${Date.now()}`;
      await MQTTService.connect(connectionId, connectionData);
      
      // Auto-connect after creation
      setActiveConnections(prev => [...prev.filter(id => id !== connectionId), connectionId]);
      setSelectedConnection(connectionId);
    } catch (error) {
      toast.error(`Failed to create connection: ${error.message}`);
    }
  };

  const handleConnectionSelect = (connectionId) => {
    setSelectedConnection(connectionId);
    // Clear topic selection when switching connections
    setSelectedTopic(null);
  };

  const handleConnectionToggle = async (connectionId) => {
    const connection = connections.find(c => c.id === connectionId);
    if (!connection) return;

    try {
      if (connection.isConnected) {
        await MQTTService.disconnect(connectionId);
      } else {
        await MQTTService.connect(connectionId, connection.config);
      }
    } catch (error) {
      toast.error(`Failed to toggle connection: ${error.message}`);
    }
  };

  const handleConnectionDelete = async (connectionId) => {
    try {
      // Disconnect if connected
      const connection = connections.find(c => c.id === connectionId);
      if (connection?.isConnected) {
        await MQTTService.disconnect(connectionId);
      }
      
      // Remove from active connections
      setActiveConnections(prev => prev.filter(id => id !== connectionId));
      
      // Clear selected connection if it was deleted
      if (selectedConnection === connectionId) {
        const remaining = activeConnections.filter(id => id !== connectionId);
        setSelectedConnection(remaining.length > 0 ? remaining[0] : null);
      }
      
      // TODO: Implement actual deletion from MQTTService
      // For now, just disconnect and remove from active list
      updateConnectionsList();
      toast.success('Connection removed');
    } catch (error) {
      toast.error(`Failed to delete connection: ${error.message}`);
    }
  };

  const handleTopicSelect = (topicPath, node) => {
    setSelectedTopic({ topicPath, node, connectionId: selectedConnection });
  };

  const handleClearFilter = () => {
    setSelectedTopic(null);
  };

  const handleClearMessages = () => {
    setMessages([]);
    toast.info('Messages cleared');
  };

  const getSelectedConnectionName = () => {
    const connection = connections.find(c => c.id === selectedConnection);
    return connection?.config?.name || 'Unknown Connection';
  };

  const toggleTopicTree = () => {
    setShowTopicTree(!showTopicTree);
  };

  // Filter messages by selected connection
  const connectionMessages = selectedConnection 
    ? messages.filter(msg => msg.connectionId === selectedConnection)
    : messages;

  // Render main content (topic tree + message panel)
  const renderMainContent = () => {
    if (!selectedConnection) {
      return (
        <div className="no-connection-selected">
          <div className="no-connection-icon">🔌</div>
          <h2>No Connection Selected</h2>
          <p>Select an active connection from the sidebar to view messages and topics.</p>
          <p className="hint">Create a new connection using the + button in the sidebar.</p>
        </div>
      );
    }

    if (!showTopicTree || !topicTreeReady) {
      // Only message panel
      return (
        <MessagePanel
          messages={connectionMessages}
          selectedTopic={selectedTopic}
          onClearFilter={handleClearFilter}
          onClearMessages={handleClearMessages}
          connectionName={getSelectedConnectionName()}
        />
      );
    }

    // Topic tree + message panel with resizer
    return (
      <SplitPane
        split="vertical"
        minSize={250}
        maxSize={600}
        defaultSize={topicTreeWidth}
        onChange={(size) => setTopicTreeWidth(size)}
        resizerStyle={{
          background: '#dee2e6',
          opacity: 0.7,
          zIndex: 1,
          cursor: 'col-resize',
          width: '4px',
          border: 'none',
          transition: 'opacity 0.2s'
        }}
        onResizerMouseEnter={(e) => {
          e.target.style.opacity = '1';
          e.target.style.background = '#007bff';
        }}
        onResizerMouseLeave={(e) => {
          e.target.style.opacity = '0.7';
          e.target.style.background = '#dee2e6';
        }}
      >
        <div className="topic-tree-panel">
          <TopicTreeComponent
            connectionId={selectedConnection}
            onTopicSelect={handleTopicSelect}
            topicTreeService={TopicTreeService}
          />
        </div>
        <MessagePanel
          messages={connectionMessages}
          selectedTopic={selectedTopic}
          onClearFilter={handleClearFilter}
          onClearMessages={handleClearMessages}
          connectionName={getSelectedConnectionName()}
        />
      </SplitPane>
    );
  };

  return (
    <div className="app">
      <SplitPane
        split="vertical"
        minSize={250}
        maxSize={400}
        defaultSize={connectionSidebarWidth}
        onChange={(size) => setConnectionSidebarWidth(size)}
        resizerStyle={{
          background: '#e9ecef',
          opacity: 0.8,
          zIndex: 1,
          cursor: 'col-resize',
          width: '4px',
          border: 'none',
          transition: 'opacity 0.2s'
        }}
        onResizerMouseEnter={(e) => {
          e.target.style.opacity = '1';
          e.target.style.background = '#007bff';
        }}
        onResizerMouseLeave={(e) => {
          e.target.style.opacity = '0.8';
          e.target.style.background = '#e9ecef';
        }}
      >
        <ConnectionSidebar
          connections={connections}
          activeConnections={activeConnections}
          onConnectionSelect={handleConnectionSelect}
          onConnectionCreate={handleConnectionCreate}
          onConnectionDelete={handleConnectionDelete}
          onConnectionToggle={handleConnectionToggle}
        />
        
        <div className="main-content">
          <div className="main-header">
            <div className="header-left">
              <h2>
                {selectedConnection ? getSelectedConnectionName() : 'MQTTLooter'}
              </h2>
              {selectedConnection && (
                <div className="connection-info">
                  <span className="connection-id">{selectedConnection}</span>
                  {activeConnections.length > 1 && (
                    <span className="multi-connection-indicator">
                      {activeConnections.length} connections active
                    </span>
                  )}
                </div>
              )}
            </div>
            
            <div className="header-controls">
              {selectedConnection && topicTreeReady && (
                <button onClick={toggleTopicTree} className="toggle-tree-btn">
                  {showTopicTree ? '📋' : '🌳'} {showTopicTree ? 'Hide Topics' : 'Show Topics'}
                </button>
              )}
            </div>
          </div>
          
          {renderMainContent()}
        </div>
      </SplitPane>

      <ToastContainer position="top-right" autoClose={3000} />
    </div>
  );
}

export default App;