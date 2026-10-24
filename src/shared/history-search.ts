import type { HistoryPage, HistoryQuery } from './history';

export const SEARCH_LIMITS = {
  rows: 2000,
  scanBytes: 8 * 1024 * 1024,
  workMs: 25,
  payloadBytes: 256 * 1024,
  resultBytes: 1024 * 1024,
  matches: 100,
  termLength: 1024,
};
export interface HistorySearchQuery extends HistoryQuery {
  term: string;
  mode: 'text' | 'hex';
  from: number;
  to: number;
}
export interface HistorySearchPage extends HistoryPage {
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
    query.to - query.from > 86400000 ||
    ['before', 'snapshot', 'generation'].some((key) => {
      const value = query[key as keyof HistorySearchQuery];
      return value !== undefined && (!Number.isSafeInteger(value) || (value as number) < 0);
    })
  )
    throw new Error('Invalid history search scope or cursor.');
  if (
    typeof query.term !== 'string' ||
    !query.term.length ||
    query.term.length > SEARCH_LIMITS.termLength
  )
    throw new Error('Enter between 1 and 1,024 search characters.');
  if (query.mode !== 'text' && query.mode !== 'hex') throw new Error('Choose text or hex search.');
  if (query.mode === 'hex') {
    const compact = query.term.replace(/\s/g, '');
    if (!compact || compact.length % 2 || !/^[\da-f]+$/i.test(compact))
      throw new Error('Enter complete hexadecimal bytes, for example 00 ff 80.');
  }
}
