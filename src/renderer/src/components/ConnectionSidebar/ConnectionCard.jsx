import React, { useState } from 'react';
import './ConnectionCard.css';

function ConnectionCard({ 
  connection, 
  isActive, 
  isSelected, 
  onSelect, 
  onToggle, 
  onEdit, 
  onDelete 
}) {
  const [showActions, setShowActions] = useState(false);

  const getStatusColor = () => {
    if (connection.status === 'connected') return 'connected';
    if (connection.status === 'connecting') return 'connecting';
    return 'disconnected';
  };

  const getStatusDot = () => {
    switch (connection.status) {
      case 'connected': return 'status-dot connected';
      case 'connecting': return 'status-dot connecting';
      case 'disconnected': return 'status-dot disconnected';
      default: return 'status-dot unknown';
    }
  };

  const getBrokerInfo = () => {
    try {
      const url = new URL(connection.config?.brokerUrl || '');
      const protocol = url.protocol.replace(':', '');
      const host = url.hostname || 'localhost';
      const port = url.port || (url.protocol === 'mqtts:' ? '8883' : '1883');
      return `${protocol}://${host}:${port}`;
    } catch {
      return connection.config?.brokerUrl || 'No URL';
    }
  };

  const getMqttVersion = () => {
    const version = connection.config?.protocolVersion || connection.protocolVersion || 4;
    return version === 5 ? 'v5' : 'v3.1.1';
  };

  const getMqttVersionClass = () => {
    const version = connection.config?.protocolVersion || connection.protocolVersion || 4;
    return version === 5 ? 'mqtt5' : 'mqtt311';
  };

  const handleCardClick = () => {
    onSelect();
  };

  const handleToggleClick = (e) => {
    e.stopPropagation();
    onToggle();
  };

  const handleEditClick = (e) => {
    e.stopPropagation();
    onEdit();
  };

  const handleDeleteClick = async (e) => {
    e.stopPropagation();
    onDelete();
  };

  const cardClassName = [
    'connection-card',
    getStatusColor(),
    isSelected ? 'selected' : '',
    isActive ? 'active' : ''
  ].filter(Boolean).join(' ');

  return (
    <div 
      className={cardClassName}
      onClick={handleCardClick}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      style={{
        transform: isSelected ? 'translateX(12px)' : 'translateX(0)',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
      }}
    >
      <div className="card-content">
        {/* Status dot and MQTT version bubble in top right corner */}
        <div className="connection-status">
          <div className={getStatusDot()}></div>
          <div className={`mqtt-version-bubble ${getMqttVersionClass()}`}>
            {getMqttVersion()}
          </div>
        </div>
        
        <div className="connection-info">
          <div className="connection-header">
            <span className="connection-name">
              {connection.config?.name || connection.id}
            </span>
          </div>
          
          <div className="connection-details">
            <div className="connection-meta">
              <span className="connection-status-text">
                {connection.status}
              </span>
            </div>
            <span className="connection-broker">
              {getBrokerInfo()}
            </span>
            {connection.config?.clientId && (
              <span className="connection-client-id">
                {connection.config.clientId}
              </span>
            )}
          </div>
        </div>

        <div className="card-actions-container">
          <div className={`card-actions ${!showActions ? 'hidden' : ''}`}>
            <button
              className={`action-btn toggle-btn ${connection.isConnected ? 'disconnect' : 'connect'}`}
              onClick={handleToggleClick}
              title={connection.isConnected ? 'Disconnect' : 'Connect'}
            >
              <i className={connection.isConnected ? 'fas fa-stop' : 'fas fa-play'}></i>
            </button>
            <button
              className="action-btn edit-btn"
              onClick={handleEditClick}
              title="Edit connection"
            >
              <i className="fas fa-edit"></i>
            </button>
            <button
              className="action-btn delete-btn"
              onClick={handleDeleteClick}
              title="Delete connection"
            >
              <i className="fas fa-trash"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ConnectionCard;