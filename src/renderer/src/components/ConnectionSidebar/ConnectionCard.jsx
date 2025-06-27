import React, { useState } from 'react';

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

  const getStatusIcon = () => {
    switch (connection.status) {
      case 'connected': return '🟢';
      case 'connecting': return '🟡';
      case 'disconnected': return '🔴';
      default: return '⚫';
    }
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

  const handleDeleteClick = (e) => {
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to delete "${connection.config?.name || connection.id}"?`)) {
      onDelete();
    }
  };

  return (
    <div 
      className={`connection-card ${getStatusColor()} ${isSelected ? 'selected' : ''}`}
      onClick={handleCardClick}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className="card-header">
        <div className="connection-info">
          <div className="connection-name">
            {connection.config?.name || connection.id}
          </div>
          <div className="connection-url">
            {connection.config?.brokerUrl || 'No URL'}
          </div>
        </div>
        
        <div className="connection-status">
          <span className="status-icon" title={connection.status}>
            {getStatusIcon()}
          </span>
        </div>
      </div>

      <div className="card-footer">
        <div className="connection-details">
          <span className={`status-text ${getStatusColor()}`}>
            {connection.status}
          </span>
          {connection.config?.clientId && (
            <span className="client-id">
              {connection.config.clientId}
            </span>
          )}
        </div>

        {showActions && (
          <div className="card-actions">
            <button
              className={`toggle-btn ${connection.isConnected ? 'disconnect' : 'connect'}`}
              onClick={handleToggleClick}
              title={connection.isConnected ? 'Disconnect' : 'Connect'}
            >
              {connection.isConnected ? '⏹️' : '▶️'}
            </button>
            <button
              className="edit-btn"
              onClick={handleEditClick}
              title="Edit connection"
            >
              ✏️
            </button>
            <button
              className="delete-btn"
              onClick={handleDeleteClick}
              title="Delete connection"
            >
              🗑️
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default ConnectionCard;