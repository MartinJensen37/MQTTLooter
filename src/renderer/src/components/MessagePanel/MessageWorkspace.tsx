import { useEffect, useState } from 'react';
import MessagePanel from './MessagePanel';
import IncomingPlot from './IncomingPlot';
import HistorySearch from './HistorySearch';
import type { HistoryPage, HistoryQuery, HistoryStatus } from '../../../../shared/history';
import TopicTreeService from '../../services/TopicTreeService';
import './MessageWorkspace.css';

export default function MessageWorkspace(props: any) {
  return <Workspace key={props.connectionId ?? 'none'} {...props} />;
}

function Workspace(props: any) {
  const [stored, setStored] = useState(false);
  const [plotOpen, setPlotOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [status, setStatus] = useState<HistoryStatus>();
  const [page, setPage] = useState<HistoryPage>();
  const [cursors, setCursors] = useState<Partial<HistoryQuery>[]>([{}]);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [topicOverride, setTopicOverride] = useState<string>();
  const [search, setSearch] = useState('');
  const [topics, setTopics] = useState<{ path: string }[]>([]);
  const selectedPath = props.selectedTopic?.topicPath;
  const topic = topicOverride ?? selectedPath;
  const connectionId = props.connectionId;

  useEffect(() => {
    setTopicOverride(undefined);
    setCursors([{}]);
    setPage(undefined);
  }, [selectedPath]);
  useEffect(() => {
    if (!connectionId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await window.electronAPI.history.status();
        if (!disposed && result.success) setStatus(result.data);
      } catch {
        /* Main may be shutting down. */
      } finally {
        if (!disposed) timer = setTimeout(poll, 1000);
      }
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [connectionId, refresh]);

  useEffect(() => {
    if (!stored || searchOpen || !connectionId || topic === undefined) return;
    let disposed = false;
    setBusy(true);
    setError('');
    void window.electronAPI.history
      .page({ connectionId, topic, ...cursors.at(-1) })
      .then((result) => {
        if (disposed) return;
        if (!result.success) {
          setError(result.error ?? 'History query failed');
          setPage(undefined);
        } else setPage(result.data);
      })
      .catch((error) => {
        if (!disposed) setError(error.message);
      })
      .finally(() => {
        if (!disposed) setBusy(false);
      });
    return () => {
      disposed = true;
    };
  }, [stored, searchOpen, connectionId, topic, cursors, refresh]);

  useEffect(() => {
    if (!stored || searchOpen || !connectionId) return;
    let disposed = false;
    const timer = setTimeout(() => {
      void window.electronAPI.history
        .topics(connectionId, search)
        .then((result) => {
          if (!disposed) setTopics(result.success ? (result.data ?? []) : []);
        })
        .catch(() => {
          if (!disposed) setTopics([]);
        });
    }, 150);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [stored, searchOpen, connectionId, search, refresh]);

  const latest = () => {
    setPage(undefined);
    setCursors([{}]);
    setRefresh((value) => value + 1);
  };
  const exportStored = async (format: 'json' | 'csv') => {
    if (!connectionId || topic === undefined) return;
    try {
      const result = await window.electronAPI.history.export(
        connectionId,
        topic,
        format,
        props.connectionName ?? 'Unknown',
      );
      if (!result.success) throw new Error(result.error ?? 'Export failed');
      if (result.data?.saved)
        props.showFeedback?.(
          `Exported ${result.data.count?.toLocaleString()} stored messages to ${result.data.path}`,
          'success',
        );
    } catch (reason) {
      setError((reason as Error).message);
    }
  };
  const clearStored = async () => {
    if (!connectionId || topic === undefined) return;
    const result = await window.electronAPI.history.clear(connectionId, topic);
    if (!result.success) {
      setError(result.error ?? 'Could not clear history');
      return;
    }
    TopicTreeService.clearTopicMessages(connectionId, topic);
    setSearchOpen(false);
    latest();
    props.showFeedback?.('Stored and cached messages cleared for this topic.', 'success');
  };
  // Durable gap records cover earlier runs; this run's drops may not be written yet.
  const gap = status?.store?.gaps?.[connectionId];
  const missing = Math.max(
    gap?.dropped ?? 0,
    status?.delivery.connections[connectionId]?.dropped ?? 0,
  );
  const lastGap = gap?.last;
  const archiveMessages =
    page?.messages.map((message) => ({
      ...message,
      id: `${message.sessionId}:${message.sequence}`,
      connectionId: message.id,
    })) ?? [];

  return (
    <div className="message-workspace">
      <div className="message-history-toolbar">
        {stored && (
          <button
            className="btn btn-sm btn-secondary"
            aria-expanded={searchOpen}
            disabled={topic === undefined}
            onClick={() => {
              setSearchOpen((value) => !value);
              setPlotOpen(false);
              setBusy(false);
            }}
          >
            {searchOpen ? 'Close content search' : 'Search message contents'}
          </button>
        )}
        <label>
          Source{' '}
          <select
            className="form-select custom-select-button"
            aria-label="Message source"
            value={stored ? 'stored' : 'live'}
            onChange={(event) => {
              setStored(event.target.value === 'stored');
              setSearchOpen(false);
              latest();
            }}
          >
            <option value="live">Live cache</option>
            <option value="stored">Disk history</option>
          </select>
        </label>
        <details className="message-storage-settings">
          <summary>Disk history settings</summary>
          <label>
            <input
              type="checkbox"
              checked={status?.store?.persistent ?? false}
              disabled={!status?.store}
              onChange={async (event) => {
                const result = await window.electronAPI.history.persist(event.target.checked);
                if (!result.success) setError(result.error ?? 'Could not save setting');
                setRefresh((value) => value + 1);
              }}
            />{' '}
            Keep history across app restarts
          </label>
        </details>
        {stored && !searchOpen && !plotOpen && (
          <>
            <button className="btn btn-sm btn-secondary" onClick={latest} disabled={busy}>
              Latest stored page
            </button>
            <button
              className="btn btn-sm btn-secondary"
              disabled={busy || cursors.length <= 1}
              onClick={() => setCursors((previous) => previous.slice(0, -1))}
            >
              Newer page
            </button>
            <button
              className="btn btn-sm btn-secondary"
              disabled={busy || page?.nextBefore == null || cursors.length >= 1000}
              onClick={() =>
                setCursors((previous) => [
                  ...previous,
                  {
                    before: page!.nextBefore!,
                    snapshot: page!.snapshot,
                    generation: page!.generation,
                  },
                ])
              }
            >
              Older page
            </button>
            <span>{busy ? 'Loading...' : `Page ${cursors.length}`}</span>
          </>
        )}
      </div>
      {status?.error && (
        <p role="alert" className="message-storage-notice">
          Disk capture stopped: {status.error}{' '}
          <button
            className="btn btn-sm btn-secondary"
            onClick={async () => {
              const result = await window.electronAPI.history.resume();
              if (!result.success) setError(result.error ?? 'Could not resume');
              setRefresh((value) => value + 1);
            }}
          >
            Resume capture
          </button>
        </p>
      )}
      {missing > 0 && (
        <p className="message-storage-notice">
          Disk history has gaps: {missing.toLocaleString()} messages were not stored
          {lastGap ? ` (latest ${new Date(lastGap).toLocaleTimeString()})` : ''}.
        </p>
      )}
      {stored && !searchOpen && (
        <div className="message-history-catalog">
          <input
            type="search"
            className="form-input"
            aria-label="Search stored topics"
            placeholder="Search stored topics (case sensitive)"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            className="form-select custom-select-button"
            aria-label="Stored topic"
            value={topic ?? ''}
            onChange={(event) => {
              setTopicOverride(event.target.value);
              latest();
            }}
          >
            {topic === undefined && (
              <option value="" disabled>
                Select a stored topic
              </option>
            )}
            {topic !== undefined && !topics.some((item) => item.path === topic) && (
              <option value={topic}>{topic}</option>
            )}
            {topics.map((item) => (
              <option key={item.path} value={item.path}>
                {item.path}
              </option>
            ))}
          </select>
        </div>
      )}
      {error && (
        <p role="alert" className="message-storage-notice">
          {error}
        </p>
      )}
      {stored && searchOpen && connectionId && topic !== undefined ? (
        <HistorySearch
          key={`${connectionId}:${topic}`}
          connectionId={connectionId}
          topic={topic}
          active={props.active}
          connectionName={props.connectionName}
          showFeedback={props.showFeedback}
          onClearMessages={clearStored}
        />
      ) : (
        <MessagePanel
          {...props}
          onPlotChange={setPlotOpen}
          plotContent={
            plotOpen && connectionId && (stored ? topic : selectedPath) !== undefined ? (
              <IncomingPlot
                active={props.active}
                key={`${connectionId}:${stored ? topic : selectedPath}`}
                connectionId={connectionId}
                topic={stored ? topic : selectedPath}
              />
            ) : null
          }
          storedPage={stored}
          messages={stored ? archiveMessages : props.messages}
          selectedTopic={
            stored
              ? topic === undefined
                ? null
                : { topicPath: topic, connectionId }
              : props.selectedTopic
          }
          onClearMessages={stored ? clearStored : props.onClearMessages}
          onExportAll={stored ? exportStored : undefined}
        />
      )}
    </div>
  );
}
