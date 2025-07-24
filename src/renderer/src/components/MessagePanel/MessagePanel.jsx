import React, { useState, useEffect } from 'react';
import './MessagePanel.css';

function MessagePanel({ 
  messages, 
  selectedTopic, 
  onClearMessages,
  connectionName,
  showFeedback 
}) {
  const [sortBy, setSortBy] = useState('timestamp');
  const [sortOrder, setSortOrder] = useState('desc');
  const [showRetainedOnly, setShowRetainedOnly] = useState(false);
  const [showTopicExportMenu, setShowTopicExportMenu] = useState(false);

  // Filter and sort messages
  const processedMessages = React.useMemo(() => {
    let filtered = messages;
    
    if (showRetainedOnly) {
      filtered = filtered.filter(msg => msg.retain);
    }
    
    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === 'timestamp') {
        return sortOrder === 'desc' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp;
      }
      return 0;
    });
    
    return sorted;
  }, [messages, showRetainedOnly, sortBy, sortOrder]);

  // Get most recent message for topic details
  const topicDetails = React.useMemo(() => {
    if (!selectedTopic) return null;
    
    if (processedMessages.length === 0) {
      return {
        timestamp: null,
        qos: 0,
        retain: false,
        topic: selectedTopic.topicPath
      };
    }
    
    const mostRecentMessage = processedMessages.reduce((latest, current) => {
      return current.timestamp > latest.timestamp ? current : latest;
    }, processedMessages[0]);
    
    return mostRecentMessage;
  }, [selectedTopic, processedMessages]);

  // Close export dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showTopicExportMenu && !event.target.closest('.message-export-wrapper')) {
        setShowTopicExportMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showTopicExportMenu]);

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
    
    if (showFeedback) {
      showFeedback('Topic exported as JSON!', 'success');
    }
  };

  const exportTopicAsCSV = () => {
    if (!selectedTopic || processedMessages.length === 0) return;
    
    const headers = ['Timestamp', 'Payload', 'QoS', 'Retain', 'Connection'];
    const csvData = [
      headers.join(','),
      ...processedMessages.map(msg => [
        `"${msg.timestamp}"`,
        `"${msg.message.replace(/"/g, '""')}"`,
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
    
    if (showFeedback) {
      showFeedback('Topic exported as CSV!', 'success');
    }
  };

  const clearTopicMessages = () => {
    if (selectedTopic && onClearMessages) {
      onClearMessages(selectedTopic.topicPath);
      // Clear feedback is handled in App.jsx
    }
  };

  const copyTopicPath = () => {
    if (selectedTopic) {
      navigator.clipboard.writeText(selectedTopic.topicPath);
      if (showFeedback) {
        showFeedback('Topic path copied!', 'success');
      }
    }
  };

  const copyPayload = (payload, event) => {
    if (event) {
      event.stopPropagation();
    }
    navigator.clipboard.writeText(payload);
    if (showFeedback) {
      showFeedback('Payload copied!', 'success');
    }
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
            Message Details ({processedMessages.length})
            {selectedTopic && (
              <span className="filter-indicator">
               | {selectedTopic.topicPath}
              </span>
            )}
          </h2>
        </div>
      </div>

      {/* Topic Details Box */}
      {selectedTopic && topicDetails && (
        <div className="topic-details-box">
          <div className="topic-details-header">
            <h3>Current Message Details</h3>
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
                <span className="timestamp">
                  {topicDetails.timestamp ? formatTimestamp(topicDetails.timestamp) : 'N/A'}
                </span>
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
            
            <div className="topic-actions-section">
              <button 
                onClick={clearTopicMessages}
                className="clear-messages-btn"
                title="Clear messages for this topic"
                disabled={processedMessages.length === 0}
              >
                <i className="fas fa-trash"></i> Clear Messages
              </button>

              <div className="message-export-wrapper message-custom-select-wrapper">
                <button
                  type="button"
                  className="message-custom-select-button"
                  onClick={() => setShowTopicExportMenu(!showTopicExportMenu)}
                  disabled={processedMessages.length === 0}
                  title="Export topic data"
                >
                  <span className="select-value">
                    <i className="fas fa-download"></i> Export
                  </span>
                  <i className={`fas fa-chevron-down ${showTopicExportMenu ? 'rotated' : ''}`}></i>
                </button>
                
                {showTopicExportMenu && (
                  <div className="message-custom-select-dropdown">
                    <button
                      type="button"
                      className="message-dropdown-option"
                      onClick={exportTopicAsJSON}
                    >
                      <i className="fas fa-file-code"></i> Export as JSON
                    </button>
                    <button
                      type="button"
                      className="message-dropdown-option"
                      onClick={exportTopicAsCSV}
                    >
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
                : `No messages received for topic "${selectedTopic.topicPath}" yet`
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