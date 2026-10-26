import { useState, useEffect, useMemo, useRef } from 'react';
import MQTTService from '../services/MQTTService';
import TopicTreeService from '../services/TopicTreeService';
import type { ConnectionConfig } from '../../../shared/ipc';
import { splitSecrets } from '../../../shared/credentials';

type ShowFeedback = (message: string, type?: string) => void;
type ConnectionFormData = ConnectionConfig & { id?: string };

export interface ConnectionView {
  id: string;
  config: ConnectionConfig;
  isConnected: boolean;
  status: string;
  subscriptions?: string[];
}

export function useConnections(
  showFeedback: ShowFeedback,
  selectedTopic: unknown,
  setSelectedTopic: (topic: unknown) => void,
) {
  const [connections, setConnections] = useState<ConnectionView[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('mqtt-connections') || '[]');
      return Array.isArray(saved)
        ? saved
            .filter((c) => typeof c.id === 'string' && c.config)
            .map((c) => ({ ...c, isConnected: false, status: 'disconnected' }))
        : [];
    } catch {
      return [];
    }
  });
  const [selectedConnection, setSelectedConnection] = useState<string | null>(null);
  const [lastSelectedTopics, setLastSelectedTopics] = useState<Record<string, unknown>>({});
  const secureStorage = useRef(false);
  const initialConnections = useRef(connections);

  // Move secrets saved by earlier versions from localStorage into main's encrypted store.
  // A connection keeps its secrets locally until main confirms they are stored.
  useEffect(() => {
    const api = window.electronAPI?.credentials;
    if (!api) return;
    let cancelled = false;
    void (async () => {
      try {
        const status = await api.status();
        if (cancelled || !status.success || !status.data?.available) return;
        secureStorage.current = true;
        const moved = new Map<string, ConnectionConfig>();
        for (const connection of initialConnections.current) {
          const { config, secrets } = splitSecrets(connection.config);
          if (!secrets) continue;
          const result = await api.set(connection.id, secrets);
          if (result.success) moved.set(connection.id, config);
        }
        if (!cancelled && moved.size)
          setConnections((previous) =>
            previous.map((c) => (moved.has(c.id) ? { ...c, config: moved.get(c.id)! } : c)),
          );
      } catch {
        /* Secrets stay where they were; connecting still works. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Store secrets in main when possible; otherwise keep them in the saved config as before. */
  const storeSecrets = async (connectionId: string, data: ConnectionConfig) => {
    const { config, secrets } = splitSecrets(data);
    if (!secureStorage.current) return data;
    const result = await window.electronAPI.credentials.set(connectionId, secrets);
    if (result.success) return config;
    showFeedback(`Credentials could not be stored securely: ${result.error}`, 'error');
    return data;
  };

  const activeConnections = useMemo(
    () => connections.filter((c) => c.isConnected || c.status === 'connected').map((c) => c.id),
    [connections],
  );

  // Persist connections to localStorage.
  useEffect(() => {
    try {
      if (connections.length > 0) {
        localStorage.setItem(
          'mqtt-connections',
          JSON.stringify(connections.map((c) => ({ id: c.id, config: c.config }))),
        );
      } else {
        localStorage.removeItem('mqtt-connections');
      }
    } catch {
      showFeedback('Connection settings could not be saved locally.', 'error');
    }
  }, [connections, showFeedback]);

  const updateConnectionsList = async () => {
    try {
      const mainConns = (await MQTTService.refreshConnectionsFromMain()) ?? {};
      // An empty list stays the same object, so saving does not run again for nothing.
      setConnections((saved) =>
        saved.length === 0
          ? saved
          : saved.map((lc) => {
              const mc = mainConns[lc.id];
              if (mc?.isConnected) MQTTService.adoptConnection(lc.id, lc.config, mc);
              return mc
                ? {
                    ...lc,
                    isConnected: mc.isConnected,
                    status: mc.isConnected ? 'connected' : 'disconnected',
                    subscriptions: Object.keys(mc.subscriptions || {}),
                  }
                : { ...lc, isConnected: false, status: 'disconnected' };
            }),
      );
    } catch (err) {
      console.error('Failed to update connections list:', err);
    }
  };

  // Connections live in main and stay open while the window reloads; show them as they are.
  const syncOnLoad = useRef(updateConnectionsList);
  useEffect(() => {
    void syncOnLoad.current();
  }, []);

  const handleConnectionSelect = (connectionId: string) => {
    // Stash the current topic before switching.
    if (selectedConnection && selectedTopic) {
      setLastSelectedTopics((prev) => ({ ...prev, [selectedConnection]: selectedTopic }));
    }
    setSelectedConnection(connectionId);
    // Restore the last topic for the incoming connection.
    setSelectedTopic(lastSelectedTopics[connectionId] || null);
  };

  const handleConnectionCreate = async (connectionData: ConnectionFormData) => {
    try {
      const isUpdate = !!connectionData.id;
      const connectionId = connectionData.id || `connection_${crypto.randomUUID()}`;
      connectionData = await storeSecrets(connectionId, connectionData);

      if (isUpdate) {
        setConnections((prev) =>
          prev.map((c) => (c.id === connectionId ? { ...c, config: connectionData } : c)),
        );
        try {
          await MQTTService.updateConnectionConfig(connectionId, connectionData);
        } catch {
          /* config cache update is best-effort */
        }

        const wasActive = MQTTService.getAllConnections().find(
          (c) => c.id === connectionId,
        )?.isConnected;
        if (wasActive) {
          try {
            await MQTTService.disconnect(connectionId);
            setConnections((prev) =>
              prev.map((c) =>
                c.id === connectionId ? { ...c, status: 'connecting', isConnected: false } : c,
              ),
            );
            await MQTTService.connect(connectionId, connectionData);
            handleConnectionSelect(connectionId);
          } catch (err: any) {
            showFeedback(`Connection failed: ${err.message || 'Unknown error'}`, 'error');
            setConnections((prev) =>
              prev.map((c) =>
                c.id === connectionId
                  ? { ...c, config: connectionData, status: 'disconnected', isConnected: false }
                  : c,
              ),
            );
          }
        } else {
          showFeedback('Connection updated successfully', 'success');
        }
      } else {
        setConnections((prev) => [
          ...prev,
          {
            id: connectionId,
            config: connectionData,
            status: 'connecting',
            isConnected: false,
            subscriptions: [],
          },
        ]);
        try {
          await MQTTService.connect(connectionId, connectionData);
          handleConnectionSelect(connectionId);
          showFeedback('Connection created successfully', 'success');
        } catch (err: any) {
          showFeedback(`Failed to connect: ${err.message || 'Unknown error'}`, 'error');
          setConnections((prev) =>
            prev.map((c) =>
              c.id === connectionId ? { ...c, status: 'disconnected', isConnected: false } : c,
            ),
          );
        }
      }
    } catch (err: any) {
      showFeedback(
        `Failed to ${connectionData.id ? 'update' : 'create'} connection: ${err.message}`,
        'error',
      );
      if (connectionData.id) {
        setConnections((prev) =>
          prev.map((c) =>
            c.id === connectionData.id
              ? { ...c, config: connectionData, status: 'disconnected', isConnected: false }
              : c,
          ),
        );
      }
    }
  };

  const handleConnectionToggle = async (connectionId: string) => {
    try {
      const mainConns = (await MQTTService.refreshConnectionsFromMain()) ?? {};
      const local = connections.find((c) => c.id === connectionId);
      if (!local) {
        showFeedback('Connection not found', 'error');
        return;
      }

      const isConnected = mainConns[connectionId]?.isConnected || false;
      if (isConnected) {
        await MQTTService.disconnect(connectionId);
        showFeedback(`Disconnecting from ${local.config?.name || connectionId}`, 'info');
      } else {
        setConnections((prev) =>
          prev.map((c) =>
            c.id === connectionId ? { ...c, status: 'connecting', isConnected: false } : c,
          ),
        );
        showFeedback(`Connecting to ${local.config?.name || connectionId}`, 'info');
        try {
          await MQTTService.connect(connectionId, local.config);
        } catch (err) {
          setConnections((prev) =>
            prev.map((c) =>
              c.id === connectionId ? { ...c, status: 'disconnected', isConnected: false } : c,
            ),
          );
          throw err;
        }
      }
      await updateConnectionsList();
    } catch (err) {
      console.error('Toggle connection error:', err);
      showFeedback(`Connection failed: ${(err as Error).message}`, 'error');
      await updateConnectionsList();
    }
  };

  const handleConnectionDelete = async (connectionId: string) => {
    try {
      await MQTTService.deleteConnection(connectionId);
      TopicTreeService.removeTopicTree(connectionId);
      if (secureStorage.current) await window.electronAPI.credentials.set(connectionId, null);

      setLastSelectedTopics((prev) => {
        const next = { ...prev };
        delete next[connectionId];
        return next;
      });
      setConnections((prev) => prev.filter((c) => c.id !== connectionId));

      if (selectedConnection === connectionId) {
        const freshActive = MQTTService.getAllConnections()
          .filter((c) => c.isConnected || c.status === 'connected')
          .filter((c) => c.id !== connectionId);
        const newSelected = freshActive.length > 0 ? freshActive[0].id : null;
        setSelectedTopic(newSelected ? lastSelectedTopics[newSelected] || null : null);
        setSelectedConnection(newSelected);
      }

      showFeedback('Connection deleted successfully', 'success');
    } catch (err: any) {
      showFeedback(`Failed to delete connection: ${err.message}`, 'error');
    }
  };

  return {
    connections,
    setConnections,
    selectedConnection,
    setSelectedConnection,
    lastSelectedTopics,
    setLastSelectedTopics,
    activeConnections,
    updateConnectionsList,
    handleConnectionCreate,
    handleConnectionSelect,
    handleConnectionToggle,
    handleConnectionDelete,
  };
}
