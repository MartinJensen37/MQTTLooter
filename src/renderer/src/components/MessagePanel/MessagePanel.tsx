import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import './MessagePanel.css';
import StableScrollViewport from '../StableScrollViewport';
import PayloadView, { type PayloadViewMode } from './PayloadView';
import MessageProperties from './MessageProperties';
import TopicTreeService, { type DisplayMessage } from '../../services/TopicTreeService';
import { exportMessage, exportMessageCSV } from '../../utils/messageExport';
import { plainLog } from '../../utils/payloadPresentation';
import { matchDecoder } from '../../../../shared/decoders';
import { useTopicDecoders } from '../../services/DecoderRegistry';
import { useSettings, type Settings } from '../../services/Settings';
import { clockTime, dateTime } from '../../utils/time';
import { parseSparkplugTopic } from '../../../../shared/sparkplug';
import type { SearchMode } from '../../hooks/useTopicSearch';
import SparkplugBadge from '../Controls/SparkplugBadge';
import SparkplugDetails from './SparkplugDetails';

type Feedback = (message: string, type?: string) => void;
type Shown = Settings['messagesShown'];

/** Cards are rendered in steps as the list scrolls, so long histories stay responsive. */
const RENDER_STEP = 200;
const SHOWN_CHOICES: Shown[] = [300, 1000, 10000, 'all'];

interface MessagePanelProps {
  messages: DisplayMessage[];
  selectedTopic: { topicPath: string } | null;
  connectionName?: string;
  connectionId?: string | null;
  showFeedback?: Feedback;
  /** Replaces the message list while plotting. */
  plotContent?: ReactNode;
  onPlotChange?: (open: boolean) => void;
  onClearMessages?: () => void;
  onExportAll?: (format: 'json' | 'csv') => void;
  exportAllLabel?: string;
  /** The list holds search matches rather than the topic's messages. */
  searching?: boolean;
  shownLimit?: Shown;
  onShownLimitChange?: (shown: Shown) => void;
  search?: {
    term: string;
    mode: SearchMode;
    /** A decoder matches the topic, so decoded values can be searched. */
    decodable: boolean;
    onTermChange: (term: string) => void;
    onModeChange: (mode: SearchMode) => void;
  };
  /** Loading or search progress, shown under the search field. */
  progress?: string;
  error?: string;
  onDecoders?: { count: number; open: () => void };
}

