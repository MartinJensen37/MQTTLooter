import React, { useState, useEffect } from 'react';
import MessageTemplateService from '../../services/MessageTemplateService';
import './PublishingPanel.css';

function PublishingPanel({ 
  connectionId,
  onPublishMessage,
  isConnected = false,
  selectedTopic = null,
  showFeedback
}) {
  const [topic, setTopic] = useState('');
  const [payload, setPayload] = useState('');
  const [qos, setQos] = useState(0);
  const [retain, setRetain] = useState(false);
  const [publishHistory, setPublishHistory] = useState([]);
  const [isPublishing, setIsPublishing] = useState(false);
  const [showQosDropdown, setShowQosDropdown] = useState(false);
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const [messageTemplates, setMessageTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateService] = useState(new MessageTemplateService());

  // Load form data from localStorage on mount
  useEffect(() => {
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

  // Load message templates
  useEffect(() => {
    setMessageTemplates(templateService.getAllTemplates());
  }, [templateService]);

  // Handle template selection
  const handleTemplateSelect = (templateId) => {
    const template = templateService.getTemplate(templateId);
    if (template) {
      const processed = templateService.processTemplate(template);
      setTopic(processed.topic);
      setPayload(processed.payload);
      setQos(processed.qos);
      setRetain(processed.retain);
      setSelectedTemplate(templateId);
      setShowTemplateDropdown(false);
    }
  };

  // Save form state to localStorage
  useEffect(() => {
    const formState = { topic, payload, qos, retain };
    localStorage.setItem('publish-form-state', JSON.stringify(formState));
  }, [topic, payload, qos, retain]);

  // Save history to localStorage
  useEffect(() => {
    if (connectionId && publishHistory.length > 0) {
      localStorage.setItem(`publish-history-${connectionId}`, JSON.stringify(publishHistory));
    }
  }, [publishHistory, connectionId]);

  // Publish message handler
  const handlePublish = async () => {
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

      // Add to history (avoid duplicates)
      setPublishHistory(prev => {
        const isDuplicate = prev.some(item => 
          item.topic === messageData.topic &&
          item.payload === messageData.payload &&
          item.qos === messageData.qos &&
          item.retain === messageData.retain
        );

        if (!isDuplicate) {
          return [messageData, ...prev.slice(0, 9)]; // Keep last 10
        }
        
        // Move existing item to top with updated timestamp
        const existingIndex = prev.findIndex(item => 
          item.topic === messageData.topic &&
          item.payload === messageData.payload &&
          item.qos === messageData.qos &&
          item.retain === messageData.retain
        );

        if (existingIndex > 0) {
          const updatedItem = { ...prev[existingIndex], timestamp: messageData.timestamp };
          return [
            updatedItem,
            ...prev.slice(0, existingIndex),
            ...prev.slice(existingIndex + 1)
          ];
        }

        if (existingIndex === 0) {
          const newHistory = [...prev];
          newHistory[0] = { ...newHistory[0], timestamp: messageData.timestamp };
          return newHistory;
        }

        return prev;
      });

      if (showFeedback) showFeedback('Message published successfully!', 'success');

    } catch (error) {
      console.error('Publish failed:', error);
      if (showFeedback) showFeedback('Failed to publish message', 'error');
    } finally {
      setIsPublishing(false);
    }
  };

  const removeRetainedMessage = async () => {

    const messageData = {
      topic: topic.trim(),
      payload: '', // Empty payload to remove retained message
      qos: 0,
      retain: true, // Must be retained to remove retained message
      timestamp: new Date().toISOString()
    };

    setIsPublishing(true);

    try {
      if (onPublishMessage) {
        await onPublishMessage(messageData);
      }

      if (showFeedback) showFeedback('Retained message removed successfully!', 'success');

    } catch (error) {
      console.error('Remove retained message failed:', error);
      if (showFeedback) showFeedback('Failed to remove retained message', 'error');
    } finally {
      setIsPublishing(false);
    }
  };

  const hasRetainedMessage = () => {
    return selectedTopic?.node?.lastMessage?.retain === true;
  };


  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showQosDropdown && !event.target.closest('.qos-select-wrapper')) {
        setShowQosDropdown(false);
      }
      if (showTemplateDropdown && !event.target.closest('.template-select-wrapper')) {
        setShowTemplateDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showQosDropdown, showTemplateDropdown]);

  // Load data from selected topic
  const loadFromSelectedTopic = () => {
    if (!selectedTopic) {
      if (showFeedback) showFeedback('No topic selected', 'error');
      return;
    }

    setTopic(selectedTopic.topicPath || selectedTopic.topic || '');
    
    const messageData = selectedTopic.node?.lastMessage;

    if (messageData) {
      setPayload(messageData.payload || '');
      setQos(messageData.qos || 0);
      setRetain(messageData.retain || false);
      if (showFeedback) showFeedback('Form filled with selected topic data', 'success');
    } else {
      setPayload('');
      setQos(0);
      setRetain(false);
      if (showFeedback) showFeedback('Topic loaded, ready for new message', 'success');
    }
  };

  // Load data from history item
  const loadFromHistory = (historyItem) => {
    setTopic(historyItem.topic);
    setPayload(historyItem.payload);
    setQos(historyItem.qos);
    setRetain(historyItem.retain);
  };

  // Clear form data
  const clearForm = () => {
    setTopic('');
    setPayload('');
    setQos(0);
    setRetain(false);
    setSelectedTemplate(null);
    localStorage.removeItem('publish-form-state');
  };

  // Clear publish history
  const clearHistory = () => {
    setPublishHistory([]);
    if (connectionId) {
      localStorage.removeItem(`publish-history-${connectionId}`);
    }
  };

  // Format JSON payload
  const formatJsonPayload = () => {
    try {
      const parsed = JSON.parse(payload);
      setPayload(JSON.stringify(parsed, null, 2));
      if (showFeedback) showFeedback('JSON formatted successfully!', 'success');
    } catch (error) {
      if (showFeedback) showFeedback('Invalid JSON format', 'error');
    }
  };

  // Check if string is valid JSON
  const isValidJson = (str) => {
    if (!str.trim()) return false;
    try {
      JSON.parse(str);
      return true;
    } catch {
      return false;
    }
  };

  // Copy text to clipboard
  const copyToClipboard = (text, feedbackMsg) => {
    navigator.clipboard.writeText(text);
    if (showFeedback) showFeedback(feedbackMsg, 'success');
  };

  // Get selected template name for display
  const getSelectedTemplateName = () => {
    if (!selectedTemplate) return 'Select a template...';
    const template = messageTemplates.find(t => t.id === selectedTemplate);
    return template ? `${template.name} (${template.category})` : 'Select a template...';
  };

  return (
    <div className="publishing-panel">
      <div className="panel-header">
        <div className="header-left">
          <h2>Message Publishing</h2>
          {!connectionId ? (
            <span className="connection-indicator disconnected">
              <i className="fas fa-times-circle"></i> No connection
            </span>
          ) : !isConnected ? (
            <span className="connection-indicator disconnected">
              <i className="fas fa-exclamation-triangle"></i> {connectionId} (Disconnected)
            </span>
          ) : (
            <span className="connection-indicator connected">
              <i className="fas fa-check-circle"></i> {connectionId} (Connected)
            </span>
          )}
        </div>
      </div>

      <div className="publishing-content">
        <div className="publish-form panel">
          <div className="panel-content">
            {/* Message Templates Section */}
            <div className="form-group">
              <label htmlFor="templates">Message Templates:</label>
              <div className="template-select-wrapper custom-select-wrapper">
                <button
                  type="button"
                  className="custom-select-button"
                  onClick={() => setShowTemplateDropdown(!showTemplateDropdown)}
                  disabled={isPublishing}
                >
                  <span className="select-value">
                    {getSelectedTemplateName()}
                  </span>
                  <i className={`fas fa-chevron-down ${showTemplateDropdown ? 'rotated' : ''}`}></i>
                </button>
                
                {showTemplateDropdown && (
                  <div className="custom-select-dropdown">
                    <button
                      type="button"
                      className={`dropdown-option ${!selectedTemplate ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedTemplate(null);
                        setShowTemplateDropdown(false);
                      }}
                    >
                      Select a template...
                    </button>
                    {messageTemplates.map(template => (
                      <button
                        key={template.id}
                        type="button"
                        className={`dropdown-option ${selectedTemplate === template.id ? 'selected' : ''}`}
                        onClick={() => handleTemplateSelect(template.id)}
                      >
                        {template.name} ({template.category})
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

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
                <div className="qos-select-wrapper custom-select-wrapper">
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
                <label htmlFor="retain" className="retain-checkbox-label">
                  <input
                    id="retain"
                    type="checkbox"
                    checked={retain}
                    onChange={(e) => setRetain(e.target.checked)}
                    disabled={isPublishing}
                  />
                  <span className="publish-checkbox-custom"></span>
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
                className="publish-form-publish-btn"
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
                    <i className="fas fa-paper-plane"></i> Publish
                  </>
                )}
              </button>

              <button 
                type="button"
                onClick={loadFromSelectedTopic}
                className="publish-form-load-topic-btn"
                disabled={isPublishing || !selectedTopic}
                title={selectedTopic ? `Load topic: ${selectedTopic.topicPath}` : 'No topic selected'}
              >
                <i className="fas fa-download"></i> Use Selected Topic
              </button>
              
              {hasRetainedMessage() && (
                <button 
                  type="button"
                  onClick={removeRetainedMessage}
                  className="publish-form-remove-retained-btn"
                  disabled={isPublishing || !topic.trim() || !connectionId || !isConnected}
                  title="Remove retained message by publishing empty payload"
                >
                  <i className="fas fa-trash-alt"></i> Remove Retained
                </button>
              )}

              <button 
                type="button"
                onClick={clearForm}
                className="publish-form-clear-btn"
                disabled={isPublishing}
              >
                <i className="fas fa-eraser"></i> Clear
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
                    <span className={`badge badge-qos-${qos}`}>
                      QoS {qos}
                    </span>
                    {retain && (
                      <span className="badge badge-retain">
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
                        <span className={`badge badge-qos-${item.qos}`}>
                          QoS {item.qos}
                        </span>
                        {item.retain && (
                          <span className="badge badge-retain">
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