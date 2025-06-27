import React, { useState } from 'react';
import './MessagePanel.css';

function MessagePanel({ 
  messages, 
  selectedTopic, 
  onClearFilter, 
  onClearMessages,
  connectionName 
}) {
  const [sortBy, setSortBy] = useState('timestamp');
  const [sortOrder, setSortOrder] = useState('desc');
  const [showRetainedOnly, setShowRetainedOnly] = useState(false);

  // Filter and sort messages
  const processedMessages = React.useMemo(() => {
    let filtered = messages;

    // Filter by selected topic
    if (selectedTopic) {
      filtered = filtered.filter(msg => msg.topic === selectedTopic.topicPath);
    }

    // Filter by retained messages if toggled
    if (showRetainedOnly) {
      filtered = filtered.filter(msg => msg.retain);
    }

    // Sort messages
    filtered.sort((a, b) => {
      let aValue = a[sortBy];
      let bValue = b[sortBy];

      if (sortBy === 'timestamp') {
        aValue = new Date(a.timestamp).getTime();
        bValue = new Date(b.timestamp).getTime();
      }

      if (sortOrder === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

    return filtered;
  }, [messages, selectedTopic, showRetainedOnly, sortBy, sortOrder]);

  const exportAsJSON = () => {
    const exportData = {
      exportDate: new Date().toISOString(),
      connectionName: connectionName || 'Unknown',
      selectedTopic: selectedTopic?.topicPath || 'All Topics',
      messageCount: processedMessages.length,
      messages: processedMessages.map(msg => ({
        timestamp: msg.timestamp,
        topic: msg.topic,
        payload: msg.message,
        qos: msg.qos,
        retain: msg.retain,
        connectionId: msg.connectionId
      }))
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { 
      type: 'application/json' 
    });
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mqtt-messages-${new Date().toISOString().slice(0, 19)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportAsCSV = () => {
    const headers = ['Timestamp', 'Topic', 'Payload', 'QoS', 'Retain', 'Connection'];
    const csvData = [
      headers.join(','),
      ...processedMessages.map(msg => [
        `"${msg.timestamp}"`,
        `"${msg.topic}"`,
        `"${msg.message.replace(/"/g, '""')}"`, // Escape quotes
        msg.qos,
        msg.retain,
        `"${msg.connectionId}"`
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvData], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mqtt-messages-${new Date().toISOString().slice(0, 19)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleString();
  };

  const getPayloadPreview = (payload, maxLength = 100) => {
    if (payload.length <= maxLength) return payload;
    return payload.substring(0, maxLength) + '...';
  };

  const getQoSBadgeClass = (qos) => {
    switch (qos) {
      case 0: return 'qos-0';
      case 1: return 'qos-1';
      case 2: return 'qos-2';
      default: return 'qos-unknown';
    }
  };

  return (
    <div className="message-panel">
      <div className="message-panel-header">
        <div className="header-left">
          <h2>
            Messages ({processedMessages.length})
            {selectedTopic && (
              <span className="filter-indicator">
                - {selectedTopic.topicPath}
              </span>
            )}
          </h2>
        </div>
        
        <div className="header-controls">
          <div className="filter-controls">
            <label className="checkbox-control">
              <input
                type="checkbox"
                checked={showRetainedOnly}
                onChange={(e) => setShowRetainedOnly(e.target.checked)}
              />
              Retained only
            </label>
            
            <select 
              value={sortBy} 
              onChange={(e) => setSortBy(e.target.value)}
              className="sort-select"
            >
              <option value="timestamp">Sort by Time</option>
              <option value="topic">Sort by Topic</option>
              <option value="qos">Sort by QoS</option>
            </select>
            
            <button 
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="sort-order-btn"
              title={`Sort ${sortOrder === 'asc' ? 'Descending' : 'Ascending'}`}
            >
              {sortOrder === 'asc' ? '↓' : '↑'}
            </button>
          </div>
          
          <div className="action-buttons">
            <button onClick={exportAsJSON} className="export-btn json-btn">
              Export JSON
            </button>
            <button onClick={exportAsCSV} className="export-btn csv-btn">
              Export CSV
            </button>
            
            {selectedTopic && (
              <button onClick={onClearFilter} className="clear-filter-btn">
                Clear Filter
              </button>
            )}
            
            <button onClick={onClearMessages} className="clear-messages-btn">
              Clear Messages
            </button>
          </div>
        </div>
      </div>
      
      <div className="message-list">
        {processedMessages.length === 0 ? (
          <div className="no-messages">
            <div className="no-messages-icon">📭</div>
            <h3>No messages yet</h3>
            <p>
              {selectedTopic 
                ? `No messages received for topic "${selectedTopic.topicPath}"`
                : "Connect to an MQTT broker and start receiving messages!"
              }
            </p>
          </div>
        ) : (
          processedMessages.map(msg => (
            <div key={msg.id} className="message-item">
              <div className="message-header">
                <div className="message-meta">
                  <span className="timestamp" title={formatTimestamp(msg.timestamp)}>
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="topic" title={msg.topic}>
                    {msg.topic}
                  </span>
                  <span className={`qos-badge ${getQoSBadgeClass(msg.qos)}`}>
                    QoS {msg.qos}
                  </span>
                  {msg.retain && (
                    <span className="retain-badge">
                      RETAIN
                    </span>
                  )}
                  <span className="connection-id" title={`Connection: ${msg.connectionId}`}>
                    {msg.connectionId}
                  </span>
                </div>
              </div>
              
              <div className="message-content">
                <div className="payload-preview">
                  {getPayloadPreview(msg.message)}
                </div>
                
                {msg.message.length > 100 && (
                  <details className="payload-full">
                    <summary>Show full payload ({msg.message.length} chars)</summary>
                    <pre className="payload-code">{msg.message}</pre>
                  </details>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default MessagePanel;