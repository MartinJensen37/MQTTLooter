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
  const [showTopicExportMenu, setShowTopicExportMenu] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState('');

  // Filter
const processedMessages = React.useMemo(() => {
  // Messages are already filtered by connection and topic in App.jsx
  return messages;
}, [messages, showRetainedOnly, sortBy, sortOrder]);

  // Get the most recent message for the selected topic (for topic details)
  const topicDetails = React.useMemo(() => {
    if (!selectedTopic || processedMessages.length === 0) return null;
    
    return processedMessages[processedMessages.length - 1]; // Most recent message
  }, [selectedTopic, processedMessages]);

  const showCopyFeedback = (message) => {
    setCopyFeedback(message);
    setTimeout(() => setCopyFeedback(''), 2000); // Clear feedback after 2 seconds
  };

  const exportTopicAsJSON = () => {
    if (!selectedTopic || processedMessages.length === 0) return;
    
    const exportData = {
      exportDate: new Date().toISOString(),
      connectionName: connectionName || 'Unknown',
      topic: selectedTopic.topicPath,
      messageCount: processedMessages.length,
      messages: processedMessages.map(msg => ({
        timestamp: msg.timestamp,
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
    a.download = `mqtt-topic-${selectedTopic.topicPath.replace(/[\/\\:*?"<>|]/g, '_')}-${new Date().toISOString().slice(0, 19)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowTopicExportMenu(false);
  };

  const exportTopicAsCSV = () => {
    if (!selectedTopic || processedMessages.length === 0) return;
    
    const headers = ['Timestamp', 'Payload', 'QoS', 'Retain', 'Connection'];
    const csvData = [
      headers.join(','),
      ...processedMessages.map(msg => [
        `"${msg.timestamp}"`,
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
    a.download = `mqtt-topic-${selectedTopic.topicPath.replace(/[\/\\:*?"<>|]/g, '_')}-${new Date().toISOString().slice(0, 19)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowTopicExportMenu(false);
  };

  const copyTopicPath = () => {
    if (selectedTopic) {
      navigator.clipboard.writeText(selectedTopic.topicPath);
      showCopyFeedback('Topic path copied!');
    }
  };

  const copyPayload = (payload, event) => {
    // Stop event propagation to prevent conflicts
    if (event) {
      event.stopPropagation();
    }
    navigator.clipboard.writeText(payload);
    showCopyFeedback('Payload copied!');
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
      {/* Copy Feedback Toast */}
      {copyFeedback && (
        <div className="copy-feedback">
          <i className="fas fa-check-circle"></i> {copyFeedback}
        </div>
      )}

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
      </div>

      {/* Topic Details Box */}
      {selectedTopic && topicDetails && (
        <div className="topic-details-box">
          <div className="topic-details-header">
            <h3>Topic Details</h3>
          </div>
          
          <div className="topic-details-content">
            <div className="topic-info-grid">
              <div className="topic-info-item">
                <label>Full Topic Path:</label>
                <div className="topic-path-with-copy">
                  <span className="topic-path">{selectedTopic.topicPath}</span>
                  <button 
                    className="copy-topic-inline-btn"
                    onClick={copyTopicPath}
                    title="Copy topic path"
                  >
                    <i className="fas fa-copy"></i>
                  </button>
                </div>
              </div>
              
              <div className="topic-info-item">
                <label>Last Message:</label>
                <span className="timestamp">{formatTimestamp(topicDetails.timestamp)}</span>
              </div>
              
              <div className="topic-info-item">
                <label>QoS:</label>
                <span className={`qos-badge ${getQoSBadgeClass(topicDetails.qos)}`}>
                  {topicDetails.qos}
                </span>
              </div>
              
              <div className="topic-info-item">
                <label>Retained:</label>
                <span className={`retain-status ${topicDetails.retain ? 'retained' : 'not-retained'}`}>
                  {topicDetails.retain ? 'Yes' : 'No'}
                </span>
              </div>
            </div>
            
            {/* Export button moved to bottom right */}
            <div className="topic-export-section">
              <div className="topic-export-dropdown">
                <button 
                  onClick={() => setShowTopicExportMenu(!showTopicExportMenu)} 
                  className="export-topic-btn"
                  title="Export topic data"
                >
                  <i className="fas fa-download"></i> Export <i className="fas fa-chevron-down"></i>
                </button>
                {showTopicExportMenu && (
                  <div className="export-menu">
                    <button onClick={exportTopicAsJSON} className="export-menu-item">
                      <i className="fas fa-file-code"></i> Export as JSON
                    </button>
                    <button onClick={exportTopicAsCSV} className="export-menu-item">
                      <i className="fas fa-file-csv"></i> Export as CSV
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      
      <div className="message-list">
        {processedMessages.length === 0 ? (
          <div className="no-messages">
            <div className="no-messages-icon">
              <i className="fas fa-inbox"></i>
            </div>
            <h3>No messages yet</h3>
            <p>
              {!selectedTopic 
                ? "Select a topic from the topic tree to view its messages"
                : `No messages received for topic "${selectedTopic.topicPath}"`
              }
            </p>
          </div>
        ) : (
          <>
            {selectedTopic && processedMessages.length >= 300 && (
              <div className="message-limit-notice">
                <i className="fas fa-info-circle"></i> Showing up to 300 most recent messages for this topic.
              </div>
            )}
            
            {processedMessages.map(msg => (
              <div 
                key={msg.id} 
                className="message-item"
                onDoubleClick={(e) => copyPayload(msg.message, e)}
                title="Double-click to copy payload"
              >
                <div className="message-header">
                  <div className="message-meta">
                    <span className="timestamp" title={formatTimestamp(msg.timestamp)}>
                      <i className="fas fa-clock"></i> {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="topic" title={msg.topic}>
                      <i className="fas fa-tag"></i> {msg.topic}
                    </span>
                    <span className={`qos-badge ${getQoSBadgeClass(msg.qos)}`}>
                      QoS {msg.qos}
                    </span>
                    {msg.retain && (
                      <span className="retain-badge">
                        <i className="fas fa-save"></i> RETAIN
                      </span>
                    )}
                    <span className="connection-id" title={`Connection: ${msg.connectionId}`}>
                      <i className="fas fa-plug"></i> {msg.connectionId}
                    </span>
                  </div>
                  <div className="message-actions">
                    <button 
                      className="copy-payload-btn"
                      onClick={(e) => copyPayload(msg.message, e)}
                      title="Copy payload"
                    >
                      <i className="fas fa-copy"></i>
                    </button>
                  </div>
                </div>
                
                <div className="message-content">
                  <div className="payload-preview">
                    {getPayloadPreview(msg.message)}
                  </div>
                  
                  {msg.message.length > 100 && (
                    <details className="payload-full">
                      <summary>
                        <i className="fas fa-expand-alt"></i> Show full payload ({msg.message.length} chars)
                      </summary>
                      <pre className="payload-code">{msg.message}</pre>
                    </details>
                  )}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

export default MessagePanel;