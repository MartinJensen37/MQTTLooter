import { MAX_HISTORY_AGE_MS, type HistoryPage, type HistoryQuery } from './history';

export const SEARCH_LIMITS = {
  rows: 2000,
  scanBytes: 8 * 1024 * 1024,
  workMs: 25,
  payloadBytes: 256 * 1024,
  /** Larger payloads are searched in chunks, up to this size. */
  streamBytes: 64 * 1024 * 1024,
  chunkBytes: 1024 * 1024,
  resultBytes: 1024 * 1024,
  matches: 100,
  termLength: 1024,
};
export interface HistorySearchQuery extends HistoryQuery {
  term: string;
  /** 'decoded' searches the JSON text of protobuf payloads decoded for each message's topic. */
  mode: 'text' | 'hex' | 'decoded';
  from: number;
  to: number;
  /**
   * Cursor: the last scanned row's receive time, paired with `before` (its id). Searches walk
   * a time index newest first, so a past range is reached without scanning newer rows.
   */
  beforeTime?: number;
}

export interface HistorySearchPage extends HistoryPage {
  /** With `nextBefore`, where the next slice resumes. */
  nextBeforeTime: number | null;
  scanned: number;
  skippedLarge: number;
  skippedBinary: number;
}

/** Shared validation for renderer feedback and the main-process IPC boundary. */
export function validateSearch(query: HistorySearchQuery): void {
  if (
    !query ||
    typeof query.connectionId !== 'string' ||
    !query.connectionId ||
    query.connectionId.length > 256 ||
    typeof query.topic !== 'string' ||
    query.topic.length > 65535 ||
    !Number.isSafeInteger(query.from) ||
    !Number.isSafeInteger(query.to) ||
    query.from < 0 ||
    query.to < query.from ||
    query.to - query.from > MAX_HISTORY_AGE_MS ||
    (query.before === undefined) !== (query.beforeTime === undefined) ||
    ['before', 'beforeTime', 'snapshot', 'generation'].some((key) => {
      const value = query[key as keyof HistorySearchQuery];
      return value !== undefined && (!Number.isSafeInteger(value) || (value as number) < 0);
    })
  )
    throw new Error('Invalid history search topic or cursor.');
  if (
    typeof query.term !== 'string' ||
    !query.term.length ||
    query.term.length > SEARCH_LIMITS.termLength
  )
    throw new Error('Enter between 1 and 1,024 search characters.');
  if (!['text', 'hex', 'decoded'].includes(query.mode))
    throw new Error('Choose text, hex or decoded search.');
  if (query.mode === 'hex') {
    const compact = query.term.replace(/\s/g, '');
    if (!compact || compact.length % 2 || !/^[\da-f]+$/i.test(compact))
      throw new Error('Enter complete hexadecimal bytes, for example 00 ff 80.');
  }
}
