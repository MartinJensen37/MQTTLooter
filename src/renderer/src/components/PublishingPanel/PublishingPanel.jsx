import React, { useState, useEffect } from 'react';
import './PublishingPanel.css';

function PublishingPanel({ 
  connectionId,
  onPublishMessage,
  isConnected = false,
  selectedTopic = null
}) {
  const [topic, setTopic] = useState('');
  const [payload, setPayload] = useState('');
  const [qos, setQos] = useState(0);
  const [retain, setRetain] = useState(false);
  const [publishHistory, setPublishHistory] = useState([]);
  const [isPublishing, setIsPublishing] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState('');
  const [showQosDropdown, setShowQosDropdown] = useState(false);

  // Load form data from localStorage on mount
  useEffect(() => {
    // Load form state
    const savedFormState = localStorage.getItem('publish-form-state');
    if (savedFormState) {
      try {
        const formState = JSON.parse(savedFormState);
        setTopic(formState.topic || '');
        setPayload(formState.payload || '');
        setQos(formState.qos || 0);
        setRetain(formState.retain || false);
      } catch (error) {
        console.error('Failed to load form state:', error);
      }
    }

    // Load history for specific connection
    if (connectionId) {
      const savedHistory = localStorage.getItem(`publish-history-${connectionId}`);
      if (savedHistory) {
        try {
          setPublishHistory(JSON.parse(savedHistory));
        } catch (error) {
          console.error('Failed to load publish history:', error);
        }
      }
    }
  }, [connectionId]);

  // Save form state whenever form values change
  useEffect(() => {
    const formState = {
      topic,
      payload,
      qos,
      retain
    };
    localStorage.setItem('publish-form-state', JSON.stringify(formState));
  }, [topic, payload, qos, retain]);

  // Save history to localStorage
  useEffect(() => {
    if (connectionId && publishHistory.length > 0) {
      localStorage.setItem(`publish-history-${connectionId}`, JSON.stringify(publishHistory));
    }
  }, [publishHistory, connectionId]);

  const handlePublish = async () => {
    if (!topic.trim()) {
      showCopyFeedback('Please enter a topic', 'error');
      return;
    }

    if (!connectionId) {
      showCopyFeedback('No connection selected', 'error');
      return;
    }

    if (!isConnected) {
      showCopyFeedback('Connect to client before sending', 'error');
      return;
    }

    const messageData = {
      topic: topic.trim(),
      payload,
      qos,
      retain,
      timestamp: new Date().toISOString()
    };

    setIsPublishing(true);

    try {
      if (onPublishMessage) {
        await onPublishMessage(messageData);
      }

      // Add to history on successful publish
      setPublishHistory(prev => {
        const newHistory = [messageData, ...prev.slice(0, 9)]; // Keep last 10
        return newHistory;
      });

      // Show success feedback
      showCopyFeedback('Message published successfully!', 'success');

      // DON'T clear form - keep fields filled for easy republishing
    } catch (error) {
      console.error('Publish failed:', error);
      showCopyFeedback('Failed to publish message', 'error');
    } finally {
      setIsPublishing(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showQosDropdown && !event.target.closest('.custom-select-wrapper')) {
        setShowQosDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showQosDropdown]);


  const loadFromSelectedTopic = () => {
    if (!selectedTopic) {
      showCopyFeedback('No topic selected', 'error');
      return;
    }

    // Set the topic path
    setTopic(selectedTopic.topicPath || selectedTopic.topic || '');
    
    // Get message data from the known structure
    const messageData = selectedTopic.node?.lastMessage;

    if (messageData) {
      setPayload(messageData.payload || '');
      setQos(messageData.qos || 0);
      setRetain(messageData.retain || false);
      showCopyFeedback('Form filled with selected topic data', 'success');
    } else {
      // Just set the topic, clear other fields
      setPayload('');
      setQos(0);
      setRetain(false);
      showCopyFeedback('Topic loaded, ready for new message', 'success');
    }
  };

  const loadFromHistory = (historyItem) => {
    setTopic(historyItem.topic);
    setPayload(historyItem.payload);
    setQos(historyItem.qos);
    setRetain(historyItem.retain);
  };

  const clearForm = () => {
    setTopic('');
    setPayload('');
    setQos(0);
    setRetain(false);
    // Also clear from localStorage
    localStorage.removeItem('publish-form-state');
  };

  const clearHistory = () => {
    setPublishHistory([]);
    if (connectionId) {
      localStorage.removeItem(`publish-history-${connectionId}`);
    }
  };

  const showCopyFeedback = (message, type = 'success') => {
    setCopyFeedback({ message, type });
    setTimeout(() => setCopyFeedback(''), 3000);
  };

  const formatJsonPayload = () => {
    try {
      const parsed = JSON.parse(payload);
      setPayload(JSON.stringify(parsed, null, 2));
      showCopyFeedback('JSON formatted successfully!', 'success');
    } catch (error) {
      showCopyFeedback('Invalid JSON format', 'error');
    }
  };

  const isValidJson = (str) => {
    if (!str.trim()) return false;
    try {
      JSON.parse(str);
      return true;
    } catch {
      return false;
    }
  };

  const copyToClipboard = (text, feedbackMsg) => {
    navigator.clipboard.writeText(text);
    showCopyFeedback(feedbackMsg, 'success');
  };

  const getQoSBadgeClass = (qos) => {
    switch (qos) {
      case 0: return 'qos-0';
      case 1: return 'qos-1';
      case 2: return 'qos-2';
      default: return 'qos-unknown';
    }
  };

  const getConnectionStatusIndicator = () => {
    if (!connectionId) {
      return (
        <span className="connection-indicator disconnected">
          <i className="fas fa-times-circle"></i> No connection
        </span>
      );
    }
    
    if (!isConnected) {
      return (
        <span className="connection-indicator disconnected">
          <i className="fas fa-exclamation-triangle"></i> {connectionId} (Disconnected)
        </span>
      );
    }
    
    return (
      <span className="connection-indicator connected">
        <i className="fas fa-check-circle"></i> {connectionId} (Connected)
      </span>
    );
  };

  return (
    <div className="publishing-panel">
      {/* Feedback Toast */}
      {copyFeedback && (
        <div className={`publish-feedback ${copyFeedback.type === 'error' ? 'error' : 'success'}`}>
          <i className={`fas ${copyFeedback.type === 'error' ? 'fa-exclamation-circle' : 'fa-check-circle'}`}></i> 
          {copyFeedback.message}
        </div>
      )}

      <div className="publishing-panel-header">
        <div className="header-left">
          <h2>Message Publishing</h2>
          {getConnectionStatusIndicator()}
        </div>
      </div>

      <div className="publishing-content">
        <div className="publish-form">
          <div className="form-group">
            <label htmlFor="topic">Topic:</label>
            <div className="topic-input-wrapper">
              <input
                id="topic"
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Enter MQTT topic (e.g., sensors/temperature)"
                className="topic-input"
                disabled={isPublishing}
              />
              {topic && (
                <button 
                  className="copy-topic-btn"
                  onClick={() => copyToClipboard(topic, 'Topic copied!')}
                  title="Copy topic"
                  type="button"
                >
                  <i className="fas fa-copy"></i>
                </button>
              )}
            </div>
          </div>

          <div className="form-group">
            <div className="payload-header">
              <label htmlFor="payload">Payload:</label>
              <div className="payload-tools">
                {payload && isValidJson(payload) && (
                  <button 
                    type="button"
                    onClick={formatJsonPayload}
                    className="format-json-btn"
                    title="Format JSON"
                    disabled={isPublishing}
                  >
                    <i className="fas fa-code"></i> Format JSON
                  </button>
                )}
                {payload && (
                  <button 
                    type="button"
                    onClick={() => copyToClipboard(payload, 'Payload copied!')}
                    className="copy-payload-btn"
                    title="Copy payload"
                  >
                    <i className="fas fa-copy"></i>
                  </button>
                )}
              </div>
            </div>
            <textarea
              id="payload"
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              placeholder="Enter message payload (JSON, text, etc.)"
              className="payload-input"
              rows={6}
              disabled={isPublishing}
            />
            <div className="payload-info">
              <span className="char-count">{payload.length} characters</span>
              {payload && isValidJson(payload) && (
                <span className="json-indicator">
                  <i className="fas fa-check-circle"></i> Valid JSON
                </span>
              )}
            </div>
          </div>

          <div className="form-options">
            <div className="form-group">
              <label htmlFor="qos">Quality of Service:</label>
              <div className="custom-select-wrapper">
                <button
                  type="button"
                  className="custom-select-button"
                  onClick={() => setShowQosDropdown(!showQosDropdown)}
                  disabled={isPublishing}
                >
                  <span className="select-value">
                    QoS {qos} - {qos === 0 ? 'At most once' : 
                               qos === 1 ? 'At least once' : 
                               'Exactly once'}
                  </span>
                  <i className={`fas fa-chevron-down ${showQosDropdown ? 'rotated' : ''}`}></i>
                </button>
                
                {showQosDropdown && (
                  <div className="custom-select-dropdown">
                    <button
                      type="button"
                      className={`dropdown-option ${qos === 0 ? 'selected' : ''}`}
                      onClick={() => {
                        setQos(0);
                        setShowQosDropdown(false);
                      }}
                    >
                      QoS 0 - At most once
                    </button>
                    <button
                      type="button"
                      className={`dropdown-option ${qos === 1 ? 'selected' : ''}`}
                      onClick={() => {
                        setQos(1);
                        setShowQosDropdown(false);
                      }}
                    >
                      QoS 1 - At least once
                    </button>
                    <button
                      type="button"
                      className={`dropdown-option ${qos === 2 ? 'selected' : ''}`}
                      onClick={() => {
                        setQos(2);
                        setShowQosDropdown(false);
                      }}
                    >
                      QoS 2 - Exactly once
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="form-group retain-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={retain}
                  onChange={(e) => setRetain(e.target.checked)}
                  disabled={isPublishing}
                />
                <span className="checkbox-custom"></span>
                Retain message
                <span className="retain-info" title="Retained messages are stored by the broker and sent to new subscribers">
                  <i className="fas fa-info-circle"></i>
                </span>
              </label>
            </div>
          </div>

          <div className="form-actions">
            <button 
              onClick={handlePublish} 
              className="publish-btn"
              disabled={!topic.trim() || isPublishing || !connectionId || !isConnected}
            >
              {isPublishing ? (
                <>
                  <i className="fas fa-spinner fa-spin"></i> Publishing...
                </>
              ) : !isConnected ? (
                <>
                  <i className="fas fa-times-circle"></i> Not Connected
                </>
              ) : (
                <>
                  <i className="fas fa-paper-plane"></i> Publish Message
                </>
              )}
            </button>

            <button 
              type="button"
              onClick={loadFromSelectedTopic}
              className="load-topic-btn"
              disabled={isPublishing || !selectedTopic}
              title={selectedTopic ? `Load topic: ${selectedTopic.topicPath}` : 'No topic selected'}
            >
              <i className="fas fa-download"></i> Use Selected Topic
            </button>
            


            <button 
              type="button"
              onClick={clearForm}
              className="clear-btn"
              disabled={isPublishing}
            >
              <i className="fas fa-eraser"></i> Clear Form
            </button>
          </div>

          {/* Message Preview */}
          {topic && payload && (
            <div className="message-preview">
              <h4>Message Preview</h4>
              <div className="preview-content">
                <div className="preview-meta">
                  <span className="preview-topic">
                    <i className="fas fa-tag"></i> {topic}
                  </span>
                  <span className={`qos-badge ${getQoSBadgeClass(qos)}`}>
                    QoS {qos}
                  </span>
                  {retain && (
                    <span className="retain-badge">
                      <i className="fas fa-save"></i> RETAIN
                    </span>
                  )}
                </div>
                <div className="preview-payload">
                  {payload.length > 200 ? payload.substring(0, 200) + '...' : payload}
                </div>
              </div>
            </div>
          )}
        </div>

        {publishHistory.length > 0 && (
          <div className="publish-history">
            <div className="history-header">
              <h3>Publication History</h3>
              <button 
                onClick={clearHistory}
                className="clear-history-btn"
                title="Clear history"
              >
                <i className="fas fa-trash"></i>
              </button>
            </div>
            <div className="history-list">
              {publishHistory.map((item, index) => (
                <div key={index} className="history-item">
                  <div className="history-item-header">
                    <div className="history-meta">
                      <span className="history-topic">
                        <i className="fas fa-tag"></i> {item.topic}
                      </span>
                      <div className="history-badges">
                        <span className={`qos-badge ${getQoSBadgeClass(item.qos)}`}>
                          QoS {item.qos}
                        </span>
                        {item.retain && (
                          <span className="retain-badge">
                            <i className="fas fa-save"></i> R
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="history-actions">
                      <span className="history-time">
                        <i className="fas fa-clock"></i> {new Date(item.timestamp).toLocaleTimeString()}
                      </span>
                      <button 
                        onClick={() => loadFromHistory(item)}
                        className="load-btn"
                        title="Load into form"
                      >
                        <i className="fas fa-redo"></i>
                      </button>
                    </div>
                  </div>
                  <div className="history-payload">
                    {item.payload.length > 100 
                      ? item.payload.substring(0, 100) + '...' 
                      : item.payload}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default PublishingPanel;