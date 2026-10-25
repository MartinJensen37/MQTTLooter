import { useCallback, useEffect, useRef, useState } from 'react';
import MessagePanel from './MessagePanel';
import {
  validateSearch,
  type HistorySearchQuery,
  type HistorySearchPage,
} from '../../../../shared/history-search';
import './HistorySearch.css';

export default function HistorySearch({
  connectionId,
  topic,
  active = true,
  ...panelProps
}: {
  connectionId: string;
  topic: string;
  active?: boolean;
  connectionName?: string;
  showFeedback?: any;
  onClearMessages?: any;
}) {
  const [term, setTerm] = useState('');
  const [mode, setMode] = useState<'text' | 'hex'>('text');
  const [windowMs, setWindowMs] = useState(86400000);
  const [scope, setScope] = useState<'topic' | 'filter'>('topic');
  const [filter, setFilter] = useState('#');
  const [page, setPage] = useState<HistorySearchPage>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Enter text or hex bytes to search.');
  const [error, setError] = useState('');
  const [stats, setStats] = useState({ scanned: 0, large: 0, binary: 0 });
  const generation = useRef(0);
  const next = useRef<HistorySearchQuery>();
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  const cancel = useCallback(() => {
    invalidate();
    setBusy(false);
    setStatus('Search stopped.');
  }, [invalidate]);
  useEffect(() => {
    if (!active) cancel();
    return invalidate;
  }, [active, cancel, invalidate]);
  const reset = () => {
    generation.current++;
    next.current = undefined;
    setBusy(false);
    setPage(undefined);
    setError('');
    setStats({ scanned: 0, large: 0, binary: 0 });
    setStatus('Search settings changed. Start a new search.');
  };
  const scan = async (initial: HistorySearchQuery, fresh: boolean) => {
    const run = ++generation.current;
    try {
      validateSearch(initial);
    } catch (reason) {
      setError((reason as Error).message);
      return;
    }
    setBusy(true);
    setError('');
    setPage(undefined);
    setStatus('Searching retained history…');
    if (fresh) {
      setStats({ scanned: 0, large: 0, binary: 0 });
    }
    next.current = initial;
    let cursor = initial;
    try {
      while (generation.current === run) {
        const response = await window.electronAPI.history.search(cursor);
        if (generation.current !== run) return;
        if (!response.success || !response.data)
          throw new Error(response.error || 'History search failed.');
        const data = response.data;
        next.current =
          data.nextBefore === null
            ? undefined
            : {
                ...cursor,
                before: data.nextBefore,
                snapshot: data.snapshot,
                generation: data.generation,
              };
        setStats((previous) => ({
          scanned: previous.scanned + data.scanned,
          large: previous.large + data.skippedLarge,
          binary: previous.binary + data.skippedBinary,
        }));
        if (data.messages.length || !next.current) {
          setPage(data);
          setStatus(
            next.current
              ? 'Matches found. Continue to search older records.'
              : 'Reached the end of this retained snapshot.',
          );
          break;
        }
        cursor = next.current;
        // Yield between bounded worker requests so ingestion and other history readers can run.
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } catch (reason) {
      if (generation.current === run) {
        setError((reason as Error).message);
        setStatus('Search interrupted. Start a new search if history was cleared.');
      }
    } finally {
      if (generation.current === run) setBusy(false);
    }
  };
  const messages =
    page?.messages.map((message) => ({
      ...message,
      id: `${message.sessionId}:${message.sequence}`,
      connectionId: message.id,
    })) ?? [];
  return (
    <div className="history-search">
      <div className="history-search-controls">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const to = Date.now();
            void scan(
              {
                connectionId,
                topic,
                term,
                mode,
                from: to - windowMs,
                to,
                ...(scope === 'filter' && { scope, filter }),
              },
              true,
            );
          }}
        >
          <label>
            Payload{' '}
            <input
              className="form-input"
              aria-label="Search message contents"
              value={term}
              maxLength={1024}
              placeholder={mode === 'hex' ? '00 ff 80' : 'Case-sensitive literal text'}
              onChange={(event) => {
                reset();
                setTerm(event.target.value);
              }}
            />
          </label>
          <label>
            Match{' '}
            <select
              className="form-select custom-select-button"
              aria-label="Content search mode"
              value={mode}
              onChange={(event) => {
                reset();
                setMode(event.target.value as 'text' | 'hex');
              }}
            >
              <option value="text">UTF-8 text</option>
              <option value="hex">Hex bytes</option>
            </select>
          </label>
          <label>
            Topics{' '}
            <select
              className="form-select custom-select-button"
              aria-label="Content search scope"
              value={scope}
              onChange={(event) => {
                reset();
                setScope(event.target.value as 'topic' | 'filter');
              }}
            >
              <option value="topic">This topic</option>
              <option value="filter">Topic filter</option>
            </select>
          </label>
          {scope === 'filter' && (
            <label>
              Filter{' '}
              <input
                className="form-input"
                aria-label="Content search topic filter"
                value={filter}
                placeholder="sensors/+/temperature"
                onChange={(event) => {
                  reset();
                  setFilter(event.target.value);
                }}
              />
            </label>
          )}
          <label>
            Received{' '}
            <select
              className="form-select custom-select-button"
              aria-label="Content search time range"
              value={windowMs}
              onChange={(event) => {
                reset();
                setWindowMs(Number(event.target.value));
              }}
            >
              <option value={300000}>Last 5 minutes</option>
              <option value={3600000}>Last hour</option>
              <option value={86400000}>Retained 24 hours</option>
            </select>
          </label>
          <button
            type="submit"
            className="btn btn-sm btn-primary"
            disabled={busy || !active || !term.length}
          >
            Search history
          </button>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={!busy}
            onClick={cancel}
          >
            Stop search
          </button>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={busy || !active || !next.current}
            onClick={() => next.current && void scan(next.current, false)}
          >
            Continue search
          </button>
        </form>
        <p role="status">
          {status} {stats.scanned.toLocaleString()} records scanned; {page?.messages.length ?? 0}{' '}
          matches.
        </p>
        {!!stats.large && (
          <p role="status">
            {stats.large.toLocaleString()} oversized records skipped. These may contain additional
            matches.
          </p>
        )}
        {!!stats.binary && (
          <p>
            {stats.binary.toLocaleString()} non-UTF-8 payloads skipped in text mode. Use hex to
            search their bytes.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
      <MessagePanel
        connectionName={panelProps.connectionName}
        onClearMessages={scope === 'topic' ? panelProps.onClearMessages : undefined}
        showFeedback={panelProps.showFeedback}
        clearLabel="Clear topic history"
        connectionId={connectionId}
        selectedTopic={{ topicPath: scope === 'filter' ? filter : topic, connectionId }}
        messages={messages}
        storedPage
      />
    </div>
  );
}
