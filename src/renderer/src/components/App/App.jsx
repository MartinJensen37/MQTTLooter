import React, { useState, useEffect, useRef, useMemo } from 'react';
import SplitPane from 'react-split-pane';
import { toast, ToastContainer } from 'react-toastify';
import MQTTService from '../../services/MQTTService.js';
import TopicTreeService from '../../services/TopicTreeService.js';
import ConnectionSidebar from '../ConnectionSidebar/ConnectionSidebar';
import TopicTreeComponent from '../TopicTree/TopicTreeComponent';
import MessagePanel from '../MessagePanel/MessagePanel.jsx';
import PublishingPanel from '../PublishingPanel/PublishingPanel';
import RecordingPanel from '../RecordingPanel/RecordingPanel';
import SimulationPanel from '../SimulationPanel/SimulationPanel';
import 'react-toastify/dist/ReactToastify.css';
import './App.css';

function App() {
  const [connections, setConnections] = useState([]);
  const [messages, setMessages] = useState([]);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [showTopicTree, setShowTopicTree] = useState(true);
  const [topicTreeReady, setTopicTreeReady] = useState(false);
  const [activeTab, setActiveTab] = useState('logging');
  const [lastSelectedTopics, setLastSelectedTopics] = useState({});
  
  // Panel size states
  const [connectionSidebarWidth, setConnectionSidebarWidth] = useState(280);
  const [topicTreeWidth, setTopicTreeWidth] = useState(500);

  // Derive activeConnections from connections state
  const activeConnections = useMemo(() => {
    return connections
      .filter(conn => conn.isConnected || conn.status === 'connected')
      .map(conn => conn.id);
  }, [connections]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      // Only handle F keys when a connection is selected
      if (!selectedConnection) return;
      
      switch (event.key) {
        case 'F1':
          event.preventDefault();
          setActiveTab('logging');
          break;
        case 'F2':
          event.preventDefault();
          setActiveTab('publishing');
          break;
        case 'F3':
          event.preventDefault();
          setActiveTab('recording');
          break;
        case 'F4':
          event.preventDefault();
          setActiveTab('simulation');
          break;
        default:
          break;
    }
  };

  // Add event listener
  window.addEventListener('keydown', handleKeyDown);

  // Cleanup
  return () => {
    window.removeEventListener('keydown', handleKeyDown);
  };
  }, [selectedConnection]);

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
      
      // Update connection status to connected
      setConnections(prev => prev.map(conn => 
        conn.id === data.id 
          ? { ...conn, status: 'connected', isConnected: true }
          : conn
      ));
      
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
      
      // Update connection status to disconnected
      setConnections(prev => prev.map(conn => 
        conn.id === data.id 
          ? { ...conn, status: 'disconnected', isConnected: false }
          : conn
      ));
      
      // Clean up the topic tree when disconnecting
      TopicTreeService.removeTopicTree(data.id);
      
      // DELETE messages for this connection when disconnecting
      setMessages(prev => prev.filter(msg => msg.connectionId !== data.id));
      
      // Clear selected topic if it belongs to the disconnected connection
      setSelectedTopic(current => {
        if (current && current.connectionId === data.id) {
          return null;
        }
        return current;
      });
      
      // Clear the last selected topic for this connection when disconnecting
      setLastSelectedTopics(prev => {
        const newTopics = { ...prev };
        delete newTopics[data.id];
        return newTopics;
      });
      
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
                
                const newSelectedConnection = freshActiveIds.length > 0 ? freshActiveIds[0] : null;
                
                // If switching to a new connection, restore its last selected topic
                if (newSelectedConnection) {
                  const lastTopic = lastSelectedTopics[newSelectedConnection];
                  if (lastTopic) {
                    setSelectedTopic(lastTopic);
                  } else {
                    setSelectedTopic(null);
                  }
                }
                
                return newSelectedConnection;
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
      
      setMessages(prev => {
        // Add the new message
        const newMessages = [newMessage, ...prev];
        
        // Group messages by topic and connection
        const messagesByTopic = {};
        const otherMessages = [];
        
        newMessages.forEach(msg => {
          const topicKey = `${msg.connectionId}::${msg.topic}`;
          if (!messagesByTopic[topicKey]) {
            messagesByTopic[topicKey] = [];
          }
          messagesByTopic[topicKey].push(msg);
        });
        
        // Limit each topic to 300 messages, keep the most recent ones
        Object.keys(messagesByTopic).forEach(topicKey => {
          if (messagesByTopic[topicKey].length > 300) {
            messagesByTopic[topicKey] = messagesByTopic[topicKey].slice(0, 300);
          }
        });
        
        // Flatten back to single array
        const limitedMessages = [];
        Object.values(messagesByTopic).forEach(topicMessages => {
          limitedMessages.push(...topicMessages);
        });
        
        // Sort by timestamp (most recent first)
        return limitedMessages.sort((a, b) => b.timestamp - a.timestamp);
      });
    };

    const handleError = (data) => {
      console.log('Error event:', data);
      toast.error(`Connection error: ${data.error}`);
      
      // Set connection to disconnected on error
      if (data.id) {
        setConnections(prev => prev.map(conn => 
          conn.id === data.id 
            ? { ...conn, status: 'disconnected', isConnected: false }
            : conn
        ));
        
        // Clean up topic tree on connection error
        TopicTreeService.removeTopicTree(data.id);
        
        // DELETE messages for this connection when error occurs
        setMessages(prev => prev.filter(msg => msg.connectionId !== data.id));
        
        // Clear selected topic if it belongs to the error connection
        setSelectedTopic(current => {
          if (current && current.connectionId === data.id) {
            return null;
          }
          return current;
        });
      }
      
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
    console.log('handleConnectionCreate called with:', connectionData);
    
    try {
      const isUpdate = !!connectionData.id;
      const connectionId = connectionData.id || `connection_${Date.now()}`;
      
      console.log('Is update:', isUpdate, 'Connection ID:', connectionId);
      
      if (isUpdate) {
        console.log('Updating existing connection');
        
        // ALWAYS update the local connection config first, regardless of connection status
        setConnections(prev => prev.map(conn => 
          conn.id === connectionId 
            ? { 
                ...conn, 
                config: connectionData // Update the config
              }
            : conn
        ));
        
        // Also update the MQTTService with the new config
        try {
          await MQTTService.updateConnectionConfig(connectionId, connectionData);
        } catch (serviceError) {
          console.warn('Failed to update MQTTService config:', serviceError);
          // Continue anyway - the local state is updated
        }
        
        // Check if it was previously active
        const wasActive = activeConnections.includes(connectionId);
        console.log('Was active:', wasActive);
        
        if (wasActive) {
          try {
            // Disconnect first, then reconnect with new config
            await MQTTService.disconnect(connectionId);
            
            // Set connecting state
            setConnections(prev => prev.map(conn => 
              conn.id === connectionId 
                ? { ...conn, status: 'connecting', isConnected: false }
                : conn
            ));
            
            await MQTTService.connect(connectionId, connectionData);
            
            // Keep it selected
            setSelectedConnection(connectionId);
          } catch (connectError) {
            // Handle connection/subscription errors
            console.error('Connection error during update:', connectError);
            toast.error(`Connection failed: ${connectError.message || 'Unknown error'}`);
            
            // Set to disconnected on error but KEEP the updated config
            setConnections(prev => prev.map(conn => 
              conn.id === connectionId 
                ? { 
                    ...conn, 
                    config: connectionData, // Preserve the updated config
                    status: 'disconnected', 
                    isConnected: false 
                  }
                : conn
            ));
          }
        } else {
          console.log('Connection was not active, config updated successfully');
          // For disconnected connections, just keep the updated config
          // Don't call updateConnectionsList() as it might overwrite our changes
        }
      } else {
        // This is a new connection - set connecting state first
        setConnections(prev => [...prev, {
          id: connectionId,
          config: connectionData,
          status: 'connecting',
          isConnected: false,
          subscriptions: []
        }]);
        
        try {
          await MQTTService.connect(connectionId, connectionData);
          
          // Select the new connection
          setSelectedConnection(connectionId);
        } catch (connectError) {
          console.error('Connection error during creation:', connectError);
          toast.error(`Failed to connect: ${connectError.message || 'Unknown error'}`);
          
          // Set to disconnected on error but keep the config
          setConnections(prev => prev.map(conn => 
            conn.id === connectionId 
              ? { ...conn, status: 'disconnected', isConnected: false }
              : conn
          ));
        }
      }
    } catch (error) {
      console.error('Connection error:', error);
      toast.error(`Failed to ${connectionData.id ? 'update' : 'create'} connection: ${error.message}`);
      
      // Set to disconnected on error, but preserve the updated config
      if (connectionData.id) {
        setConnections(prev => prev.map(conn => 
          conn.id === connectionData.id 
            ? { 
                ...conn, 
                config: connectionData, // Preserve the updated config
                status: 'disconnected', 
                isConnected: false 
              }
            : conn
        ));
      }
    }
  };

  const handleConnectionSelect = (connectionId) => {
      // Store the current selected topic for the current connection before switching
      if (selectedConnection && selectedTopic) {
        setLastSelectedTopics(prev => ({
          ...prev,
          [selectedConnection]: selectedTopic
        }));
      }
      
      setSelectedConnection(connectionId);
      
      // Restore the last selected topic for the new connection
      const lastTopic = lastSelectedTopics[connectionId];
      if (lastTopic) {
        setSelectedTopic(lastTopic);
      } else {
        setSelectedTopic(null); // Clear if no previous topic
      }
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
        // Clean up topic tree before disconnecting
        TopicTreeService.removeTopicTree(connectionId);
        
        // Clear messages for this connection before disconnecting
        setMessages(prev => prev.filter(msg => msg.connectionId !== connectionId));
        
        // Clear selected topic if it belongs to this connection
        setSelectedTopic(current => {
          if (current && current.connectionId === connectionId) {
            return null;
          }
          return current;
        });
        
        await MQTTService.disconnect(connectionId);
        toast.info(`Disconnecting from ${localConnection.config?.name || connectionId}`);
      } else {
        // Set connecting state immediately
        setConnections(prev => prev.map(conn => 
          conn.id === connectionId 
            ? { ...conn, status: 'connecting', isConnected: false }
            : conn
        ));
        
        toast.info(`Connecting to ${localConnection.config?.name || connectionId}`);
        
        try {
          await MQTTService.connect(connectionId, localConnection.config);
          // Success case will be handled by the 'connected' event handler
        } catch (connectError) {
          // Failed connection - set to disconnected
          setConnections(prev => prev.map(conn => 
            conn.id === connectionId 
              ? { ...conn, status: 'disconnected', isConnected: false }
              : conn
          ));
          throw connectError; // Re-throw to be caught by outer catch
        }
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
      
      // Clean up the topic tree for this connection
      TopicTreeService.removeTopicTree(connectionId);
      
      // Only remove messages when actually deleting the connection
      setMessages(prev => prev.filter(msg => msg.connectionId !== connectionId));
      
      // Clear the last selected topic for this connection when deleting
      setLastSelectedTopics(prev => {
        const newTopics = { ...prev };
        delete newTopics[connectionId];
        return newTopics;
      });
      
      // Clear selected connection if it was deleted
      setSelectedConnection(current => {
        if (current === connectionId) {
          // Find another active connection to select
          const remainingActive = activeConnections.filter(id => id !== connectionId);
          const newSelected = remainingActive.length > 0 ? remainingActive[0] : null;
          console.log(`Selected connection changed from ${current} to ${newSelected}`);
          
          // If switching to a new connection, restore its last selected topic
          if (newSelected) {
            const lastTopic = lastSelectedTopics[newSelected];
            if (lastTopic) {
              setSelectedTopic(lastTopic);
            } else {
              setSelectedTopic(null);
            }
          } else {
            setSelectedTopic(null);
          }
          
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
    const newSelectedTopic = { topicPath, node, connectionId: selectedConnection };
    setSelectedTopic(newSelectedTopic);
    
    // Store this as the last selected topic for this connection
    setLastSelectedTopics(prev => ({
      ...prev,
      [selectedConnection]: newSelectedTopic
    }));
  };

  // New function to handle publishing messages
  const handlePublishMessage = async (messageData) => {
    try {
      if (!selectedConnection) {
        toast.error('No active connection selected');
        return;
      }

      // Check if the selected connection is actually connected
      const connection = connections.find(c => c.id === selectedConnection);
      if (!connection?.isConnected) {
        toast.error('Selected connection is not active');
        return;
      }

      // Use MQTTService to publish the message
      await MQTTService.publish(selectedConnection, {
        topic: messageData.topic,
        message: messageData.payload,  // Map payload to message
        qos: messageData.qos,
        retain: messageData.retain
      });

      
    } catch (error) {
      console.error('Failed to publish message:', error);
      toast.error(`Failed to publish message: ${error.message}`);
    }
  };

  const getSelectedConnectionName = () => {
    const connection = connections.find(c => c.id === selectedConnection);
    return connection?.config?.name || 'Unknown Connection';
  };

  const connectionMessages = useMemo(() => {
    if (!selectedConnection) return [];
    
    // Check if the selected connection is actually connected
    const selectedConn = connections.find(c => c.id === selectedConnection);
    const isConnected = selectedConn?.isConnected || selectedConn?.status === 'connected';
    
    // If connection is disconnected, return empty array to show blank message panel
    if (!isConnected) return [];
    
    const filtered = messages.filter(msg => msg.connectionId === selectedConnection);
    
    // Only show messages if a topic is selected
    if (!selectedTopic) return [];
    
    return filtered.filter(msg => msg.topic === selectedTopic.topicPath);
  }, [messages, selectedConnection, selectedTopic, connections]);

  const allConnectionMessages = useMemo(() => {
    if (!selectedConnection) return [];
    
    // Check if the selected connection is actually connected
    const selectedConn = connections.find(c => c.id === selectedConnection);
    const isConnected = selectedConn?.isConnected || selectedConn?.status === 'connected';
    
    // If connection is disconnected, return empty array
    if (!isConnected) return [];
    
    // Return ALL messages for this connection (no topic filter)
    return messages.filter(msg => msg.connectionId === selectedConnection);
  }, [messages, selectedConnection, connections]);

  // Updated function to render all tab content (always mounted, but conditionally visible)
  const renderAllTabContent = () => {
    const isConnected = connections.find(c => c.id === selectedConnection)?.isConnected || false;
    const activeConnection = connections.find(c => c.id === selectedConnection); // Add this line
    
    return (
      <div className="tab-content-container">
        {/* Logging Panel */}
        <div 
          className={`tab-content ${activeTab === 'logging' ? 'active' : 'hidden'}`}
          data-tab="logging"
        >
          <MessagePanel
            messages={connectionMessages}
            selectedTopic={selectedTopic}
            connectionName={getSelectedConnectionName()}
          />
        </div>

        {/* Publishing Panel */}
        <div 
          className={`tab-content ${activeTab === 'publishing' ? 'active' : 'hidden'}`}
          data-tab="publishing"
        >
          <PublishingPanel
            connectionId={selectedConnection}
            onPublishMessage={handlePublishMessage}
            isConnected={isConnected}
            selectedTopic={selectedTopic}
          />
        </div>

        {/* Recording Panel */}
        <div 
          className={`tab-content ${activeTab === 'recording' ? 'active' : 'hidden'}`}
          data-tab="recording"
        >
          <RecordingPanel
            messages={allConnectionMessages}
            connectionName={getSelectedConnectionName()}
            selectedTopic={selectedTopic}
            onPublishMessage={handlePublishMessage}
            isConnected={isConnected}
            activeConnectionId={selectedConnection}
          />
        </div>

        {/* Simulation Panel */}
        <div 
          className={`tab-content ${activeTab === 'simulation' ? 'active' : 'hidden'}`}
          data-tab="simulation"
        >
          <SimulationPanel
            connectionId={selectedConnection}
            onPublishMessage={handlePublishMessage}
            isConnected={isConnected}
            selectedTopic={selectedTopic}
          />
        </div>
      </div>
    );
  };

  // Render main content (topic tree + tab content)
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
      // Only tab content
      return renderAllTabContent();
    }

    // Topic tree + tab content with resizer
    return (
      <SplitPane
        split="vertical"
        minSize={250}
        maxSize={1000}
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
        {renderAllTabContent()}
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
                    <button 
                      onClick={() => setActiveTab('logging')} 
                      className={`tab-btn ${activeTab === 'logging' ? 'active' : ''}`}
                      title="F1 - Logging Panel"
                    >
                      <i className="fas fa-list"></i> Logging <span className="shortcut-hint">F1</span>
                    </button>
                    <button 
                      onClick={() => setActiveTab('publishing')} 
                      className={`tab-btn ${activeTab === 'publishing' ? 'active' : ''}`}
                      title="F2 - Publishing Panel"
                    >
                      <i className="fas fa-paper-plane"></i> Publishing <span className="shortcut-hint">F2</span>
                    </button>
                    <button 
                      onClick={() => setActiveTab('recording')} 
                      className={`tab-btn ${activeTab === 'recording' ? 'active' : ''}`}
                      title="F3 - Recording Panel"
                    >
                      <i className="fas fa-video"></i> Recording <span className="shortcut-hint">F3</span>
                    </button>
                    <button 
                      onClick={() => setActiveTab('simulation')} 
                      className={`tab-btn ${activeTab === 'simulation' ? 'active' : ''}`}
                      title="F4 - Simulation Panel"
                    >
                      <i className="fas fa-microchip"></i> Simulation <span className="shortcut-hint">F4</span>
                    </button>
                  </div>
                </div>
              )}
          </div>
          
          <div className="main-panels">
            {renderMainContent()}
          </div>
        </div>
      </SplitPane>

      <ToastContainer position="top-right" autoClose={2500} />
    </div>
  );
}

export default App;