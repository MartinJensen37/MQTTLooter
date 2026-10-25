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
  /** 'filter' searches every stored topic of the connection matching an MQTT topic filter. */
  scope?: 'topic' | 'filter';
  filter?: string;
}

/** MQTT topic filter syntax: `+` is one whole level, `#` is a final whole level. */
export function validTopicFilter(filter: unknown): filter is string {
  if (
    typeof filter !== 'string' ||
    !filter.length ||
    filter.length > 65535 ||
    filter.includes('\0')
  )
    return false;
  const levels = filter.split('/');
  return levels.every(
    (level, index) =>
      (!level.includes('+') || level === '+') &&
      (!level.includes('#') || (level === '#' && index === levels.length - 1)),
  );
}

/** MQTT matching, including `a/#` matching `a`; wildcards never match a leading `$` level. */
export function topicMatches(filter: string, topic: string): boolean {
  const filterLevels = filter.split('/');
  const topicLevels = topic.split('/');
  if (topic.startsWith('$') && (filterLevels[0] === '+' || filterLevels[0] === '#')) return false;
  for (let index = 0; index < filterLevels.length; index++) {
    const level = filterLevels[index];
    if (level === '#') return true;
    if (index >= topicLevels.length) return false;
    if (level !== '+' && level !== topicLevels[index]) return false;
  }
  return filterLevels.length === topicLevels.length;
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
  if (query.scope !== undefined && query.scope !== 'topic' && query.scope !== 'filter')
    throw new Error('Choose a search scope.');
  if (query.scope === 'filter' && !validTopicFilter(query.filter))
    throw new Error('Enter an MQTT topic filter, for example sensors/+/temperature or #.');
  if (query.mode === 'hex') {
    const compact = query.term.replace(/\s/g, '');
    if (!compact || compact.length % 2 || !/^[\da-f]+$/i.test(compact))
      throw new Error('Enter complete hexadecimal bytes, for example 00 ff 80.');
  }
}
