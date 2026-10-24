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
  const counts = status?.delivery.connections[connectionId];
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
        {!searchOpen && (
          <button
            className="btn btn-sm btn-secondary"
            aria-expanded={plotOpen}
            disabled={!connectionId || (stored ? topic : selectedPath) === undefined}
            onClick={() => setPlotOpen((value) => !value)}
          >
            {plotOpen ? 'Hide incoming plot' : 'Plot incoming values'}
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
          <p>
            Otherwise, session history is removed on exit or the next startup after a crash. History
            expires after 24 hours or under the storage budget.
          </p>
          {status?.store && (
            <p>
              {status.store.retainedMessages.toLocaleString()} retained ·{' '}
              {(status.store.databaseBytes / 1048576).toFixed(1)} MiB database ·{' '}
              {status.store.expired.toLocaleString()} expired this run. Payload budget: 256 MiB;
              database ceiling: 512 MiB plus a temporary rollback journal.
            </p>
          )}
          {counts && (
            <p>
              {counts.received.toLocaleString()} received · {counts.processed.toLocaleString()}{' '}
              committed · {counts.dropped.toLocaleString()} dropped/unconfirmed this run. Writes use
              a separate bounded queue.
            </p>
          )}
          <p>Saved recordings still use their separate library.</p>
        </details>
        {stored && !searchOpen && (
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
            <span>
              {busy ? 'Loading...' : `Page ${cursors.length} · up to 300 messages / 2 MiB`}
            </span>
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
      {counts && counts.dropped > 0 && (
        <p className="message-storage-notice">
          Disk history has gaps: {counts.dropped.toLocaleString()} dropped or unconfirmed messages
          this run.
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
          <span>First 50 matching paths, including topics outside the live cache.</span>
        </div>
      )}
      {stored && !searchOpen && (
        <p className="message-storage-caption">
          A fixed snapshot of retained disk history. Export applies to this page. Refresh to include
          new messages. One large payload can exceed the page byte target. Retention may remove
          older pages.
        </p>
      )}
      {error && (
        <p role="alert" className="message-storage-notice">
          {error}
        </p>
      )}
      {plotOpen && connectionId && (stored ? topic : selectedPath) !== undefined && (
        <IncomingPlot
          active={props.active}
          key={`${connectionId}:${stored ? topic : selectedPath}`}
          connectionId={connectionId}
          topic={stored ? topic : selectedPath}
        />
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
        />
      )}
    </div>
  );
}
