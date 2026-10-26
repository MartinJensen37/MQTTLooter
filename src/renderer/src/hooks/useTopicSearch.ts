import { useEffect, useState } from 'react';
import { DISK_HISTORY } from '../../../shared/history';
import { validateSearch, type HistorySearchQuery } from '../../../shared/history-search';
import { TOPIC_VIEW, fromHistory, type TopicMessage } from './useTopicMessages';

export type SearchMode = HistorySearchQuery['mode'];

export interface TopicSearch {
  matches: TopicMessage[];
  /** The search behind `matches`, for exporting every match. */
  query?: HistorySearchQuery;
  searching: boolean;
  scanned: number;
  /** Stored records the search could not read as text, or that were too large. */
  skipped: number;
  error: string;
}

const IDLE: TopicSearch = { matches: [], searching: false, scanned: 0, skipped: 0, error: '' };

/**
 * Searches the whole stored history of one topic, newest first, until `shown` matches are
 * found. Typing restarts the search after a short pause; results do not follow live messages.
 */
export function useTopicSearch(
  connectionId: string | null | undefined,
  topic: string | undefined,
  term: string,
  mode: SearchMode,
  shown: number | 'all',
  active = true,
): TopicSearch {
  const limit = shown === 'all' ? TOPIC_VIEW.maxMessages : shown;
  const [state, setState] = useState<TopicSearch>(IDLE);

  useEffect(() => {
    if (!term || !connectionId || topic === undefined || !active) {
      setState(IDLE);
      return;
    }
    const now = Date.now();
    const query: HistorySearchQuery = {
      connectionId,
      topic,
      term,
      mode,
      from: now - DISK_HISTORY.maxAgeMs,
      to: now,
    };
    try {
      validateSearch(query);
    } catch (reason) {
      setState({ ...IDLE, error: (reason as Error).message });
      return;
    }
    let disposed = false;
    setState({ ...IDLE, query, searching: true });
    const timer = setTimeout(async () => {
      let cursor = query;
      const matches: TopicMessage[] = [];
      let scanned = 0;
      let skipped = 0;
      try {
        while (!disposed && matches.length < limit) {
          const result = await window.electronAPI.history.search(cursor);
          if (disposed) return;
          if (!result.success || !result.data) throw new Error(result.error || 'Search failed.');
          const page = result.data;
          scanned += page.scanned;
          skipped += page.skippedLarge + page.skippedBinary;
          for (const message of page.messages.slice(0, limit - matches.length))
            matches.push(fromHistory(message));
          const done = page.nextBefore === null;
          setState({ matches: [...matches], query, searching: !done, scanned, skipped, error: '' });
          if (done) return;
          cursor = {
            ...query,
            before: page.nextBefore!,
            beforeTime: page.nextBeforeTime!,
            snapshot: page.snapshot,
            generation: page.generation,
          };
          // Bounded worker requests, with a pause so capture and other readers keep running.
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        if (!disposed) setState((previous) => ({ ...previous, searching: false }));
      } catch (reason) {
        if (!disposed)
          setState({
            matches,
            query,
            searching: false,
            scanned,
            skipped,
            error: (reason as Error).message,
          });
      }
    }, 300);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [connectionId, topic, term, mode, limit, active]);

  return state;
}
