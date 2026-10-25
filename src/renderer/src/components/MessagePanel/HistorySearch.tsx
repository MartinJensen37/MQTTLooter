import { useCallback, useEffect, useRef, useState } from 'react';
import MessagePanel from './MessagePanel';
import {
  validateSearch,
  type HistorySearchQuery,
  type HistorySearchPage,
} from '../../../../shared/history-search';
import { useDecoders } from '../../services/DecoderRegistry';
import './HistorySearch.css';

const DAY = 86400000;
/** A `datetime-local` value (local time, seconds) for a timestamp. */
const localInput = (ms: number) =>
  new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 19);

/** The searched receive-time range, or an error. Disk history keeps 24 hours. */
function searchRange(
  windowMs: number | 'custom',
  custom: { from: string; to: string },
  now: number,
): { from: number; to: number } | string {
  if (windowMs !== 'custom') return { from: now - windowMs, to: now };
  // Without an offset, datetime-local text parses as local time. The inputs hold whole
  // seconds, so the end second is included: otherwise the newest messages would be missed.
  const from = new Date(custom.from).getTime();
  const to = Math.min(new Date(custom.to).getTime() + 999, now);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 'Enter a start and end time.';
  if (from >= to) return 'Choose a start time before the end time.';
  if (to < now - DAY) return 'That range is older than the 24 hours of retained history.';
  return { from: Math.max(from, now - DAY), to };
}

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
  const [mode, setMode] = useState<'text' | 'hex' | 'decoded'>('text');
  const { decoders } = useDecoders();
  const [windowMs, setWindowMs] = useState<number | 'custom'>(DAY);
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [scope, setScope] = useState<'topic' | 'filter'>('topic');
  const [filter, setFilter] = useState('#');
  const [page, setPage] = useState<HistorySearchPage>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Enter text or hex bytes to search.');
  const [error, setError] = useState('');
  const [stats, setStats] = useState({ scanned: 0, large: 0, binary: 0 });
  const generation = useRef(0);
  const next = useRef<HistorySearchQuery>();
  // The current search's criteria, without cursors, for exporting every match.
  const started = useRef<HistorySearchQuery>();
  // Where each result page's scan started, newest page first. Within the fixed snapshot a
  // page is reproducible from its start, so newer pages are shown again by rescanning.
  const pageStarts = useRef<HistorySearchQuery[]>([]);
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
    pageStarts.current = [];
    setBusy(false);
    setPage(undefined);
    setError('');
    setStats({ scanned: 0, large: 0, binary: 0 });
    setStatus('Search settings changed. Start a new search.');
  };
  const scan = async (initial: HistorySearchQuery, direction: 'new' | 'older' | 'newer') => {
    const run = ++generation.current;
    const fresh = direction === 'new';
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
    if (fresh) started.current = initial;
    const starts = pageStarts.current;
    if (fresh) pageStarts.current = [initial];
    // After a stopped scan nothing was shown, so continuing replaces that page's start.
    else if (direction === 'older') {
      if (page && starts.length < 1000) starts.push(initial);
      else starts[starts.length - 1] = initial;
    }
    let cursor = initial;
    try {
      while (generation.current === run) {
        const response = await window.electronAPI.history.search(cursor);
        if (generation.current !== run) return;
        if (!response.success || !response.data)
          throw new Error(response.error || 'History search failed.');
        const data = response.data;
        // Replaying the first page must reuse its snapshot rather than take a new one.
        const top = pageStarts.current.length - 1;
        if (pageStarts.current[top]?.snapshot === undefined)
          pageStarts.current[top] = {
            ...pageStarts.current[top],
            snapshot: data.snapshot,
            generation: data.generation,
          };
        next.current =
          data.nextBefore === null
            ? undefined
            : {
                ...cursor,
                before: data.nextBefore,
                beforeTime: data.nextBeforeTime!,
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
  const exportAll = async (format: 'json' | 'csv') => {
    if (!started.current) return;
    setStatus('Exporting every match…');
    try {
      const result = await window.electronAPI.history.exportSearch(
        started.current,
        format,
        panelProps.connectionName ?? 'Unknown',
      );
      if (!result.success) throw new Error(result.error || 'Export failed');
      if (!result.data?.saved) return setStatus('Export cancelled.');
      setStatus(
        `Exported ${result.data.count?.toLocaleString()} matches from ${result.data.scanned?.toLocaleString()} scanned records.`,
      );
      panelProps.showFeedback?.(`Search results exported to ${result.data.path}`, 'success');
    } catch (reason) {
      setError((reason as Error).message);
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
            const range = searchRange(windowMs, custom, Date.now());
            if (typeof range === 'string') return setError(range);
            void scan(
              {
                connectionId,
                topic,
                term,
                mode,
                ...range,
                ...(scope === 'filter' && { scope, filter }),
              },
              'new',
            );
          }}
        >
          <label>
            Payload{' '}
            <input
              className="form-input search-input"
              type="search"
              aria-label="Search message contents"
              value={term}
              maxLength={1024}
              placeholder={mode === 'hex' ? 'Hex bytes, e.g. 00 ff 80' : 'Text (case-sensitive)'}
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
                setMode(event.target.value as 'text' | 'hex' | 'decoded');
              }}
            >
              <option value="text">UTF-8 text</option>
              <option value="hex">Hex bytes</option>
              {(decoders.length > 0 || mode === 'decoded') && (
                <option value="decoded">Decoded protobuf</option>
              )}
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
                if (event.target.value !== 'custom') return setWindowMs(Number(event.target.value));
                setWindowMs('custom');
                // Start from the last hour, unless a custom range was already entered.
                const now = Date.now();
                if (!custom.from)
                  setCustom({ from: localInput(now - 3600000), to: localInput(now) });
              }}
            >
              <option value={300000}>Last 5 minutes</option>
              <option value={3600000}>Last hour</option>
              <option value={DAY}>Retained 24 hours</option>
              <option value="custom">Custom range</option>
            </select>
          </label>
          {windowMs === 'custom' && (
            <>
              <label>
                From{' '}
                <input
                  className="form-input"
                  type="datetime-local"
                  step={1}
                  aria-label="Search from"
                  value={custom.from}
                  onChange={(event) => {
                    reset();
                    setCustom({ ...custom, from: event.target.value });
                  }}
                />
              </label>
              <label>
                To{' '}
                <input
                  className="form-input"
                  type="datetime-local"
                  step={1}
                  aria-label="Search to"
                  value={custom.to}
                  onChange={(event) => {
                    reset();
                    setCustom({ ...custom, to: event.target.value });
                  }}
                />
              </label>
            </>
          )}
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
            disabled={busy || !active || pageStarts.current.length < 2}
            onClick={() => {
              pageStarts.current.pop();
              void scan(pageStarts.current.at(-1)!, 'newer');
            }}
          >
            Newer matches
          </button>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={busy || !active || !next.current}
            onClick={() => next.current && void scan(next.current, 'older')}
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
            {mode === 'decoded'
              ? `${stats.binary.toLocaleString()} payloads without a matching decoder, or that did not decode, were skipped.`
              : `${stats.binary.toLocaleString()} non-UTF-8 payloads skipped in text mode. Use hex to search their bytes.`}
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
        onExportAll={started.current && !busy ? exportAll : undefined}
        exportAllLabel="Export all matches as"
        selectedTopic={{ topicPath: scope === 'filter' ? filter : topic, connectionId }}
        messages={messages}
        storedPage
      />
    </div>
  );
}
