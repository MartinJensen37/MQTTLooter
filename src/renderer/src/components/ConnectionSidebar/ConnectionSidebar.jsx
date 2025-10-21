import React, { useState, useCallback, useEffect } from 'react';
import ConnectionCard from './ConnectionCard';
import ConnectionModal from './ConnectionModal';
import ConfirmationModal from './ConfirmationModal';
import './ConnectionSidebar.css';

// Updated import path for assets within src directory
import mqttLooterLogo from '../../assets/MQTTLooter_logo_small.png';

function ConnectionSidebar({ 
  connections, 
  activeConnections, 
  onConnectionSelect, 
  onConnectionCreate, 
  onConnectionDelete,
  onConnectionToggle,
  selectedConnectionId,
  isCollapsed = false,
  onToggleCollapse
}) {
  const [showModal, setShowModal] = useState(false);
  const [editingConnection, setEditingConnection] = useState(null);
  const [modalKey, setModalKey] = useState(0);
  const [forceRenderKey, setForceRenderKey] = useState(0);
  const [localSelectedId, setLocalSelectedId] = useState(selectedConnectionId);
  
  // Confirmation modal state
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [connectionToDelete, setConnectionToDelete] = useState(null);

  // Auto-select first active connection if none selected
  useEffect(() => {
    if (!selectedConnectionId && !localSelectedId && activeConnections.length > 0) {
      const firstActive = activeConnections[0];
      setLocalSelectedId(firstActive);
      if (onConnectionSelect) {
        onConnectionSelect(firstActive);
      }
    }
  }, [selectedConnectionId, localSelectedId, activeConnections, onConnectionSelect]);
  
  useEffect(() => {
    console.log('ConnectionSidebar: Received connections prop:', connections);
    console.log('ConnectionSidebar: Connections length:', connections?.length);
  }, [connections]);

  // Sync with parent selectedConnectionId
  useEffect(() => {
    if (selectedConnectionId !== localSelectedId) {
      setLocalSelectedId(selectedConnectionId);
    }
  }, [selectedConnectionId]);

  // Use useCallback to prevent stale closures
  const handleCreateConnection = useCallback((connectionData) => {
    onConnectionCreate(connectionData);
    setShowModal(false);
    setEditingConnection(null);
    setModalKey(prev => prev + 1);
  }, [onConnectionCreate]);

  const handleEditConnection = useCallback((connection) => {
    setEditingConnection(connection);
    setModalKey(prev => prev + 1);
    setShowModal(true);
  }, []);

  const handleUpdateConnection = useCallback((connectionData) => {
    const updatedConnection = { 
      ...connectionData, 
      id: editingConnection.id 
    };
    
    onConnectionCreate(updatedConnection);
    setEditingConnection(null);
    setShowModal(false);
    setModalKey(prev => prev + 1);
  }, [editingConnection, onConnectionCreate]);
  
  const handleModalClose = useCallback(() => {
    setShowModal(false);
    setEditingConnection(null);
    setModalKey(prev => prev + 1);
  }, []);

  const handleAddNewConnection = useCallback(() => {
    setEditingConnection(null);
    setModalKey(prev => prev + 1);
    setShowModal(true);
  }, []);

  // Enhanced connection selection handler
  const handleConnectionSelect = useCallback((connectionId) => {
    setLocalSelectedId(connectionId);
    if (onConnectionSelect) {
      onConnectionSelect(connectionId);
    }
  }, [onConnectionSelect]);

  // Show confirmation dialog
  const handleConnectionDeleteRequest = useCallback((connectionId) => {
    const connection = connections.find(c => c.id === connectionId);
    setConnectionToDelete(connection);
    setShowConfirmation(true);
  }, [connections]);

  // Confirm delete
  const handleConfirmDelete = useCallback(async () => {
    if (connectionToDelete) {
      try {
        await onConnectionDelete(connectionToDelete.id);
        // If we deleted the selected connection, clear selection
        if (localSelectedId === connectionToDelete.id) {
          setLocalSelectedId(null);
        }
        setForceRenderKey(prev => prev + 1);
        setModalKey(prev => prev + 1);
      } catch (error) {
        console.error('Error deleting connection:', error);
      }
    }
    setShowConfirmation(false);
    setConnectionToDelete(null);
  }, [connectionToDelete, onConnectionDelete, localSelectedId]);

  // Cancel delete
  const handleCancelDelete = useCallback(() => {
    setShowConfirmation(false);
    setConnectionToDelete(null);
  }, []);

  // Handle logo click to toggle collapse
  const handleLogoClick = useCallback(() => {
    if (onToggleCollapse) {
      onToggleCollapse();
    }
  }, [onToggleCollapse]);

  // Determine which connection is actually selected
  const effectiveSelectedId = selectedConnectionId || localSelectedId;

  return (
    <div className={`connection-sidebar ${isCollapsed ? 'collapsed' : ''}`} key={forceRenderKey}>
      <div className="sidebar-header">
        <div className="logo-section" onClick={handleLogoClick} title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
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
                <span className="active-count">
                  {activeConnections.length} active
                </span>
              )}
            </div>
          </div>
        )}

        <div className="connections-list">
          {connections.length === 0 ? (
            !isCollapsed && (
              <div className="no-connections">
                <div className="no-connections-icon">🔌</div>
                <p>No connections yet</p>
                <p className="hint">Click the + button to add your first MQTT connection</p>
              </div>
            )
          ) : (
            connections.map(connection => {
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
            })
          )}
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