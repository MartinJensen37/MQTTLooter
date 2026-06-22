import React, { useState } from 'react';
import './ConnectionCard.css';

interface CardConnection {
  id: string;
  config?: any;
  status?: string;
  isConnected?: boolean;
  protocolVersion?: number;
}

interface Props {
  connection: CardConnection;
  isActive: boolean;
  isSelected: boolean;
  isCollapsed?: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function ConnectionCard({
  connection,
  isActive,
  isSelected,
  isCollapsed = false,
  onSelect,
  onToggle,
  onEdit,
  onDelete,
}: Props) {
  const [showActions, setShowActions] = useState(false);

  const getStatusColor = () => {
    if (connection.status === 'connected') return 'connected';
    if (connection.status === 'connecting') return 'connecting';
    return 'disconnected';
  };

  const getStatusDot = () => {
    switch (connection.status) {
      case 'connected':
        return 'status-dot connected';
      case 'connecting':
        return 'status-dot connecting';
      case 'disconnected':
        return 'status-dot disconnected';
      default:
        return 'status-dot unknown';
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

  // Status styling/text used in collapsed mode.
  const getStatusClass = () => {
    if (connection.status === 'connecting' || connection.status === 'disconnecting') {
      return 'connecting';
    }
    if (isActive || connection.status === 'connected') {
      return 'connected';
    }
    if (connection.status === 'error') {
      return 'error';
    }
    return 'disconnected';
  };

  const getStatusText = () => {
    if (connection.status === 'connecting') return 'Connecting...';
    if (connection.status === 'disconnecting') return 'Disconnecting...';
    if (isActive || connection.status === 'connected') return 'Connected';
    if (connection.status === 'error') return 'Error';
    return 'Disconnected';
  };

  const handleCardClick = () => onSelect();

  const handleToggleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle();
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit();
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
  };

  // Collapsed version — minimal status dot.
  if (isCollapsed) {
    return (
      <div
        className={`connection-card collapsed ${isActive ? 'active' : 'inactive'} ${isSelected ? 'selected' : ''}`}
        onClick={handleCardClick}
        title={`${connection.config?.name || 'Unnamed'}\n${getBrokerInfo()}\nStatus: ${getStatusText()}\nMQTT: ${getMqttVersion()}\nClient: ${connection.config?.clientId || 'Auto'}`}
      >
        <div className={`connection-status-dot ${getStatusClass()}`}>
          <div className={`mqtt-version-indicator ${getMqttVersionClass()}`}></div>
        </div>
      </div>
    );
  }

  // Expanded version.
  const cardClassName = [
    'connection-card',
    getStatusColor(),
    isSelected ? 'selected' : '',
    isActive ? 'active' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cardClassName}
      onClick={handleCardClick}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className="card-content">
        {/* Status dot and MQTT version bubble (top-right). */}
        <div className="connection-status">
          <div className={getStatusDot()}></div>
          <div className={`mqtt-version-bubble ${getMqttVersionClass()}`}>{getMqttVersion()}</div>
        </div>

        <div className="connection-info">
          <div className="connection-header">
            <span className="connection-name">{connection.config?.name || connection.id}</span>
          </div>

          <div className="connection-details">
            <div className="connection-meta">
              <span className="connection-status-text">{connection.status}</span>
            </div>
            <span className="connection-broker">{getBrokerInfo()}</span>
            {connection.config?.clientId && (
              <span className="connection-client-id">{connection.config.clientId}</span>
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
            <button className="action-btn edit-btn" onClick={handleEditClick} title="Edit connection">
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
