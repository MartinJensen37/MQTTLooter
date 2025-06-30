import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  // Remove activeConnections as separate state - we'll derive it from connections
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [showTopicTree, setShowTopicTree] = useState(true);
  const [topicTreeReady, setTopicTreeReady] = useState(false);
  
  // Panel size states
  const [connectionSidebarWidth, setConnectionSidebarWidth] = useState(280);
  const [topicTreeWidth, setTopicTreeWidth] = useState(350);

  // Derive activeConnections from connections state
  const activeConnections = useMemo(() => {
    return connections
      .filter(conn => conn.isConnected || conn.status === 'connected')
      .map(conn => conn.id);
  }, [connections]);

  // Use ref to store handlers so they can be properly removed
  const handlersRef = useRef(null);
  const topicTreeHandlersRef = useRef(null);

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

    // Define event handlers and store them in ref for cleanup
    const handleConnected = (data) => {
      console.log('Connected event:', data.id);
      toast.success(`Connected to ${data.id}`);
      updateConnectionsList();
      
      // Set as selected connection if it's the first one or if no connection is selected
      setSelectedConnection(current => {
        if (!current) {
          return data.id;
        }
        return current;
      });
    };

    const handleDisconnected = (data) => {
      console.log('Disconnected event:', data.id);
      toast.info(`Disconnected from ${data.id}`);
      updateConnectionsList();
      
      // Clear selected connection if it was disconnected, or switch to another active one
      setSelectedConnection(current => {
        if (current === data.id) {
          // Find another active connection to select
          // We need to check the updated connections after the state update
          setTimeout(() => {
            setSelectedConnection(currentSelected => {
              if (currentSelected === data.id) {
                // Get fresh active connections
                const freshConnections = MQTTService.getAllConnections();
                const freshActiveIds = freshConnections
                  .filter(conn => conn.isConnected || conn.status === 'connected')
                  .map(conn => conn.id)
                  .filter(id => id !== data.id); // Exclude the disconnected one
                
                return freshActiveIds.length > 0 ? freshActiveIds[0] : null;
              }
              return currentSelected;
            });
          }, 100);
          return current; // Keep current for now, setTimeout will update if needed
        }
        return current;
      });
    };

    const handleMessage = (data) => {
      const newMessage = {
        id: Date.now() + Math.random(),
        connectionId: data.id,
        topic: data.topic,
        message: data.message,
        qos: data.qos,
        retain: data.retain,
        timestamp: data.timestamp || Date.now()
      };
      
      setMessages(prev => [newMessage, ...prev.slice(0, 999)]);
    };

    const handleError = (data) => {
      console.log('Error event:', data);
      toast.error(`Connection error: ${data.error}`);
      updateConnectionsList();
    };

    // Store handlers in ref for cleanup - store the actual function references
    handlersRef.current = {
      handleConnected,
      handleDisconnected,
      handleMessage,
      handleError
    };

    // Set up MQTT event handlers
    console.log('Setting up MQTT event listeners...');
    MQTTService.onAny('connected', handleConnected);
    MQTTService.onAny('disconnected', handleDisconnected);
    MQTTService.onAny('message', handleMessage);
    MQTTService.onAny('error', handleError);

    updateConnectionsList();

    // Cleanup function to remove listeners
    return () => {
      console.log('Cleaning up MQTT event listeners...');
      
      // Get the stored handler references
      if (handlersRef.current) {
        const { handleConnected, handleDisconnected, handleMessage, handleError } = handlersRef.current;
        
        // Correct way to remove global event handlers (onAny uses '*' as connectionId)
        MQTTService.off('*', 'connected', handleConnected);
        MQTTService.off('*', 'disconnected', handleDisconnected);
        MQTTService.off('*', 'message', handleMessage);
        MQTTService.off('*', 'error', handleError);
        
        console.log('MQTT Event listeners removed');
      }

      // Clean up TopicTreeService listeners
      if (topicTreeHandlersRef.current) {
        const { handleTreeCreated, handleTreeUpdated, handleTreeCleared, handleTreeError } = topicTreeHandlersRef.current;
        
        // Remove TopicTreeService listeners (assuming it has an 'off' method)
        if (typeof TopicTreeService.off === 'function') {
          TopicTreeService.off('treeCreated', handleTreeCreated);
          TopicTreeService.off('treeUpdated', handleTreeUpdated);
          TopicTreeService.off('treeCleared', handleTreeCleared);
          TopicTreeService.off('treeError', handleTreeError);
        }
        
        console.log('TopicTree Event listeners removed');
      }
    };
  }, []); // Empty dependency array - run only once

  const setupTopicTreeListeners = () => {
    // Define TopicTree handlers
    const handleTreeCreated = (data) => {
      console.log('Topic tree created for connection:', data.connectionId);
    };

    const handleTreeUpdated = (data) => {
      console.log('Topic tree updated:', data.connectionId, data.topic);
    };

    const handleTreeCleared = (data) => {
      toast.info(`Topic tree cleared for ${data.connectionId}`);
    };

    const handleTreeError = (data) => {
      toast.error(`Topic tree error: ${data.error}`);
    };

    // Store TopicTree handlers in ref for cleanup
    topicTreeHandlersRef.current = {
      handleTreeCreated,
      handleTreeUpdated,
      handleTreeCleared,
      handleTreeError
    };

    // Set up TopicTreeService listeners
    TopicTreeService.on('treeCreated', handleTreeCreated);
    TopicTreeService.on('treeUpdated', handleTreeUpdated);
    TopicTreeService.on('treeCleared', handleTreeCleared);
    TopicTreeService.on('treeError', handleTreeError);
  };

  const updateConnectionsList = async () => {
    try {
      // Get fresh connection data from main process
      const mainConnections = await MQTTService.refreshConnectionsFromMain();
      const localConnections = MQTTService.getAllConnections();
      
      // Merge main process data with local data
      const mergedConnections = localConnections.map(localConn => {
        const mainConn = mainConnections[localConn.id];
        if (mainConn) {
          return {
            ...localConn,
            isConnected: mainConn.isConnected,
            status: mainConn.isConnected ? 'connected' : 'disconnected',
            subscriptions: mainConn.subscriptions || []
          };
        }
        return {
          ...localConn,
          isConnected: false,
          status: 'disconnected'
        };
      });
      
      setConnections(mergedConnections);
      
      // No need to manually manage activeConnections anymore - it's derived from connections
      
    } catch (error) {
      console.error('Failed to update connections list:', error);
      // Fallback to local connections only
      const localConnections = MQTTService.getAllConnections();
      setConnections(localConnections.map(conn => ({
        ...conn,
        isConnected: false,
        status: 'disconnected'
      })));
    }
  };

  const handleConnectionCreate = async (connectionData) => {
    try {
      const isUpdate = !!connectionData.id;
      const connectionId = connectionData.id || `connection_${Date.now()}`;
      
      if (isUpdate) {
        // This is an update - check if it was previously active
        const wasActive = activeConnections.includes(connectionId);
        
        if (wasActive) {
          try {
            // Disconnect first, then reconnect with new config
            await MQTTService.disconnect(connectionId);
            await MQTTService.connect(connectionId, connectionData);
            
            // Keep it selected
            setSelectedConnection(connectionId);
          } catch (subscribeError) {
            // Handle subscription errors specifically
            console.error('Subscription error during update:', subscribeError);
            toast.error(`Subscription failed: ${subscribeError.message || 'Invalid topic pattern'}`);
            
            // Still update the connection list to reflect the connection state
            updateConnectionsList();
          }
        } else {
          // Just update the config without connecting
          updateConnectionsList();
        }
      } else {
        // This is a new connection - connect it
        try {
          await MQTTService.connect(connectionId, connectionData);
          
          // Select the new connection
          setSelectedConnection(connectionId);
        } catch (subscribeError) {
          console.error('Subscription error during creation:', subscribeError);
          toast.error(`Failed to subscribe to topics: ${subscribeError.message || 'Invalid topic pattern'}`);
        }
      }
    } catch (error) {
      console.error('Connection error:', error);
      toast.error(`Failed to ${connectionData.id ? 'update' : 'create'} connection: ${error.message}`);
    }
  };

  const handleConnectionSelect = (connectionId) => {
    setSelectedConnection(connectionId);
    setSelectedTopic(null);
  };

  const handleConnectionToggle = async (connectionId) => {
    try {
      // Get fresh connection status from main process
      const mainConnections = await MQTTService.refreshConnectionsFromMain();
      const mainConnection = mainConnections[connectionId];
      const localConnection = connections.find(c => c.id === connectionId);
      
      if (!localConnection) {
        toast.error('Connection not found');
        return;
      }

      // Use main process connection status as source of truth
      const isCurrentlyConnected = mainConnection?.isConnected || false;
      
      console.log(`Toggling connection ${connectionId}, currently connected: ${isCurrentlyConnected}`);
      
      if (isCurrentlyConnected) {
        await MQTTService.disconnect(connectionId);
        toast.info(`Disconnecting from ${localConnection.config?.name || connectionId}`);
      } else {
        await MQTTService.connect(connectionId, localConnection.config);
        toast.info(`Connecting to ${localConnection.config?.name || connectionId}`);
      }
      
      // Update the connections list after the operation
      await updateConnectionsList();
      
    } catch (error) {
      console.error('Toggle connection error:', error);
      toast.error(`Failed to toggle connection: ${error.message}`);
      // Still update the list to reflect current state
      await updateConnectionsList();
    }
  };

  const handleConnectionDelete = async (connectionId) => {
    try {
      console.log(`Deleting connection: ${connectionId}`);
      
      // Use the deleteConnection method from MQTTService
      await MQTTService.deleteConnection(connectionId);
      
      // Clear selected connection if it was deleted
      setSelectedConnection(current => {
        if (current === connectionId) {
          // Find another active connection to select
          const remainingActive = activeConnections.filter(id => id !== connectionId);
          const newSelected = remainingActive.length > 0 ? remainingActive[0] : null;
          console.log(`Selected connection changed from ${current} to ${newSelected}`);
          return newSelected;
        }
        return current;
      });
      
      // Update connections list to reflect the deletion
      await updateConnectionsList();
      
      toast.success('Connection removed');
      
    } catch (error) {
      console.error('Delete connection error:', error);
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
          <div className="no-connection-icon">
            <i className="fas fa-plug"></i>
          </div>
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
        maxSize={450}
        defaultSize={connectionSidebarWidth}
        onChange={(size) => setConnectionSidebarWidth(size)}
        resizerStyle={{
          background: '#e9ecef',
          opacity: 0.8,
          zIndex: 2,
          cursor: 'col-resize',
          width: '4px',
          border: 'none',
          transition: 'opacity 0.2s'
        }}
        onResizerMouseEnter={(e) => {
          e.target.style.opacity = '1';
          e.target.style.background = '#28a745';
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
          selectedConnectionId={selectedConnection}
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
                </div>
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