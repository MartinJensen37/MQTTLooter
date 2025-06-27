// Create this folder structure: src/renderer/src/assets/images/
// Place your MQTTLooter_logo_small.png file here

import React, { useState } from 'react';
import ConnectionCard from './ConnectionCard';
import ConnectionModal from './ConnectionModal';
import './ConnectionSidebar.css';

// Updated import path for assets within src directory
import mqttLooterLogo from '../../assets/MQTTLooter_logo_small.png';

function ConnectionSidebar({ 
  connections, 
  activeConnections, 
  onConnectionSelect, 
  onConnectionCreate, 
  onConnectionDelete,
  onConnectionToggle 
}) {
  const [showModal, setShowModal] = useState(false);
  const [editingConnection, setEditingConnection] = useState(null);

  const handleCreateConnection = (connectionData) => {
    onConnectionCreate(connectionData);
    setShowModal(false);
  };

  const handleEditConnection = (connection) => {
    setEditingConnection(connection);
    setShowModal(true);
  };

  const handleUpdateConnection = (connectionData) => {
    // Update existing connection
    onConnectionCreate({ ...connectionData, id: editingConnection.id });
    setEditingConnection(null);
    setShowModal(false);
  };

  const handleModalClose = () => {
    setShowModal(false);
    setEditingConnection(null);
  };

  return (
    <div className="connection-sidebar">
      <div className="sidebar-header">
        <div className="logo-section">
          <img src={mqttLooterLogo} alt="MQTTLooter" className="app-logo" />
          <h1>MQTTLooter</h1>
        </div>
        <div className="app-subtitle">
          MQTT Client & Explorer
        </div>
      </div>

      <div className="connections-section">
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

        <div className="connections-list">
          {connections.length === 0 ? (
            <div className="no-connections">
              <div className="no-connections-icon">🔌</div>
              <p>No connections yet</p>
              <p className="hint">Click the + button to add your first MQTT connection</p>
            </div>
          ) : (
            connections.map(connection => (
              <ConnectionCard
                key={connection.id}
                connection={connection}
                isActive={activeConnections.includes(connection.id)}
                isSelected={activeConnections.includes(connection.id)}
                onSelect={() => onConnectionSelect(connection.id)}
                onToggle={() => onConnectionToggle(connection.id)}
                onEdit={() => handleEditConnection(connection)}
                onDelete={() => onConnectionDelete(connection.id)}
              />
            ))
          )}
        </div>
      </div>

      <div className="sidebar-footer">
        <button 
          className="add-connection-btn"
          onClick={() => setShowModal(true)}
          title="Add new connection"
        >
          <span className="plus-icon">+</span>
        </button>
      </div>

      {showModal && (
        <ConnectionModal
          connection={editingConnection}
          onSave={editingConnection ? handleUpdateConnection : handleCreateConnection}
          onCancel={handleModalClose}
        />
      )}
    </div>
  );
}

export default ConnectionSidebar;