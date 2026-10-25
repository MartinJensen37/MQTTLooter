import React, { useState, useEffect, useCallback, useRef } from 'react';
import './MessagePanel.css';
import StableScrollViewport from '../StableScrollViewport';
import PayloadView from './PayloadView';
import MessageProperties from './MessageProperties';
import { exportMessage, exportMessageCSV } from '../../utils/messageExport';
import { plainLog } from '../../utils/payloadPresentation';

/**
 * @param {{
 *   messages: any[];
 *   selectedTopic: any;
 *   onClearMessages?: (topicPath: string) => void;
 *   connectionName?: string;
 *   connectionId?: string | null;
 *   showFeedback?: (message: string, type?: string) => void;
 *   storedPage?: boolean;
 *   plotContent?: any;
 *   onPlotChange?: (open: boolean) => void;
 *   clearLabel?: string;
 *   onExportAll?: (format: 'json' | 'csv') => void;
 *   exportAllLabel?: string;
 * }} props
 */
function MessagePanel({
  messages,
  selectedTopic,
  onClearMessages,
  connectionName,
  connectionId,
  showFeedback,
  storedPage = false,
  plotContent = null,
  onPlotChange = undefined,
  clearLabel = 'Clear Messages',
  onExportAll,
  exportAllLabel = 'Export all stored as',
}) {
  const plotting = Boolean(plotContent);
  const panelRef = useRef(null);
  const [previewBytes, setPreviewBytes] = useState(100);
  const [displayMode, setDisplayMode] = useState('cards');
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !panelRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setPreviewBytes(Math.max(40, Math.min(512, Math.floor((entry.contentRect.width - 100) / 7))));
    });
    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, []);
  const [sortBy, setSortBy] = useState('timestamp');
  const [sortOrder, setSortOrder] = useState('desc');
  const [showRetainedOnly, setShowRetainedOnly] = useState(false);
  const [showTopicExportMenu, setShowTopicExportMenu] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  const processedMessages = React.useMemo(() => {
    if (plotting) return messages;
    let filtered = showRetainedOnly ? messages.filter((m) => m.retain) : messages;
    if (sortBy === 'timestamp') {
      // History arrives newest-first. Reverse ties too when displaying oldest-first.
      const ordered = sortOrder === 'asc' ? [...filtered].reverse() : [...filtered];
      return ordered.sort((a, b) =>
        sortOrder === 'desc' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp,
      );
    }
    return filtered;
  }, [messages, showRetainedOnly, sortBy, sortOrder, plotting]);

  const log = React.useMemo(
    () => (!plotting && displayMode === 'plain' ? plainLog(processedMessages) : null),
    [processedMessages, displayMode, plotting],
  );

  const topicDetails = React.useMemo(() => {
    if (!selectedTopic) return null;
    if (processedMessages.length === 0)
      return { timestamp: null, qos: 0, retain: false, topic: selectedTopic.topicPath };
    return processedMessages.reduce(
      (latest, cur) => (cur.timestamp > latest.timestamp ? cur : latest),
      processedMessages[0],
    );
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
      messages: processedMessages.map(exportMessage),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `mqtt-topic-${selectedTopic.topicPath.replace(/[/\\:*?"<>|]/g, '_')}-${new Date().toISOString().slice(0, 19)}.json`,
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
    const csv = exportMessageCSV(processedMessages);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `mqtt-topic-${selectedTopic.topicPath.replace(/[/\\:*?"<>|]/g, '_')}-${new Date().toISOString().slice(0, 19)}.csv`,
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

  const copyPayload = useCallback(
    (payload, e) => {
      e?.stopPropagation();
      navigator.clipboard.writeText(payload);
      showFeedback?.('Payload copied!', 'success');
    },
    [showFeedback],
  );

  const formatTimestamp = (ts) => new Date(ts).toLocaleString();

  return (
    <div className="message-panel" ref={panelRef}>
      <div className="panel-header">
        <div className="header-left">
          <h2>
            {plotContent ? 'Topic Details' : `Message Details (${processedMessages.length})`}
            {selectedTopic && (
              <span className="filter-indicator"> | {selectedTopic.topicPath}</span>
            )}
          </h2>
        </div>
      </div>

      <div className="message-filters" aria-label="Message filters">
        <label>
          Display{' '}
          <select
            className="custom-select-button form-select form-select-compact"
            aria-label="Message display"
            value={plotContent ? 'plot' : displayMode}
            onChange={(event) => {
              const value = event.target.value;
              onPlotChange?.(value === 'plot');
              if (value !== 'plot') setDisplayMode(value);
            }}
          >
            <option value="cards">Message cards</option>
            <option value="plain">Plain log</option>
            {onPlotChange && (
              <option value="plot" disabled={!selectedTopic}>
                Plot
              </option>
            )}
          </select>
        </label>
        {log && (
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => {
              void navigator.clipboard
                .writeText(log.rows.map((row) => row.text).join('\n'))
                .then(() => showFeedback?.('Visible log copied.', 'success'));
            }}
          >
            Copy visible log
          </button>
        )}
        {!plotContent && (
          <>
            <label>
              Order{' '}
              <select
                className="custom-select-button form-select form-select-compact"
                aria-label="Message order"
                value={sortOrder}
                onChange={(e) => {
                  setSortBy('timestamp');
                  setSortOrder(e.target.value);
                }}
              >
                <option value="desc">Newest first</option>
                <option value="asc">Oldest first</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={showRetainedOnly}
                onChange={(e) => setShowRetainedOnly(e.target.checked)}
              />
              Retained only
            </label>
          </>
        )}
      </div>

      {selectedTopic && topicDetails && (
        <div className="topic-details-box">
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
                <span className={`badge badge-qos-${topicDetails.qos}`}>
                  QoS {topicDetails.qos}
                </span>
              </div>
              <div className="topic-info-item">
                <label>Retained:</label>
                <span
                  className={`retain-status ${topicDetails.retain ? 'retained' : 'not-retained'}`}
                >
                  {topicDetails.retain ? 'Yes' : 'No'}
                </span>
              </div>
            </div>
            {!plotContent && (
              <div className="topic-actions-section">
                {onClearMessages && (
                  <button
                    onClick={clearTopicMessages}
                    className="btn btn-sm btn-danger"
                    title="Clear messages for this topic"
                    disabled={processedMessages.length === 0}
                  >
                    <i className="fas fa-trash"></i> {clearLabel}
                  </button>
                )}
                {!storedPage && (
                  <button
                    className={`btn btn-sm ${autoScroll ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setAutoScroll((v) => !v)}
                    title={
                      autoScroll
                        ? 'Auto-scroll ON — click to pin'
                        : 'Auto-scroll OFF — click to follow'
                    }
                  >
                    <i className={`fas ${autoScroll ? 'fa-arrow-up' : 'fa-thumbtack'}`}></i>
                    {autoScroll ? ' Following' : ' Pinned'}
                  </button>
                )}
                <div className="message-export-wrapper custom-select-wrapper">
                  <button
                    type="button"
                    className="custom-select-button"
                    onClick={() => setShowTopicExportMenu((v) => !v)}
                    disabled={processedMessages.length === 0}
                    title="Export topic data"
                  >
                    <span className="select-value">
                      <i className="fas fa-download"></i> Export
                    </span>
                    <i
                      className={`fas fa-chevron-down ${showTopicExportMenu ? 'rotated' : ''}`}
                    ></i>
                  </button>
                  {showTopicExportMenu && (
                    <div className="custom-select-dropdown">
                      <button type="button" className="dropdown-option" onClick={exportTopicAsJSON}>
                        <i className="fas fa-file-code"></i> Export as JSON
                      </button>
                      <button type="button" className="dropdown-option" onClick={exportTopicAsCSV}>
                        <i className="fas fa-file-csv"></i> Export as CSV
                      </button>
                      {onExportAll &&
                        ['json', 'csv'].map((format) => (
                          <button
                            key={format}
                            type="button"
                            className="dropdown-option"
                            onClick={() => {
                              setShowTopicExportMenu(false);
                              onExportAll(format);
                            }}
                          >
                            <i className="fas fa-database"></i> {exportAllLabel}{' '}
                            {format.toUpperCase()}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!plotContent && selectedTopic?.node?.discardedHistory > 0 && (
        <p className="message-history-notice" role="status">
          {selectedTopic.node.discardedHistory} messages are no longer in the live cache.
        </p>
      )}
      {plotContent || (
        <StableScrollViewport
          className="message-list"
          viewKey={JSON.stringify([
            connectionId,
            selectedTopic?.topicPath,
            sortOrder,
            showRetainedOnly,
            displayMode,
          ])}
          following={autoScroll}
          onFollowingChange={setAutoScroll}
        >
          {processedMessages.length === 0 ? (
            <div className="no-messages">
              <div className="no-messages-icon">
                <i className="fas fa-inbox"></i>
              </div>
              <h3>No messages in this view</h3>
              <p>
                {!selectedTopic
                  ? 'Select a topic from the topic tree to view its messages'
                  : 'No messages match this view.'}
              </p>
            </div>
          ) : (
            <>
              {log?.truncated && (
                <p className="message-history-notice">
                  Preview shortened. Export includes complete payloads.
                </p>
              )}
              {log
                ? log.rows.map((row) => (
                    <pre className="message-plain-entry" key={row.id} data-scroll-key={row.id}>
                      {row.text}
                    </pre>
                  ))
                : processedMessages.map((msg) => (
                    <div
                      key={msg.id}
                      data-scroll-key={msg.id}
                      className="message-item"
                      onDoubleClick={(e) => copyPayload(msg.message, e)}
                      title={
                        msg.encoding === 'base64'
                          ? 'Double-click to copy base64 payload'
                          : 'Double-click to copy payload'
                      }
                    >
                      <div className="message-header">
                        <div className="message-meta">
                          <span className="timestamp" title={formatTimestamp(msg.timestamp)}>
                            <i className="fas fa-clock"></i>{' '}
                            {new Date(msg.timestamp).toLocaleTimeString()}
                          </span>
                          <span className="topic" title={msg.topic}>
                            <i className="fas fa-tag"></i> {msg.topic}
                          </span>
                          <span className={`badge badge-qos-${msg.qos}`}>QoS {msg.qos}</span>
                          {msg.encoding === 'base64' && (
                            <span className="badge">Binary (base64 export)</span>
                          )}
                          {msg.retain && (
                            <span className="badge badge-retain">
                              <i className="fas fa-save"></i> RETAIN
                            </span>
                          )}
                        </div>
                        <div className="message-actions">
                          <button
                            className="copy-btn"
                            onClick={(e) => copyPayload(msg.message, e)}
                            title={
                              msg.encoding === 'base64' ? 'Copy base64 payload' : 'Copy payload'
                            }
                            style={{ borderRadius: '50%', minWidth: '24px', height: '24px' }}
                          >
                            <i className="fas fa-copy"></i>
                          </button>
                        </div>
                      </div>
                      <div className="message-content">
                        <PayloadView
                          value={msg.message}
                          encoding={msg.encoding}
                          previewBytes={previewBytes}
                          topic={msg.topic}
                        />
                        <MessageProperties
                          protocolVersion={msg.protocolVersion}
                          properties={msg.properties}
                        />
                      </div>
                    </div>
                  ))}
            </>
          )}
        </StableScrollViewport>
      )}
    </div>
  );
}

export default React.memo(MessagePanel);
