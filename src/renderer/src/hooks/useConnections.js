import { useState, useEffect, useMemo } from 'react';
import MQTTService from '../services/MQTTService.js';
import TopicTreeService from '../services/TopicTreeService.js';

export function useConnections(showFeedback, selectedTopic, setSelectedTopic) {
  const [connections, setConnections] = useState([]);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [lastSelectedTopics, setLastSelectedTopics] = useState({});

  const activeConnections = useMemo(
    () => connections.filter(c => c.isConnected || c.status === 'connected').map(c => c.id),
    [connections]
  );

  // Load connections from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('mqtt-connections');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setConnections(parsed.map(c => ({ ...c, isConnected: false, status: 'disconnected' })));
      } catch {
        localStorage.removeItem('mqtt-connections');
      }
    }
  }, []);

  // Persist connections to localStorage
  useEffect(() => {
    if (connections.length > 0) {
      localStorage.setItem(
        'mqtt-connections',
        JSON.stringify(connections.map(c => ({ id: c.id, config: c.config })))
      );
    } else {
      localStorage.removeItem('mqtt-connections');
    }
  }, [connections]);

  const updateConnectionsList = async () => {
    try {
      const mainConns = await MQTTService.refreshConnectionsFromMain();
      const local = MQTTService.getAllConnections();
      if (local.length === 0) return;
      setConnections(
        local.map(lc => {
          const mc = mainConns[lc.id];
          return mc
            ? { ...lc, isConnected: mc.isConnected, status: mc.isConnected ? 'connected' : 'disconnected', subscriptions: mc.subscriptions || [] }
            : { ...lc, isConnected: false, status: 'disconnected' };
        })
      );
    } catch (err) {
      console.error('Failed to update connections list:', err);
    }
  };

  const handleConnectionSelect = (connectionId) => {
    // Stash current topic before switching
    if (selectedConnection && selectedTopic) {
      setLastSelectedTopics(prev => ({ ...prev, [selectedConnection]: selectedTopic }));
    }
    setSelectedConnection(connectionId);
    // Restore last topic for the incoming connection
    setLastSelectedTopics(prev => {
      setSelectedTopic(prev[connectionId] || null);
      return prev;
    });
  };

  const handleConnectionCreate = async (connectionData) => {
    try {
      const isUpdate = !!connectionData.id;
      const connectionId = connectionData.id || `connection_${Date.now()}`;

      if (isUpdate) {
        setConnections(prev =>
          prev.map(c => c.id === connectionId ? { ...c, config: connectionData } : c)
        );
        try { await MQTTService.updateConnectionConfig(connectionId, connectionData); } catch {}

        const wasActive = MQTTService.getAllConnections().find(c => c.id === connectionId)?.isConnected;
        if (wasActive) {
          try {
            await MQTTService.disconnect(connectionId);
            setConnections(prev =>
              prev.map(c => c.id === connectionId ? { ...c, status: 'connecting', isConnected: false } : c)
            );
            await MQTTService.connect(connectionId, connectionData);
            setSelectedConnection(connectionId);
          } catch (err) {
            showFeedback(`Connection failed: ${err.message || 'Unknown error'}`, 'error');
            setConnections(prev =>
              prev.map(c => c.id === connectionId ? { ...c, config: connectionData, status: 'disconnected', isConnected: false } : c)
            );
          }
        } else {
          showFeedback('Connection updated successfully', 'success');
        }
      } else {
        setConnections(prev => [...prev, {
          id: connectionId, config: connectionData, status: 'connecting', isConnected: false, subscriptions: []
        }]);
        try {
          await MQTTService.connect(connectionId, connectionData);
          setSelectedConnection(connectionId);
          showFeedback('Connection created successfully', 'success');
        } catch (err) {
          showFeedback(`Failed to connect: ${err.message || 'Unknown error'}`, 'error');
          setConnections(prev =>
            prev.map(c => c.id === connectionId ? { ...c, status: 'disconnected', isConnected: false } : c)
          );
        }
      }
    } catch (err) {
      showFeedback(`Failed to ${connectionData.id ? 'update' : 'create'} connection: ${err.message}`, 'error');
      if (connectionData.id) {
        setConnections(prev =>
          prev.map(c => c.id === connectionData.id
            ? { ...c, config: connectionData, status: 'disconnected', isConnected: false }
            : c)
        );
      }
    }
  };

  const handleConnectionToggle = async (connectionId) => {
    try {
      const mainConns = await MQTTService.refreshConnectionsFromMain();
      const local = connections.find(c => c.id === connectionId);
      if (!local) { showFeedback('Connection not found', 'error'); return; }

      const isConnected = mainConns[connectionId]?.isConnected || false;
      if (isConnected) {
        TopicTreeService.removeTopicTree(connectionId);
        await MQTTService.disconnect(connectionId);
        showFeedback(`Disconnecting from ${local.config?.name || connectionId}`, 'info');
      } else {
        setConnections(prev =>
          prev.map(c => c.id === connectionId ? { ...c, status: 'connecting', isConnected: false } : c)
        );
        showFeedback(`Connecting to ${local.config?.name || connectionId}`, 'info');
        try {
          await MQTTService.connect(connectionId, local.config);
        } catch (err) {
          setConnections(prev =>
            prev.map(c => c.id === connectionId ? { ...c, status: 'disconnected', isConnected: false } : c)
          );
          throw err;
        }
      }
      await updateConnectionsList();
    } catch (err) {
      console.error('Toggle connection error:', err);
      await updateConnectionsList();
    }
  };

  const handleConnectionDelete = async (connectionId) => {
    try {
      await MQTTService.deleteConnection(connectionId);
      TopicTreeService.removeTopicTree(connectionId);

      setLastSelectedTopics(prev => {
        const next = { ...prev };
        delete next[connectionId];
        return next;
      });
      setConnections(prev => prev.filter(c => c.id !== connectionId));

      setSelectedConnection(current => {
        if (current !== connectionId) return current;
        // Find another active connection
        const freshActive = MQTTService.getAllConnections()
          .filter(c => c.isConnected || c.status === 'connected')
          .filter(c => c.id !== connectionId);
        const newSelected = freshActive.length > 0 ? freshActive[0].id : null;
        // Restore topic for newly selected connection
        setLastSelectedTopics(prev => {
          setSelectedTopic(newSelected ? (prev[newSelected] || null) : null);
          return prev;
        });
        return newSelected;
      });

      showFeedback('Connection deleted successfully', 'success');
    } catch (err) {
      showFeedback(`Failed to delete connection: ${err.message}`, 'error');
    }
  };

  return {
    connections, setConnections,
    selectedConnection, setSelectedConnection,
    lastSelectedTopics, setLastSelectedTopics,
    activeConnections,
    updateConnectionsList,
    handleConnectionCreate,
    handleConnectionSelect,
    handleConnectionToggle,
    handleConnectionDelete,
  };
}
