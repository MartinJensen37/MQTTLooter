import React, { useState, useEffect, useMemo, useRef } from 'react';
import MessageTemplateService from '../../services/MessageTemplateService';
import './PublishingPanel.css';
import { payloadBytes, type PayloadEncoding } from '../../../../shared/payload';
import TopicTreeService from '../../services/TopicTreeService';
import { useSettings } from '../../services/Settings';
import type { PublishHistoryItem, SchemaValidationResult } from './publishingPanel/types';
import PayloadEditor from './publishingPanel/PayloadEditor';
import PublishPropertiesEditor from './publishingPanel/PublishPropertiesEditor';
import {
  buildPublishProperties,
  draftFromProperties,
  emptyPropertyDraft,
  readPropertyDraft,
} from './publishingPanel/propertyDraft';
import TemplatesSection from './publishingPanel/TemplatesSection';
import TemplateVariables from './publishingPanel/TemplateVariables';
import { templateDefaults } from '../../../../shared/template-expansion';
import QosRetainOptions from './publishingPanel/QosRetainOptions';
import PublishHistory from './publishingPanel/PublishHistory';
import TemplateDeleteDialog from './publishingPanel/TemplateDeleteDialog';

interface PublishingPanelProps {
  connectionId?: string | null;
  protocolVersion?: number;
  onPublishMessage?: (messageData: any) => Promise<void> | void;
  isConnected?: boolean;
  selectedTopic?: any;
  showFeedback?: (message: string, type?: string) => void;
}

