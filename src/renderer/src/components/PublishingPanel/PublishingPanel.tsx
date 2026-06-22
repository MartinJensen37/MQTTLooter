import React, { useState, useEffect } from 'react';
import MessageTemplateService from '../../services/MessageTemplateService';
import './PublishingPanel.css';
import type { PublishHistoryItem, SchemaValidationResult } from './publishingPanel/types';
import PayloadEditor from './publishingPanel/PayloadEditor';
import TemplatesSection from './publishingPanel/TemplatesSection';
import QosRetainOptions from './publishingPanel/QosRetainOptions';
import PublishHistory from './publishingPanel/PublishHistory';
import TemplateDeleteDialog from './publishingPanel/TemplateDeleteDialog';

interface PublishingPanelProps {
  connectionId?: string | null;
  onPublishMessage?: (messageData: any) => Promise<void> | void;
  isConnected?: boolean;
  selectedTopic?: any;
  showFeedback?: (message: string, type?: string) => void;
}

function PublishingPanel({
  connectionId,
  onPublishMessage,
  isConnected = false,
  selectedTopic = null,
  showFeedback,
}: PublishingPanelProps) {
  const [topic, setTopic] = useState('');
  const [payload, setPayload] = useState('');
  const [qos, setQos] = useState(0);
  const [retain, setRetain] = useState(false);
  const [publishHistory, setPublishHistory] = useState<PublishHistoryItem[]>([]);
  const [isPublishing, setIsPublishing] = useState(false);
  const [showQosDropdown, setShowQosDropdown] = useState(false);
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const [messageTemplates, setMessageTemplates] = useState<any[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [templateService] = useState(() => new MessageTemplateService());
  const [templateToDelete, setTemplateToDelete] = useState<string | null>(null);
  const [schemaValidation, setSchemaValidation] = useState<SchemaValidationResult | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [autoLoadSelectedTopic, setAutoLoadSelectedTopic] = useState(true);
  const [retainedMessageRemoved, setRetainedMessageRemoved] = useState(false);

  // Load form data and history from localStorage on mount / connection change.
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

  useEffect(() => {
    setMessageTemplates(templateService.getAllTemplates());
  }, [templateService]);

  // Validate payload against the selected template schema.
  useEffect(() => {
    if (selectedTemplate && payload) {
      setSchemaValidation(templateService.validatePayload(selectedTemplate, payload));
    } else {
      setSchemaValidation(null);
    }
  }, [selectedTemplate, payload, templateService]);

  // Clear schema validation when templates are hidden.
  useEffect(() => {
    if (!showTemplates) {
      setSchemaValidation(null);
      setSelectedTemplate(null);
    }
  }, [showTemplates]);

  // Auto-load the selected topic into the form when enabled.
  useEffect(() => {
    if (autoLoadSelectedTopic && selectedTopic) {
      setTopic(selectedTopic.topicPath || selectedTopic.topic || '');
    }
    setRetainedMessageRemoved(false);
  }, [autoLoadSelectedTopic, selectedTopic]);

  // Reset the retained-removed flag when a retained message is detected.
  useEffect(() => {
    if (selectedTopic?.node?.lastMessage?.retain === true) {
      setRetainedMessageRemoved(false);
    }
  }, [selectedTopic?.node?.lastMessage, connectionId, isConnected]);

  const handleTemplateSelect = (templateId: string) => {
    const template = templateService.getTemplate(templateId);
    if (!template) return;

    // Only fill the topic if it's currently empty.
    if (!topic.trim()) {
      setTopic(template.topic);
    }

    // Produce an empty payload from schema, or strip the template's variables.
    let emptyPayload = '';
    if (template.schema) {
      emptyPayload = templateService.generateSampleFromSchema(template.schema);
      emptyPayload = emptyPayload
        .replace(/"sample_string"/g, '""')
        .replace(/42\.5/g, '0')
        .replace(/42/g, '0')
        .replace(/true/g, 'false');
    } else {
      emptyPayload = template.payload
        .replace(/{{[^}]+}}/g, '""')
        .replace(/:\s*""/g, ': ""')
        .replace(/:\s*"",/g, ': "",');
    }

    setPayload(emptyPayload);
    setQos(template.qos);
    setRetain(template.retain);
    setSelectedTemplate(templateId);
    setShowTemplateDropdown(false);
  };

  const handleTemplateImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const result = await templateService.importTemplates(file);
      setMessageTemplates(templateService.getAllTemplates());

      if (result.imported > 0) {
        let message = `Successfully imported ${result.imported} template(s)`;
        if (result.errors.length > 0) message += ` with ${result.errors.length} error(s)`;
        showFeedback?.(message, 'success');
      }
      if (result.errors.length > 0 && result.imported === 0) {
        showFeedback?.(`Import failed: ${result.errors[0]}`, 'error');
      }
    } catch (error: any) {
      showFeedback?.(`Import failed: ${error.message}`, 'error');
    }

    event.target.value = '';
  };

  const handleTemplateExport = () => {
    try {
      const exportData = templateService.exportTemplates();
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mqtt-templates-${new Date().toISOString().slice(0, 19)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showFeedback?.('Templates exported successfully!', 'success');
    } catch (error: any) {
      showFeedback?.(`Export failed: ${error.message}`, 'error');
    }
  };

  const handleTemplateDelete = (templateId: string) => {
    setTemplateToDelete(templateId);
  };

  const confirmTemplateDelete = () => {
    if (templateToDelete) {
      const template = templateService.getTemplate(templateToDelete);
      const success = templateService.deleteTemplate(templateToDelete);

      if (success) {
        setMessageTemplates(templateService.getAllTemplates());
        if (selectedTemplate === templateToDelete) {
          setSelectedTemplate(null);
          setSchemaValidation(null);
        }
        showFeedback?.(`Template "${template?.name}" deleted successfully!`, 'success');
      } else {
        showFeedback?.('Failed to delete template', 'error');
      }
    }
    setTemplateToDelete(null);
  };

  const cancelTemplateDelete = () => setTemplateToDelete(null);

  // Persist form state.
  useEffect(() => {
    localStorage.setItem('publish-form-state', JSON.stringify({ topic, payload, qos, retain }));
  }, [topic, payload, qos, retain]);

  // Persist publish history per connection.
  useEffect(() => {
    if (connectionId && publishHistory.length > 0) {
      localStorage.setItem(`publish-history-${connectionId}`, JSON.stringify(publishHistory));
    }
  }, [publishHistory, connectionId]);

  const handlePublish = async () => {
    const messageData: PublishHistoryItem = {
      topic: topic.trim(),
      payload,
      qos,
      retain,
      timestamp: new Date().toISOString(),
    };

    setIsPublishing(true);
    try {
      if (onPublishMessage) await onPublishMessage(messageData);

      // Add to history, de-duplicating by topic/payload/qos/retain.
      setPublishHistory((prev) => {
        const matches = (item: PublishHistoryItem) =>
          item.topic === messageData.topic &&
          item.payload === messageData.payload &&
          item.qos === messageData.qos &&
          item.retain === messageData.retain;

        const isDuplicate = prev.some(matches);
        if (!isDuplicate) return [messageData, ...prev.slice(0, 9)]; // keep last 10

        const existingIndex = prev.findIndex(matches);
        if (existingIndex > 0) {
          const updatedItem = { ...prev[existingIndex], timestamp: messageData.timestamp };
          return [updatedItem, ...prev.slice(0, existingIndex), ...prev.slice(existingIndex + 1)];
        }
        if (existingIndex === 0) {
          const newHistory = [...prev];
          newHistory[0] = { ...newHistory[0], timestamp: messageData.timestamp };
          return newHistory;
        }
        return prev;
      });

      showFeedback?.('Message published successfully!', 'success');
    } catch (error) {
      console.error('Publish failed:', error);
      showFeedback?.('Failed to publish message', 'error');
    } finally {
      setIsPublishing(false);
    }
  };

  const removeRetainedMessage = async () => {
    const targetTopic = selectedTopic?.topicPath || selectedTopic?.topic || topic.trim();
    if (!targetTopic) {
      showFeedback?.('No topic specified for retained message removal', 'error');
      return;
    }

    const messageData = {
      topic: targetTopic,
      payload: '', // empty + retain removes the retained message
      qos: 0,
      retain: true,
      timestamp: new Date().toISOString(),
    };

    setIsPublishing(true);
    try {
      if (onPublishMessage) await onPublishMessage(messageData);
      setRetainedMessageRemoved(true);
      showFeedback?.('Retained message removed succesfully!', 'success');
    } catch (error) {
      console.error('Remove retained message failed:', error);
      showFeedback?.('Failed to remove retained message', 'error');
    } finally {
      setIsPublishing(false);
    }
  };

  const hasRetainedMessage = () =>
    selectedTopic?.node?.lastMessage?.retain === true && !retainedMessageRemoved;

  // Close dropdowns on outside click.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (showQosDropdown && !target.closest('.qos-select-wrapper')) {
        setShowQosDropdown(false);
      }
      if (showTemplateDropdown && !target.closest('.template-select-wrapper')) {
        setShowTemplateDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showQosDropdown, showTemplateDropdown]);

  const loadFromSelectedTopic = () => {
    if (!selectedTopic) {
      showFeedback?.('No topic selected', 'error');
      return;
    }

    setTopic(selectedTopic.topicPath || selectedTopic.topic || '');
    const messageData = selectedTopic.node?.lastMessage;

    if (messageData) {
      setPayload(messageData.payload || '');
      setQos(messageData.qos || 0);
      setRetain(messageData.retain || false);
      showFeedback?.('Form filled with selected topic data', 'success');
    } else {
      setPayload('');
      setQos(0);
      setRetain(false);
      showFeedback?.('Topic loaded, ready for new message', 'success');
    }
  };

  const loadFromHistory = (historyItem: PublishHistoryItem) => {
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
    setSelectedTemplate(null);
    localStorage.removeItem('publish-form-state');
  };

  const clearHistory = () => {
    setPublishHistory([]);
    if (connectionId) localStorage.removeItem(`publish-history-${connectionId}`);
  };

  const formatJsonPayload = () => {
    try {
      const parsed = JSON.parse(payload);
      setPayload(JSON.stringify(parsed, null, 2));
      showFeedback?.('JSON formatted successfully!', 'success');
    } catch {
      showFeedback?.('Invalid JSON format', 'error');
    }
  };

  const isValidJson = (str: string) => {
    if (!str.trim()) return false;
    try {
      JSON.parse(str);
      return true;
    } catch {
      return false;
    }
  };

  const copyToClipboard = (text: string, feedbackMsg: string) => {
    navigator.clipboard.writeText(text);
    showFeedback?.(feedbackMsg, 'success');
  };

  const getSelectedTemplateName = () => {
    if (!selectedTemplate) return 'Select a template...';
    const template = messageTemplates.find((t) => t.id === selectedTemplate);
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
            <div className="form-group">
              <div className="topic-label-wrapper">
                <label htmlFor="topic">Topic:</label>
                <div className="auto-load-toggle">
                  <label className="toggle-switch">
                    <span className="toggle-label">Auto-load selected topic</span>
                    <input
                      type="checkbox"
                      checked={autoLoadSelectedTopic}
                      onChange={(e) => setAutoLoadSelectedTopic(e.target.checked)}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
              </div>
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

            <PayloadEditor
              payload={payload}
              setPayload={setPayload}
              isPublishing={isPublishing}
              isValidJson={isValidJson}
              formatJsonPayload={formatJsonPayload}
              copyToClipboard={copyToClipboard}
              schemaValidation={schemaValidation}
            />

            <TemplatesSection
              showTemplates={showTemplates}
              setShowTemplates={setShowTemplates}
              handleTemplateImport={handleTemplateImport}
              handleTemplateExport={handleTemplateExport}
              messageTemplates={messageTemplates}
              showTemplateDropdown={showTemplateDropdown}
              setShowTemplateDropdown={setShowTemplateDropdown}
              isPublishing={isPublishing}
              getSelectedTemplateName={getSelectedTemplateName}
              selectedTemplate={selectedTemplate}
              setSelectedTemplate={setSelectedTemplate}
              setSchemaValidation={setSchemaValidation}
              handleTemplateSelect={handleTemplateSelect}
              handleTemplateDelete={handleTemplateDelete}
            />

            <QosRetainOptions
              qos={qos}
              setQos={setQos}
              retain={retain}
              setRetain={setRetain}
              isPublishing={isPublishing}
              showQosDropdown={showQosDropdown}
              setShowQosDropdown={setShowQosDropdown}
            />

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
                  disabled={
                    isPublishing ||
                    (!selectedTopic?.topicPath && !selectedTopic?.topic && !topic.trim()) ||
                    !connectionId ||
                    !isConnected
                  }
                  title={`Remove retained message from: ${
                    selectedTopic?.topicPath || selectedTopic?.topic || topic.trim() || 'No topic'
                  }`}
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

            {/* Message preview */}
            {topic && payload && (
              <div className="message-preview">
                <h4>Message Preview</h4>
                <div className="preview-content">
                  <div className="preview-meta">
                    <span className="preview-topic">
                      <i className="fas fa-tag"></i> {topic}
                    </span>
                    <span className={`badge badge-qos-${qos}`}>QoS {qos}</span>
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
          <PublishHistory
            publishHistory={publishHistory}
            clearHistory={clearHistory}
            loadFromHistory={loadFromHistory}
          />
        )}
      </div>

      {templateToDelete && (
        <TemplateDeleteDialog
          templateToDelete={templateToDelete}
          templateService={templateService}
          cancelTemplateDelete={cancelTemplateDelete}
          confirmTemplateDelete={confirmTemplateDelete}
        />
      )}
    </div>
  );
}

export default PublishingPanel;
