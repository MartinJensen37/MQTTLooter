import type { IncomingPublish, TrafficStatus } from './traffic';

export const DISK_HISTORY = {
  maxPayloadBytes: 256 * 1024 * 1024,
  maxDatabaseBytes: 512 * 1024 * 1024,
  maxAgeMs: 24 * 60 * 60 * 1000,
  pageMessages: 300,
  pageBytes: 2 * 1024 * 1024,
};

export interface HistoryQuery {
  connectionId: string;
  topic: string;
  before?: number;
  snapshot?: number;
  generation?: number;
}

export interface HistoryMessage extends IncomingPublish {
  rowId: number;
}

export interface HistoryPage {
  messages: HistoryMessage[];
  snapshot: number;
  generation: number;
  nextBefore: number | null;
  expired: number;
}

export interface HistoryStoreStatus {
  retainedMessages: number;
  retainedBytes: number;
  databaseBytes: number;
  expired: number;
  generation: number;
  persistent: boolean;
  limits: typeof DISK_HISTORY;
}

export interface HistoryStatus {
  store?: HistoryStoreStatus;
  delivery: TrafficStatus;
  error?: string;
}

export type HistoryRequest =
  | { action: 'append'; messages: IncomingPublish[] }
  | { action: 'page'; query: HistoryQuery }
  | { action: 'search'; query: import('./history-search').HistorySearchQuery }
  | { action: 'series'; query: import('./numeric-series').NumericQuery }
  | { action: 'topics'; connectionId: string; search: string }
  | { action: 'clear'; connectionId: string; topic?: string }
  | { action: 'status' }
  | { action: 'persist'; enabled: boolean }
  | { action: 'close' };

/** Binary properties are explicitly tagged instead of silently converted to number maps. */
export function serializeProperties(properties?: Record<string, unknown>): string | null {
  if (!properties) return null;
  const normalize = (value: unknown): unknown => {
    if (value instanceof Uint8Array) {
      let binary = '';
      for (let i = 0; i < value.length; i += 8192)
        binary += String.fromCharCode(...value.subarray(i, i + 8192));
      return { encoding: 'base64', data: btoa(binary) };
    }
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
    return value;
  };
  return JSON.stringify(normalize(properties));
}
