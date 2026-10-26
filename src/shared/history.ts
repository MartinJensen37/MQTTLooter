import type { IncomingPublish, TrafficStatus } from './traffic';

export const DISK_HISTORY = {
  maxPayloadBytes: 256 * 1024 * 1024,
  maxDatabaseBytes: 512 * 1024 * 1024,
  maxAgeMs: 24 * 60 * 60 * 1000,
  pageMessages: 300,
  pageBytes: 2 * 1024 * 1024,
  /** Larger payloads are sent as a preview of this size; the full payload loads on request. */
  previewBytes: 256 * 1024,
};

/** How long and how much disk history keeps, chosen in Settings. */
export interface HistoryRetention {
  maxAgeMs: number;
  maxPayloadBytes: number;
}
const HOUR = 3_600_000;
const MIB = 1024 * 1024;
export const HISTORY_RETENTION = {
  ages: [HOUR, 6 * HOUR, 24 * HOUR, 7 * 24 * HOUR],
  sizes: [256 * MIB, 1024 * MIB, 4096 * MIB],
};
/** The longest history any choice keeps, which bounds searches. */
export const MAX_HISTORY_AGE_MS = Math.max(...HISTORY_RETENTION.ages);

export const validRetention = (value: unknown): value is HistoryRetention =>
  Boolean(value) &&
  typeof value === 'object' &&
  HISTORY_RETENTION.ages.includes((value as HistoryRetention).maxAgeMs) &&
  HISTORY_RETENTION.sizes.includes((value as HistoryRetention).maxPayloadBytes);

/** Database limits for a retention choice; the file may hold twice the payload in overhead. */
export const retentionLimits = ({ maxAgeMs, maxPayloadBytes }: HistoryRetention) => ({
  ...DISK_HISTORY,
  maxAgeMs,
  maxPayloadBytes,
  maxDatabaseBytes: 2 * maxPayloadBytes,
});

/** Disk writes batch more than renderer delivery; nothing waits on display. */
export const HISTORY_QUEUE = {
  maxMessages: 16_384,
  maxBytes: 16 * 1024 * 1024,
  batchMessages: 1024,
  batchBytes: 1024 * 1024,
  flushMs: 100,
};

/** Messages that never reached disk history, kept as durable gap records. */
export interface HistoryDrop {
  connectionId: string;
  at: number;
  dropped: number;
}

export interface HistoryQuery {
  connectionId: string;
  topic: string;
  before?: number;
  snapshot?: number;
  generation?: number;
}

/** One step of a whole-topic export in capture order, bounded by a fixed snapshot. */
export interface HistoryExportQuery {
  connectionId: string;
  topic: string;
  format: 'json' | 'csv';
  after: number;
  snapshot?: number;
}

export interface HistoryExportChunk {
  text: string;
  count: number;
  cursor: number | null;
  snapshot: number;
}

export interface HistoryMessage extends IncomingPublish {
  rowId: number;
  /** `message` holds the first `previewBytes`; `byteLength` is the full size. */
  truncated?: boolean;
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
  retention: HistoryRetention;
  limits: typeof DISK_HISTORY;
  /** Retained gap records per connection. */
  gaps: Record<string, { dropped: number; last: number }>;
}

export interface HistoryStatus {
  store?: HistoryStoreStatus;
  delivery: TrafficStatus;
  error?: string;
}

export type HistoryRequest =
  | { action: 'append'; messages: IncomingPublish[]; drops?: HistoryDrop[] }
  | { action: 'page'; query: HistoryQuery }
  | { action: 'payload'; rowId: number }
  | { action: 'search'; query: import('./history-search').HistorySearchQuery }
  | { action: 'series'; query: import('./numeric-series').NumericQuery }
  | { action: 'export-chunk'; query: HistoryExportQuery }
  | { action: 'clear'; connectionId: string; topic?: string }
  | { action: 'status' }
  | { action: 'persist'; enabled: boolean }
  | { action: 'retention'; retention: HistoryRetention }
  | { action: 'decoders'; decoders: import('./decoders').DecoderDefinition[] }
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
