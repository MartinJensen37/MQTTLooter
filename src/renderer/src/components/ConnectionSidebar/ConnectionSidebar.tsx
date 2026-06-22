import React, { useState, useCallback, useEffect } from 'react';
import ConnectionCard from './ConnectionCard';
import ConnectionModal from './ConnectionModal';
import ConfirmationModal from './ConfirmationModal';
import './ConnectionSidebar.css';
import mqttLooterLogo from '../../assets/MQTTLooter_logo_small.png';

interface Connection {
  id: string;
  config?: any;
  status?: string;
  isConnected?: boolean;
  [key: string]: unknown;
}

interface Props {
  connections: Connection[];
  activeConnections: string[];
  onConnectionSelect: (connectionId: string) => void;
  onConnectionCreate: (connectionData: any) => void;
  onConnectionDelete: (connectionId: string) => Promise<void> | void;
  onConnectionToggle: (connectionId: string) => void;
  selectedConnectionId: string | null;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

function ConnectionSidebar({
  connections,
  activeConnections,
  onConnectionSelect,
  onConnectionCreate,
  onConnectionDelete,
  onConnectionToggle,
  selectedConnectionId,
  isCollapsed = false,
  onToggleCollapse,
}: Props) {
  const [showModal, setShowModal] = useState(false);
  const [editingConnection, setEditingConnection] = useState<Connection | null>(null);
  const [modalKey, setModalKey] = useState(0);
  const [forceRenderKey, setForceRenderKey] = useState(0);
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(selectedConnectionId);

  const [showConfirmation, setShowConfirmation] = useState(false);
  const [connectionToDelete, setConnectionToDelete] = useState<Connection | null>(null);

  // Auto-select the first active connection when none is selected.
  useEffect(() => {
    if (!selectedConnectionId && !localSelectedId && activeConnections.length > 0) {
      const firstActive = activeConnections[0];
      setLocalSelectedId(firstActive);
      onConnectionSelect?.(firstActive);
    }
  }, [selectedConnectionId, localSelectedId, activeConnections, onConnectionSelect]);

  // Sync with the parent's selectedConnectionId.
  useEffect(() => {
    if (selectedConnectionId !== localSelectedId) {
      setLocalSelectedId(selectedConnectionId);
    }
  }, [selectedConnectionId]);

  const handleCreateConnection = useCallback(
    (connectionData: any) => {
      onConnectionCreate(connectionData);
      setShowModal(false);
      setEditingConnection(null);
      setModalKey((prev) => prev + 1);
    },
    [onConnectionCreate],
  );

  const handleEditConnection = useCallback((connection: Connection) => {
    setEditingConnection(connection);
    setModalKey((prev) => prev + 1);
    setShowModal(true);
  }, []);

  const handleUpdateConnection = useCallback(
    (connectionData: any) => {
      const updatedConnection = { ...connectionData, id: editingConnection?.id };
      onConnectionCreate(updatedConnection);
      setEditingConnection(null);
      setShowModal(false);
      setModalKey((prev) => prev + 1);
    },
    [editingConnection, onConnectionCreate],
  );

  const handleModalClose = useCallback(() => {
    setShowModal(false);
    setEditingConnection(null);
    setModalKey((prev) => prev + 1);
  }, []);

  const handleAddNewConnection = useCallback(() => {
    setEditingConnection(null);
    setModalKey((prev) => prev + 1);
    setShowModal(true);
  }, []);

  const handleConnectionSelect = useCallback(
    (connectionId: string) => {
      setLocalSelectedId(connectionId);
      onConnectionSelect?.(connectionId);
    },
    [onConnectionSelect],
  );

  const handleConnectionDeleteRequest = useCallback(
    (connectionId: string) => {
      const connection = connections.find((c) => c.id === connectionId) ?? null;
      setConnectionToDelete(connection);
      setShowConfirmation(true);
    },
    [connections],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (connectionToDelete) {
      try {
        await onConnectionDelete(connectionToDelete.id);
        if (localSelectedId === connectionToDelete.id) {
          setLocalSelectedId(null);
        }
        setForceRenderKey((prev) => prev + 1);
        setModalKey((prev) => prev + 1);
      } catch (error) {
        console.error('Error deleting connection:', error);
      }
    }
    setShowConfirmation(false);
    setConnectionToDelete(null);
  }, [connectionToDelete, onConnectionDelete, localSelectedId]);

  const handleCancelDelete = useCallback(() => {
    setShowConfirmation(false);
    setConnectionToDelete(null);
  }, []);

  const handleLogoClick = useCallback(() => {
    onToggleCollapse?.();
  }, [onToggleCollapse]);

  const effectiveSelectedId = selectedConnectionId || localSelectedId;

  return (
    <div className={`connection-sidebar ${isCollapsed ? 'collapsed' : ''}`} key={forceRenderKey}>
      <div className="sidebar-header">
        <div
          className="logo-section"
          onClick={handleLogoClick}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <img src={mqttLooterLogo} alt="MQTTLooter" className="app-logo" />
          {!isCollapsed && <h1>MQTTLooter</h1>}
        </div>
      </div>

      <div className="connections-section">
        {!isCollapsed && (
          <div className="section-header">
            <h3>Connections</h3>
            <div className="connection-stats">
              {activeConnections.length > 0 && (
                <span className="active-count">{activeConnections.length} active</span>
              )}
            </div>
          </div>
        )}

        <div className="connections-list">
          {connections.length === 0
            ? !isCollapsed && (
                <div className="no-connections">
                  <div className="no-connections-icon">🔌</div>
                  <p>No connections yet</p>
                  <p className="hint">Click the + button to add your first MQTT connection</p>
                </div>
              )
            : connections.map((connection) => {
                const isSelected = effectiveSelectedId === connection.id;
                return (
                  <ConnectionCard
                    key={`${connection.id}-${forceRenderKey}`}
                    connection={connection}
                    isActive={activeConnections.includes(connection.id)}
                    isSelected={isSelected}
                    isCollapsed={isCollapsed}
                    onSelect={() => handleConnectionSelect(connection.id)}
                    onToggle={() => onConnectionToggle(connection.id)}
                    onEdit={() => handleEditConnection(connection)}
                    onDelete={() => handleConnectionDeleteRequest(connection.id)}
                  />
                );
              })}
        </div>
      </div>

      <div className="sidebar-footer">
        <button
          className="add-connection-btn"
          onClick={handleAddNewConnection}
          title="Add new connection"
        >
          <span className="plus-icon">+</span>
        </button>
      </div>

      {showModal && (
        <ConnectionModal
          key={`${modalKey}-${forceRenderKey}`}
          connection={editingConnection}
          onSave={editingConnection ? handleUpdateConnection : handleCreateConnection}
          onCancel={handleModalClose}
        />
      )}

      <ConfirmationModal
        isOpen={showConfirmation}
        title="Delete Connection"
        message={`Are you sure you want to delete "${connectionToDelete?.config?.name || connectionToDelete?.id}"? This action cannot be undone.`}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </div>
  );
}

export default ConnectionSidebar;