function PublishingPanel({
  connectionId,
  protocolVersion = 4,
  onPublishMessage,
  isConnected = false,
  selectedTopic = null,
  showFeedback,
}: PublishingPanelProps) {
  const settings = useSettings();
  const formKey = `publish-form-state-${connectionId}`;
  const [initialForm] = useState(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(formKey) || localStorage.getItem('publish-form-state') || '{}',
      );
      return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    } catch {
      return {};
    }
  });
  const [propertyDraft, setPropertyDraft] = useState(() =>
    readPropertyDraft(initialForm.propertyDraft),
  );
  const [topic, setTopic] = useState<string>(initialForm.topic || '');
  const [payload, setPayload] = useState<string>(initialForm.payload || '');
  const [encoding, setEncoding] = useState<PayloadEncoding>(initialForm.encoding ?? 'utf8');
  const [qos, setQos] = useState<number>(initialForm.qos || 0);
  const [retain, setRetain] = useState<boolean>(initialForm.retain || false);
  const [publishHistory, setPublishHistory] = useState<PublishHistoryItem[]>(() => {
    try {
      const history = JSON.parse(localStorage.getItem(`publish-history-${connectionId}`) || '[]');
      return Array.isArray(history)
        ? history
            .filter(
              (item) => item && typeof item.topic === 'string' && typeof item.payload === 'string',
            )
            .slice(0, 10)
        : [];
    } catch {
      return [];
    }
  });
  const [isPublishing, setIsPublishing] = useState(false);
  const [showQosDropdown, setShowQosDropdown] = useState(false);
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const [messageTemplates, setMessageTemplates] = useState<any[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [templateVariables, setTemplateVariables] = useState<Record<string, string>>({});
  const [templateError, setTemplateError] = useState('');
  const generatedTopic = useRef<string | null>(null);
  const [templateService] = useState(() => new MessageTemplateService());
  const [templateToDelete, setTemplateToDelete] = useState<string | null>(null);
  const [schemaValidation, setSchemaValidation] = useState<SchemaValidationResult | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [autoLoadSelectedTopic, setAutoLoadSelectedTopic] = useState(true);
  const [retainedMessageRemoved, setRetainedMessageRemoved] = useState(false);
  const selectedPath = selectedTopic?.topicPath ?? selectedTopic?.topic ?? null;
  const selectedRetain = selectedTopic?.node?.lastMessage?.retain === true;
  const selectedMessageId = selectedTopic?.node?.lastMessageId;
  const propertyValidation = useMemo(() => {
    if (!propertyDraft.enabled) return {};
    try {
      return {
        properties: buildPublishProperties(
          propertyDraft,
          protocolVersion,
          payloadBytes(payload, encoding),
        ),
      };
    } catch (error) {
      return { error: (error as Error).message };
    }
  }, [propertyDraft, protocolVersion, payload, encoding]);

  useEffect(() => {
    setMessageTemplates(templateService.getAllTemplates());
  }, [templateService]);

  // Validate payload against the selected template schema.
  useEffect(() => {
    if (selectedTemplate && payload && encoding === 'utf8') {
      setSchemaValidation(templateService.validatePayload(selectedTemplate, payload));
    } else {
      setSchemaValidation(null);
    }
  }, [selectedTemplate, payload, encoding, templateService]);

  // Clear schema validation when templates are hidden.
  useEffect(() => {
    if (!showTemplates) {
      setSchemaValidation(null);
      setSelectedTemplate(null);
    }
  }, [showTemplates]);

  // Auto-load the selected topic into the form when enabled.
  useEffect(() => {
    if (autoLoadSelectedTopic && selectedPath !== null) {
      generatedTopic.current = null;
      setTopic(selectedPath);
    }
    setRetainedMessageRemoved(false);
  }, [autoLoadSelectedTopic, selectedPath]);

  // Reset the retained-removed flag when a retained message is detected.
  useEffect(() => {
    if (selectedRetain) {
      setRetainedMessageRemoved(false);
    }
  }, [selectedMessageId, selectedRetain, connectionId, isConnected]);

  const applyTemplate = (templateId: string, variables: Record<string, string>) => {
    const template = templateService.getTemplate(templateId);
    if (!template) return;
    try {
      const processed = templateService.processTemplate(template, variables);
      const properties = draftFromProperties(processed.properties);
      if (!topic.trim() || topic === generatedTopic.current) {
        setTopic(processed.topic);
        generatedTopic.current = processed.topic;
      }
      setPayload(processed.payload);
      setEncoding('utf8');
      setQos(processed.qos ?? 0);
      setRetain(processed.retain ?? false);
      setPropertyDraft(properties);
      setTemplateError('');
    } catch (error) {
      setTemplateError((error as Error).message);
    }
  };

  const handleTemplateSelect = (templateId: string) => {
    const template = templateService.getTemplate(templateId);
    if (!template) return;
    setSelectedTemplate(templateId);
    setShowTemplateDropdown(false);
    try {
      const defaults = templateDefaults(template.variables);
      setTemplateVariables(defaults);
      applyTemplate(templateId, defaults);
    } catch (error) {
      setTemplateVariables({});
      setTemplateError((error as Error).message);
    }
  };

  const handleTemplateImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const result = await templateService.importTemplates(file);
      setMessageTemplates(templateService.getAllTemplates());

      if (result.imported > 0) {
        let message = `Imported ${result.imported} message schema${result.imported === 1 ? '' : 's'}`;
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
      a.download = `mqtt-message-schemas-${new Date().toISOString().slice(0, 19)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showFeedback?.('Message schemas exported', 'success');
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
        showFeedback?.(`Deleted "${template?.name}"`, 'success');
      } else {
        showFeedback?.('The message schema could not be deleted', 'error');
      }
    }
    setTemplateToDelete(null);
  };

  const cancelTemplateDelete = () => setTemplateToDelete(null);

  // Persist form state.
  useEffect(() => {
    try {
      localStorage.setItem(
        formKey,
        JSON.stringify({ topic, payload, encoding, qos, retain, propertyDraft }),
      );
    } catch {
      showFeedback?.('Publishing draft could not be saved locally.', 'error');
    }
  }, [formKey, topic, payload, encoding, qos, retain, propertyDraft, showFeedback]);

  // Persist publish history per connection.
  useEffect(() => {
    if (!connectionId) return;
    try {
      localStorage.setItem(`publish-history-${connectionId}`, JSON.stringify(publishHistory));
    } catch {
      showFeedback?.('Publish history could not be saved locally.', 'error');
    }
  }, [publishHistory, connectionId, showFeedback]);

  const handlePublish = async () => {
    if (selectedTemplate && templateError) {
      showFeedback?.(templateError, 'error');
      return;
    }
    if (propertyValidation.error) {
      showFeedback?.(propertyValidation.error, 'error');
      return;
    }
    const messageData: PublishHistoryItem = {
      topic,
      payload,
      encoding,
      qos,
      retain,
      timestamp: new Date().toISOString(),
      properties: propertyValidation.properties,
    };

    setIsPublishing(true);
    try {
      payloadBytes(messageData.payload, messageData.encoding);
      if (!onPublishMessage || !isConnected) throw new Error('Not connected');
      await onPublishMessage(messageData);

      // Keep distinct property sets when de-duplicating successful publications.
      setPublishHistory((prev) => {
        const matches = (item: PublishHistoryItem) =>
          item.topic === messageData.topic &&
          item.payload === messageData.payload &&
          (item.encoding ?? 'utf8') === messageData.encoding &&
          item.qos === messageData.qos &&
          item.retain === messageData.retain &&
          JSON.stringify(item.properties ?? {}) === JSON.stringify(messageData.properties ?? {});

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
      showFeedback?.(`Failed to publish message: ${(error as Error).message}`, 'error');
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
      if (!onPublishMessage || !isConnected) throw new Error('Not connected');
      await onPublishMessage(messageData);
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

    setPropertyDraft(emptyPropertyDraft());
    generatedTopic.current = null;
    setSelectedTemplate(null);
    setTopic(selectedTopic.topicPath || selectedTopic.topic || '');
    const messageData = connectionId
      ? TopicTreeService.getTopicMessages(connectionId, selectedTopic.topicPath)[0]
      : undefined;

    if (messageData) {
      setPayload(messageData.message);
      setEncoding(messageData.encoding);
      setQos(messageData.qos || 0);
      setRetain(messageData.retain || false);
      showFeedback?.('Form filled with selected topic data', 'success');
    } else {
      setPayload('');
      setEncoding('utf8');
      setQos(0);
      setRetain(false);
      showFeedback?.('Topic loaded, ready for new message', 'success');
    }
  };

  const loadFromHistory = (historyItem: PublishHistoryItem) => {
    try {
      setPropertyDraft(draftFromProperties(historyItem.properties));
    } catch (error) {
      showFeedback?.(`Cannot load saved properties: ${(error as Error).message}`, 'error');
      return;
    }
    generatedTopic.current = null;
    setSelectedTemplate(null);
    setTopic(historyItem.topic);
    setPayload(historyItem.payload);
    setEncoding(historyItem.encoding ?? 'utf8');
    setQos(historyItem.qos);
    setRetain(historyItem.retain);
  };

  const clearForm = () => {
    generatedTopic.current = null;
    setPropertyDraft(emptyPropertyDraft());
    setTopic('');
    setPayload('');
    setEncoding('utf8');
    setQos(0);
    setRetain(false);
    setSelectedTemplate(null);
    localStorage.removeItem(formKey);
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
    if (!selectedTemplate) return 'Choose a message schema';
    const template = messageTemplates.find((t) => t.id === selectedTemplate);
    return template ? template.name : 'Choose a message schema';
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
              <i className="fas fa-exclamation-triangle"></i> Disconnected
            </span>
          ) : (
            <span className="connection-indicator connected">
              <i className="fas fa-check-circle"></i> Connected
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
                  onChange={(e) => {
                    generatedTopic.current = null;
                    setTopic(e.target.value);
                  }}
                  placeholder="Topic, e.g. sensors/room1/temperature"
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

            {(settings.payloadEncoding || encoding !== 'utf8') && (
              <div className="form-group">
                <label htmlFor="publish-encoding">Payload encoding</label>
                <select
                  className="custom-select-button form-select"
                  id="publish-encoding"
                  value={encoding}
                  disabled={isPublishing}
                  onChange={(e) => setEncoding(e.target.value as PayloadEncoding)}
                >
                  <option value="utf8">UTF-8 text</option>
                  <option value="base64">Base64 bytes</option>
                </select>
              </div>
            )}
            <PayloadEditor
              payload={payload}
              setPayload={setPayload}
              isPublishing={isPublishing}
              isValidJson={(text) => encoding === 'utf8' && isValidJson(text)}
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

            {showTemplates && selectedTemplate && (
              <TemplateVariables
                definitions={templateService.getTemplate(selectedTemplate)?.variables ?? {}}
                values={templateVariables}
                onChange={(name, value) =>
                  setTemplateVariables((previous) => ({ ...previous, [name]: value }))
                }
                onApply={() => applyTemplate(selectedTemplate, templateVariables)}
                error={templateError}
                disabled={isPublishing}
              />
            )}

            <QosRetainOptions
              qos={qos}
              setQos={setQos}
              retain={retain}
              setRetain={setRetain}
              isPublishing={isPublishing}
              showQosDropdown={showQosDropdown}
              setShowQosDropdown={setShowQosDropdown}
            />

            <PublishPropertiesEditor
              draft={propertyDraft}
              onChange={setPropertyDraft}
              protocolVersion={protocolVersion}
              disabled={isPublishing}
              error={propertyValidation.error}
            />

            <div className="form-actions">
              <button
                onClick={handlePublish}
                className="publish-form-publish-btn"
                disabled={
                  !!(selectedTemplate && templateError) ||
                  !topic.trim() ||
                  isPublishing ||
                  !connectionId ||
                  !isConnected ||
                  !!propertyValidation.error
                }
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
                title={
                  selectedTopic ? `Load topic: ${selectedTopic.topicPath}` : 'No topic selected'
                }
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
