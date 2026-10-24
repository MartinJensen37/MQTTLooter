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
  const [page, setPage] = useState<HistorySearchPage>();
  const [query, setQuery] = useState<HistorySearchQuery>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Enter a literal payload search.');
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
    setStatus('Search stopped. You can continue from the last completed chunk.');
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
    setQuery(undefined);
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
      setQuery(initial);
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
            void scan({ connectionId, topic, term, mode, from: to - windowMs, to }, true);
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
          matches on this page.
        </p>
        <p>
          Exact topic: <strong>{topic}</strong> ·{' '}
          {query
            ? `${new Date(query.from).toLocaleString()} – ${new Date(query.to).toLocaleString()}. New messages require a new search.`
            : 'Retained disk history.'}
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
        <details>
          <summary>Search scope and limits</summary>
          <p>
            Searches the exact selected topic in retained disk history, including records outside
            the current page and live cache. Text matching is literal and case sensitive, without
            regular expressions or JSON formatting. Hex matching searches raw bytes in any payload.
            Stop pauses scanning; Continue resumes from the last completed step. A result page
            contains up to 100 matches / 1 MiB estimated. Payloads above 256 KiB or records above 1
            MiB estimated are skipped and counted. Continue searches older records in the same
            snapshot. Retention can remove records during a search. Sorting, copying and export
            apply only to displayed matches. Clear topic history removes all stored and cached
            messages for this topic, including unmatched records.
          </p>
        </details>
      </div>
      <MessagePanel
        connectionName={panelProps.connectionName}
        onClearMessages={panelProps.onClearMessages}
        showFeedback={panelProps.showFeedback}
        clearLabel="Clear topic history"
        connectionId={connectionId}
        selectedTopic={{ topicPath: topic, connectionId }}
        messages={messages}
        storedPage
      />
    </div>
  );
}