function download(text: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function MessagePanel({
  messages,
  selectedTopic,
  connectionName,
  connectionId,
  showFeedback,
  plotContent = null,
  onPlotChange,
  onClearMessages,
  onExportAll,
  exportAllLabel = 'Full disk history as',
  searching = false,
  shownLimit,
  onShownLimitChange,
  search,
  progress = '',
  error = '',
  onDecoders,
}: MessagePanelProps) {
  const plotting = Boolean(plotContent);
  const topicPath = selectedTopic?.topicPath;
  const panelRef = useRef<HTMLDivElement>(null);
  const [previewBytes, setPreviewBytes] = useState(100);
  const [displayMode, setDisplayMode] = useState<'cards' | 'plain'>('cards');
  // One payload view for every card of the topic; it starts from the Settings default.
  const { payloadView: defaultView, sparkplug } = useSettings();
  const [payloadView, setPayloadView] = useState<PayloadViewMode>(defaultView);
  useEffect(() => setPayloadView(defaultView), [defaultView]);
  const decoders = useTopicDecoders();
  const topicDecoder = topicPath === undefined ? undefined : matchDecoder(decoders, topicPath);
  // Pinned topics keep their cached messages under memory pressure.
  const [, setPinVersion] = useState(0);
  const pinnable = Boolean(connectionId && topicPath !== undefined);
  const pinned =
    pinnable && (TopicTreeService.getTopicTree(connectionId!)?.pins.includes(topicPath!) ?? false);
  const togglePin = () => {
    if (TopicTreeService.toggleTopicPin(connectionId!, topicPath!))
      setPinVersion((version) => version + 1);
    else showFeedback?.('Up to 8 topics per connection can be pinned.', 'error');
  };
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !panelRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setPreviewBytes(Math.max(40, Math.min(512, Math.floor((entry.contentRect.width - 100) / 7))));
    });
    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, []);
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [retainedOnly, setRetainedOnly] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const [following, setFollowing] = useState(true);

  // Messages arrive newest first.
  const processed = useMemo(() => {
    if (plotting) return messages;
    const filtered = retainedOnly ? messages.filter((message) => message.retain) : messages;
    return sortOrder === 'asc' ? [...filtered].reverse() : filtered;
  }, [messages, retainedOnly, sortOrder, plotting]);

  const viewKey = JSON.stringify([
    connectionId,
    topicPath,
    sortOrder,
    retainedOnly,
    displayMode,
    searching && search?.term,
  ]);
  const [renderCount, setRenderCount] = useState(RENDER_STEP);
  useEffect(() => setRenderCount(RENDER_STEP), [viewKey]);
  const rendered = useMemo(() => processed.slice(0, renderCount), [processed, renderCount]);
  const more = processed.length > rendered.length;
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = sentinel.current;
    if (!more || !element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setRenderCount(Infinity);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setRenderCount((count) => count + RENDER_STEP),
      { rootMargin: '600px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [more, rendered.length]);

  const log = useMemo(
    () => (!plotting && displayMode === 'plain' ? plainLog(rendered) : null),
    [rendered, displayMode, plotting],
  );

  const latest = useMemo(() => {
    let newest: DisplayMessage | undefined;
    for (const message of messages)
      if (!newest || message.timestamp > newest.timestamp) newest = message;
    return newest;
  }, [messages]);

  useEffect(() => {
    if (!exportMenu) return;
    const close = (event: MouseEvent) => {
      if (!(event.target as Element).closest('.message-export-wrapper')) setExportMenu(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [exportMenu]);

  const exportShown = useCallback(
    (format: 'json' | 'csv') => {
      if (topicPath === undefined || processed.length === 0) return;
      const name = `mqtt-topic-${topicPath.replace(/[/\\:*?"<>|]/g, '_')}-${new Date().toISOString().slice(0, 19)}.${format}`;
      if (format === 'json')
        download(
          JSON.stringify(
            {
              exportDate: new Date().toISOString(),
              connectionName: connectionName || 'Unknown',
              topic: topicPath,
              messageCount: processed.length,
              messages: processed.map(exportMessage),
            },
            null,
            2,
          ),
          'application/json',
          name,
        );
      else download(exportMessageCSV(processed), 'text/csv', name);
      setExportMenu(false);
      showFeedback?.(`Topic exported as ${format.toUpperCase()}!`, 'success');
    },
    [topicPath, processed, connectionName, showFeedback],
  );

  const copy = (text: string, feedback: string) => {
    void navigator.clipboard.writeText(text);
    showFeedback?.(feedback, 'success');
  };

  return (
    <div className="message-panel" ref={panelRef}>
      <div className="panel-header">
        <div className="header-left">
          <h2>
            {plotting
              ? 'Topic Details'
              : `${searching ? 'Matches' : 'Messages'} (${processed.length.toLocaleString()})`}
            {topicPath !== undefined && <span className="filter-indicator"> | {topicPath}</span>}
          </h2>
        </div>
      </div>

      {topicPath !== undefined && (
        <div className="topic-details-box">
          <div className="topic-details-content">
            <div className="topic-info-grid">
              <div className="topic-info-item">
                <label>Full Topic Path:</label>
                <div className="topic-path-with-copy">
                  <span className="topic-path">{topicPath}</span>
                  <button
                    className="copy-btn"
                    onClick={() => copy(topicPath, 'Topic path copied!')}
                    title="Copy topic path"
                  >
                    <i className="fas fa-copy"></i>
                  </button>
                  {pinnable && (
                    <button
                      className={`copy-btn pin-btn${pinned ? ' pinned' : ''}`}
                      onClick={togglePin}
                      aria-pressed={pinned}
                      aria-label={pinned ? 'Unpin topic' : 'Pin topic'}
                      title={
                        pinned
                          ? 'Unpin: older messages can be removed from memory again'
                          : 'Pin: keep this topic’s messages in memory'
                      }
                    >
                      <i className="fas fa-thumbtack"></i>
                    </button>
                  )}
                </div>
              </div>
              <div className="topic-info-item">
                <label>Last Message:</label>
                <span className="timestamp">{latest ? dateTime(latest.timestamp) : 'N/A'}</span>
              </div>
              <div className="topic-info-item">
                <label>QoS:</label>
                <span className={`badge badge-qos-${latest?.qos ?? 0}`}>
                  QoS {latest?.qos ?? 0}
                </span>
              </div>
              <div className="topic-info-item">
                <label>Retained:</label>
                <span className={`retain-status ${latest?.retain ? 'retained' : 'not-retained'}`}>
                  {latest?.retain ? 'Yes' : 'No'}
                </span>
              </div>
            </div>
            {sparkplug && connectionId && parseSparkplugTopic(topicPath) && (
              <SparkplugDetails
                connectionId={connectionId}
                topic={topicPath}
                showFeedback={showFeedback}
              />
            )}
            {!plotting && (
              <div className="topic-actions-section">
                {onClearMessages && (
                  <button
                    onClick={onClearMessages}
                    className="btn btn-sm btn-danger"
                    title="Remove this topic's messages from memory and disk history"
                    disabled={messages.length === 0 && !searching}
                  >
                    <i className="fas fa-trash"></i> Clear messages
                  </button>
                )}
                <button
                  className={`btn btn-sm ${following ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setFollowing((value) => !value)}
                  title={
                    following
                      ? 'Following new messages. Click to stop.'
                      : 'Click to follow new messages.'
                  }
                >
                  <i className={`fas ${following ? 'fa-arrow-up' : 'fa-thumbtack'}`}></i>
                  {following ? ' Following' : ' Pinned'}
                </button>
                <div className="message-export-wrapper custom-select-wrapper">
                  <button
                    type="button"
                    className="custom-select-button"
                    onClick={() => setExportMenu((value) => !value)}
                    title="Export topic data"
                  >
                    <span className="select-value">
                      <i className="fas fa-download"></i> Export
                    </span>
                    <i className={`fas fa-chevron-down ${exportMenu ? 'rotated' : ''}`}></i>
                  </button>
                  {exportMenu && (
                    <div className="custom-select-dropdown">
                      {(['json', 'csv'] as const).map((format) => (
                        <button
                          key={format}
                          type="button"
                          className="dropdown-option"
                          disabled={processed.length === 0}
                          onClick={() => exportShown(format)}
                        >
                          <i
                            className={`fas ${format === 'json' ? 'fa-file-code' : 'fa-file-csv'}`}
                          ></i>{' '}
                          Shown messages as {format.toUpperCase()}
                        </button>
                      ))}
                      {onExportAll &&
                        (['json', 'csv'] as const).map((format) => (
                          <button
                            key={`all-${format}`}
                            type="button"
                            className="dropdown-option"
                            onClick={() => {
                              setExportMenu(false);
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

      <div className="message-filters" aria-label="Message filters">
        <div className="message-filter-row">
          <label>
            Display{' '}
            <select
              className="custom-select-button form-select form-select-compact"
              aria-label="Message display"
              value={plotting ? 'plot' : displayMode}
              onChange={(event) => {
                const value = event.target.value;
                onPlotChange?.(value === 'plot');
                if (value !== 'plot') setDisplayMode(value as 'cards' | 'plain');
              }}
            >
              <option value="cards">Message cards</option>
              <option value="plain">Plain log</option>
              {onPlotChange && (
                <option value="plot" disabled={topicPath === undefined}>
                  Plot
                </option>
              )}
            </select>
          </label>
          {!plotting && displayMode === 'cards' && (
            <label>
              View{' '}
              <select
                className="custom-select-button form-select form-select-compact"
                aria-label="Payload view"
                value={payloadView === 'decoded' && !topicDecoder ? 'auto' : payloadView}
                onChange={(event) => setPayloadView(event.target.value as PayloadViewMode)}
              >
                <option value="auto">Auto</option>
                <option value="text">Text as received</option>
                <option value="hex">Hex bytes</option>
                {topicDecoder && <option value="decoded">Decoded ({topicDecoder.name})</option>}
              </select>
            </label>
          )}
          {!plotting && (
            <>
              <label>
                Order{' '}
                <select
                  className="custom-select-button form-select form-select-compact"
                  aria-label="Message order"
                  value={sortOrder}
                  onChange={(event) => setSortOrder(event.target.value as 'desc' | 'asc')}
                >
                  <option value="desc">Newest first</option>
                  <option value="asc">Oldest first</option>
                </select>
              </label>
              {shownLimit !== undefined && onShownLimitChange && (
                <label title="Newest messages kept for this topic, including disk history">
                  Show{' '}
                  <select
                    className="custom-select-button form-select form-select-compact"
                    aria-label="Messages shown"
                    value={String(shownLimit)}
                    onChange={(event) =>
                      onShownLimitChange(
                        event.target.value === 'all'
                          ? 'all'
                          : (Number(event.target.value) as Shown),
                      )
                    }
                  >
                    {SHOWN_CHOICES.map((choice) => (
                      <option key={choice} value={choice}>
                        {choice === 'all' ? 'All messages' : `Newest ${choice.toLocaleString()}`}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={retainedOnly}
                  onChange={(event) => setRetainedOnly(event.target.checked)}
                />
                Retained only
              </label>
            </>
          )}
          {log && (
            <button
              className="btn btn-sm btn-secondary"
              onClick={() =>
                copy(log.rows.map((row) => row.text).join('\n'), 'Visible log copied.')
              }
            >
              Copy visible log
            </button>
          )}
          {onDecoders && (
            <button
              className="btn btn-sm btn-secondary message-decoders-btn"
              onClick={onDecoders.open}
            >
              Decoders{onDecoders.count ? ` (${onDecoders.count})` : ''}
            </button>
          )}
        </div>
        {!plotting && search && topicPath !== undefined && (
          <div className="message-search-row">
            <input
              type="search"
              className="form-input search-input"
              aria-label="Search message contents"
              placeholder={
                search.mode === 'hex'
                  ? 'Search this topic for hex bytes, e.g. 00 ff 80'
                  : 'Search this topic (case-sensitive)'
              }
              maxLength={1024}
              value={search.term}
              onChange={(event) => search.onTermChange(event.target.value)}
            />
            <select
              className="custom-select-button form-select form-select-compact"
              aria-label="Content search mode"
              value={search.mode}
              onChange={(event) => search.onModeChange(event.target.value as SearchMode)}
            >
              <option value="text">Text</option>
              <option value="hex">Hex bytes</option>
              {search.decodable && <option value="decoded">Decoded</option>}
            </select>
          </div>
        )}
        {!plotting && (progress || error) && (
          <p className="message-filter-status" role={error ? 'alert' : 'status'}>
            {error || progress}
          </p>
        )}
      </div>

      {plotContent || (
        <StableScrollViewport
          className="message-list"
          viewKey={viewKey}
          following={following}
          onFollowingChange={setFollowing}
        >
          {processed.length === 0 ? (
            <div className="no-messages">
              <div className="no-messages-icon">
                <i className="fas fa-inbox"></i>
              </div>
              <h3>{searching ? 'No matches' : 'No messages in this view'}</h3>
              <p>
                {topicPath === undefined
                  ? 'Select a topic from the topic tree to view its messages'
                  : searching
                    ? 'No stored message of this topic matches the search.'
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
                : rendered.map((msg) => (
                    <div
                      key={msg.id}
                      data-scroll-key={msg.id}
                      className="message-item"
                      onDoubleClick={() => copy(msg.message, 'Payload copied!')}
                      title={
                        msg.encoding === 'base64'
                          ? 'Double-click to copy base64 payload'
                          : 'Double-click to copy payload'
                      }
                    >
                      <div className="message-header">
                        <div className="message-meta">
                          <span className="timestamp" title={dateTime(msg.timestamp)}>
                            <i className="fas fa-clock"></i> {clockTime(msg.timestamp)}
                          </span>
                          <span className="topic" title={msg.topic}>
                            <i className="fas fa-tag"></i> {msg.topic}
                          </span>
                          <span className={`badge badge-qos-${msg.qos}`}>QoS {msg.qos}</span>
                          {sparkplug && parseSparkplugTopic(msg.topic) && <SparkplugBadge />}
                          {msg.encoding === 'base64' && (
                            <span className="badge">Binary (base64 export)</span>
                          )}
                          {msg.retain && (
                            <span className="badge badge-retain">
                              <i className="fas fa-save"></i> Retain
                            </span>
                          )}
                        </div>
                        <div className="message-actions">
                          <button
                            className="copy-btn message-copy-btn"
                            onClick={(event) => {
                              event.stopPropagation();
                              copy(msg.message, 'Payload copied!');
                            }}
                            title={
                              msg.encoding === 'base64' ? 'Copy base64 payload' : 'Copy payload'
                            }
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
                          view={payloadView}
                        />
                        <MessageProperties
                          protocolVersion={msg.protocolVersion}
                          properties={msg.properties}
                        />
                      </div>
                    </div>
                  ))}
              {more && (
                <div ref={sentinel} className="message-list-more">
                  Showing {rendered.length.toLocaleString()} of {processed.length.toLocaleString()};
                  scroll for more
                </div>
              )}
            </>
          )}
        </StableScrollViewport>
      )}
    </div>
  );
}

export default memo(MessagePanel);
