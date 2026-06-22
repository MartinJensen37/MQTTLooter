import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  const [autoScroll, setAutoScroll] = useState(true);

  const listRef = useRef(null);

  const processedMessages = React.useMemo(() => {
    let filtered = showRetainedOnly ? messages.filter(m => m.retain) : messages;
    if (sortBy === 'timestamp') {
      return [...filtered].sort((a, b) =>
        sortOrder === 'desc' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp
      );
    }
    return filtered;
  }, [messages, showRetainedOnly, sortBy, sortOrder]);

  const topicDetails = React.useMemo(() => {
    if (!selectedTopic) return null;
    if (processedMessages.length === 0) return { timestamp: null, qos: 0, retain: false, topic: selectedTopic.topicPath };
    return processedMessages.reduce((latest, cur) => cur.timestamp > latest.timestamp ? cur : latest, processedMessages[0]);
  }, [selectedTopic, processedMessages]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (showTopicExportMenu && !e.target.closest('.message-export-wrapper')) {
        setShowTopicExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showTopicExportMenu]);

  const exportTopicAsJSON = useCallback(() => {
    if (!selectedTopic || processedMessages.length === 0) return;
    const data = {
      exportDate: new Date().toISOString(),
      connectionName: connectionName || 'Unknown',
      topic: selectedTopic.topicPath,
      messageCount: processedMessages.length,
      messages: processedMessages.map(m => ({
        timestamp: m.timestamp, payload: m.message, qos: m.qos, retain: m.retain, connectionId: m.connectionId
      }))
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `mqtt-topic-${selectedTopic.topicPath.replace(/[\/\\:*?"<>|]/g, '_')}-${new Date().toISOString().slice(0, 19)}.json`
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowTopicExportMenu(false);
    showFeedback?.('Topic exported as JSON!', 'success');
  }, [selectedTopic, processedMessages, connectionName, showFeedback]);

  const exportTopicAsCSV = useCallback(() => {
    if (!selectedTopic || processedMessages.length === 0) return;
    const csv = [
      ['Timestamp', 'Payload', 'QoS', 'Retain', 'Connection'].join(','),
      ...processedMessages.map(m => [
        `"${m.timestamp}"`,
        `"${m.message.replace(/"/g, '""')}"`,
        m.qos, m.retain, `"${m.connectionId}"`
      ].join(','))
    ].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `mqtt-topic-${selectedTopic.topicPath.replace(/[\/\\:*?"<>|]/g, '_')}-${new Date().toISOString().slice(0, 19)}.csv`
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowTopicExportMenu(false);
    showFeedback?.('Topic exported as CSV!', 'success');
  }, [selectedTopic, processedMessages, showFeedback]);

  const clearTopicMessages = useCallback(() => {
    if (selectedTopic && onClearMessages) onClearMessages(selectedTopic.topicPath);
  }, [selectedTopic, onClearMessages]);

  const copyTopicPath = useCallback(() => {
    if (selectedTopic) {
      navigator.clipboard.writeText(selectedTopic.topicPath);
      showFeedback?.('Topic path copied!', 'success');
    }
  }, [selectedTopic, showFeedback]);

  const copyPayload = useCallback((payload, e) => {
    e?.stopPropagation();
    navigator.clipboard.writeText(payload);
    showFeedback?.('Payload copied!', 'success');
  }, [showFeedback]);

  const formatTimestamp = (ts) => new Date(ts).toLocaleString();
  const getPayloadPreview = (payload, max = 100) =>
    payload.length <= max ? payload : payload.substring(0, max) + '...';

  return (
    <div className="message-panel">
      <div className="panel-header">
        <div className="header-left">
          <h2>
            Message Details ({processedMessages.length})
            {selectedTopic && (
              <span className="filter-indicator"> | {selectedTopic.topicPath}</span>
            )}
          </h2>
        </div>
      </div>

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
                  <button className="copy-btn" onClick={copyTopicPath} title="Copy topic path">
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
                <span className={`badge badge-qos-${topicDetails.qos}`}>QoS {topicDetails.qos}</span>
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
                className="btn btn-sm btn-danger"
                title="Clear messages for this topic"
                disabled={processedMessages.length === 0}
              >
                <i className="fas fa-trash"></i> Clear Messages
              </button>
              <button
                className={`btn btn-sm ${autoScroll ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setAutoScroll(v => !v)}
                title={autoScroll ? 'Auto-scroll ON — click to pin' : 'Auto-scroll OFF — click to follow'}
              >
                <i className={`fas ${autoScroll ? 'fa-arrow-down' : 'fa-thumbtack'}`}></i>
                {autoScroll ? ' Following' : ' Pinned'}
              </button>
              <div className="message-export-wrapper custom-select-wrapper">
                <button
                  type="button"
                  className="custom-select-button"
                  onClick={() => setShowTopicExportMenu(v => !v)}
                  disabled={processedMessages.length === 0}
                  title="Export topic data"
                >
                  <span className="select-value"><i className="fas fa-download"></i> Export</span>
                  <i className={`fas fa-chevron-down ${showTopicExportMenu ? 'rotated' : ''}`}></i>
                </button>
                {showTopicExportMenu && (
                  <div className="custom-select-dropdown">
                    <button type="button" className="dropdown-option" onClick={exportTopicAsJSON}>
                      <i className="fas fa-file-code"></i> Export as JSON
                    </button>
                    <button type="button" className="dropdown-option" onClick={exportTopicAsCSV}>
                      <i className="fas fa-file-csv"></i> Export as CSV
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="message-list" ref={listRef} style={{ overflowAnchor: autoScroll ? 'auto' : 'none' }}>
        {processedMessages.length === 0 ? (
          <div className="no-messages">
            <div className="no-messages-icon"><i className="fas fa-inbox"></i></div>
            <h3>No messages yet</h3>
            <p>
              {!selectedTopic
                ? 'Select a topic from the topic tree to view its messages'
                : `No messages received for topic "${selectedTopic.topicPath}" yet`}
            </p>
          </div>
        ) : (
          <>
            {selectedTopic && processedMessages.length >= 300 && (
              <div className="message-limit-notice">
                <i className="fas fa-info-circle"></i> Showing up to 300 most recent messages for this topic.
              </div>
            )}
            {processedMessages.map((msg) => (
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
                    <span className={`badge badge-qos-${msg.qos}`}>QoS {msg.qos}</span>
                    {msg.retain && (
                      <span className="badge badge-retain"><i className="fas fa-save"></i> RETAIN</span>
                    )}
                    <span className="connection-id" title={`Connection: ${msg.connectionId}`}>
                      <i className="fas fa-plug"></i> {msg.connectionId}
                    </span>
                  </div>
                  <div className="message-actions">
                    <button
                      className="copy-btn"
                      onClick={(e) => copyPayload(msg.message, e)}
                      title="Copy payload"
                      style={{ borderRadius: '50%', minWidth: '24px', height: '24px' }}
                    >
                      <i className="fas fa-copy"></i>
                    </button>
                  </div>
                </div>
                <div className="message-content">
                  <div className="payload-preview">{getPayloadPreview(msg.message)}</div>
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

export default React.memo(MessagePanel);
