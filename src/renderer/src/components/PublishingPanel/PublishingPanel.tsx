import { useState, useEffect, useMemo, useRef } from 'react';
import './PublishingPanel.css';
import { payloadBytes, type PayloadEncoding } from '../../../../shared/payload';
import TopicTreeService from '../../services/TopicTreeService';
import { useSettings } from '../../services/Settings';
import type { PublishHistoryItem } from './publishingPanel/types';
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
import SparkplugCommand from './publishingPanel/SparkplugCommand';
import { usePublishHistory } from './publishingPanel/usePublishHistory';
import { useMessageSchemas } from './publishingPanel/useMessageSchemas';

interface PublishingPanelProps {
  connectionId?: string | null;
  protocolVersion?: number;
  onPublishMessage?: (messageData: any) => Promise<void> | void;
  isConnected?: boolean;
  selectedTopic?: any;
  showFeedback?: (message: string, type?: string) => void;
}

const isValidJson = (text: string) => {
  if (!text.trim()) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

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
      const saved = JSON.parse(localStorage.getItem(formKey) || '{}');
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
  const history = usePublishHistory(connectionId, showFeedback);
  const schemas = useMessageSchemas(payload, encoding, showFeedback);
  const [isPublishing, setIsPublishing] = useState(false);
  const [showQosDropdown, setShowQosDropdown] = useState(false);
  const [templateVariables, setTemplateVariables] = useState<Record<string, string>>({});
  const [templateError, setTemplateError] = useState('');
  // The topic a schema filled in, replaced when another schema is applied.
  const generatedTopic = useRef<string | null>(null);
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
    const template = schemas.service.getTemplate(templateId);
    if (!template) return;
    try {
      const processed = schemas.service.processTemplate(template, variables);
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
    const template = schemas.service.getTemplate(templateId);
    if (!template) return;
    schemas.setSelected(templateId);
    schemas.setDropdown(false);
    try {
      const defaults = templateDefaults(template.variables);
      setTemplateVariables(defaults);
      applyTemplate(templateId, defaults);
    } catch (error) {
      setTemplateVariables({});
      setTemplateError((error as Error).message);
    }
  };

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

  const handlePublish = async () => {
    if (schemas.selected && templateError) {
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
      history.record(messageData);
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
  const { dropdown: schemaDropdown, setDropdown: setSchemaDropdown } = schemas;
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (showQosDropdown && !target.closest('.qos-select-wrapper')) {
        setShowQosDropdown(false);
      }
      if (schemaDropdown && !target.closest('.template-select-wrapper')) {
        setSchemaDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showQosDropdown, schemaDropdown, setSchemaDropdown]);

  const loadFromSelectedTopic = () => {
    if (!selectedTopic) {
      showFeedback?.('No topic selected', 'error');
      return;
    }

    setPropertyDraft(emptyPropertyDraft());
    generatedTopic.current = null;
    schemas.setSelected(null);
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
    schemas.setSelected(null);
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
    schemas.setSelected(null);
    localStorage.removeItem(formKey);
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

  const copyToClipboard = (text: string, feedbackMsg: string) => {
    navigator.clipboard.writeText(text);
    showFeedback?.(feedbackMsg, 'success');
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
              schemaValidation={schemas.validation}
            />

            <TemplatesSection
              showTemplates={schemas.open}
              setShowTemplates={schemas.setOpen}
              handleTemplateImport={schemas.importFile}
              handleTemplateExport={schemas.exportAll}
              messageTemplates={schemas.templates}
              showTemplateDropdown={schemas.dropdown}
              setShowTemplateDropdown={schemas.setDropdown}
              isPublishing={isPublishing}
              selectedTemplateName={schemas.selectedName}
              selectedTemplate={schemas.selected}
              setSelectedTemplate={schemas.setSelected}
              handleTemplateSelect={handleTemplateSelect}
              handleTemplateDelete={schemas.setPendingDelete}
            />

            {schemas.open && schemas.selected && (
              <TemplateVariables
                definitions={schemas.service.getTemplate(schemas.selected)?.variables ?? {}}
                values={templateVariables}
                onChange={(name, value) =>
                  setTemplateVariables((previous) => ({ ...previous, [name]: value }))
                }
                onApply={() => applyTemplate(schemas.selected!, templateVariables)}
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

            {settings.sparkplug && (
              <SparkplugCommand
                connectionId={connectionId}
                isConnected={isConnected}
                selectedPath={selectedPath}
                showFeedback={showFeedback}
              />
            )}

            <div className="form-actions">
              <button
                onClick={handlePublish}
                className="btn btn-md btn-primary publish-form-publish-btn"
                disabled={
                  !!(schemas.selected && templateError) ||
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
                className="btn btn-md btn-success publish-form-load-topic-btn"
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
                  className="btn btn-md btn-warning publish-form-remove-retained-btn"
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
                className="btn btn-md btn-secondary publish-form-clear-btn"
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
                        <i className="fas fa-save"></i> Retain
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

        {history.history.length > 0 && (
          <PublishHistory
            publishHistory={history.history}
            clearHistory={history.clear}
            loadFromHistory={loadFromHistory}
          />
        )}
      </div>

      {schemas.pendingDelete && (
        <TemplateDeleteDialog
          name={schemas.service.getTemplate(schemas.pendingDelete)?.name ?? ''}
          cancelTemplateDelete={() => schemas.setPendingDelete(null)}
          confirmTemplateDelete={schemas.confirmDelete}
        />
      )}
    </div>
  );
}

export default PublishingPanel;
