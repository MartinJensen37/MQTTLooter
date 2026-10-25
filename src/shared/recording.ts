// Shared recording types for main, the storage worker and the RecordingPanel.

export interface RecordedMessage {
  encoding?: import('./payload').PayloadEncoding;
  topic: string;
  message: string; // payload
  qos?: number;
  retain?: boolean;
  timestamp: Date | string | number;
  connectionId?: string;
  protocolVersion?: number;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

/** A complete recording with messages; used for file import and legacy migration. */
export interface Recording {
  id: number;
  name: string;
  startTime: Date;
  endTime: Date;
  messageCount: number;
  messages: RecordedMessage[];
  topic: string;
  connectionName: string;
  incompleteReason?: string;
}

export type RecordingState = 'active' | 'complete' | 'interrupted';

/** Library metadata. Messages are paged separately. */
export interface RecordingSummary {
  id: number;
  name: string;
  connectionId: string | null;
  connectionName: string;
  state: RecordingState;
  startTime: number;
  endTime: number | null;
  messageCount: number;
  payloadBytes: number;
  topicCount: number;
  /** The topic for single-topic recordings, otherwise "N Topics". */
  topic: string;
  dropped: number;
  outages: number;
  incompleteReason?: string;
}

export interface RecordingGap {
  at: number;
  until: number | null;
  kind: 'queue' | 'connection' | 'storage';
  dropped: number;
}

export interface StoredRecordingMessage extends RecordedMessage {
  seq: number;
  timestamp: number;
  encoding: import('./payload').PayloadEncoding;
  qos: number;
  retain: boolean;
}

/** Cursor pages in capture order. `after`/`before` are exclusive sequence numbers. */
export interface RecordingPageQuery {
  recordingId: number;
  after?: number;
  before?: number;
  limit: number;
  topics?: string[];
}

export interface RecordingPage {
  messages: StoredRecordingMessage[];
  /** Continue from this sequence number; null when the end was reached. */
  cursor: number | null;
}

export interface ActiveRecording {
  recordingId: number;
  connectionId: string;
  startTime: number;
  messageCount: number;
  topicCount: number;
  dropped: number;
}

/** A capture that stopped without the user asking, e.g. at the storage limit. */
export interface RecordingNotice {
  id: number;
  recordingId: number;
  connectionId: string;
  reason: string;
}

export interface RecordingStatus {
  active: ActiveRecording[];
  queuedMessages: number;
  notices: RecordingNotice[];
  databaseBytes?: number;
  maxDatabaseBytes: number;
  recovered?: number;
  migrationError?: string;
  error?: string;
}

export type RecordingRequest =
  | { action: 'status' }
  | { action: 'create'; connectionId: string; connectionName: string; name: string; at: number }
  | {
      action: 'append';
      messages: (import('./traffic').IncomingPublish & { recordingId: number })[];
      drops: { recordingId: number; at: number; dropped: number }[];
    }
  | { action: 'finish'; recordingId: number; at: number; reason?: string }
  | {
      action: 'gap';
      recordingId: number;
      at: number;
      kind: RecordingGap['kind'];
      dropped?: number;
    }
  | { action: 'resolve-gaps'; recordingId: number; at: number }
  | { action: 'list' }
  | { action: 'summary'; recordingId: number }
  | { action: 'gaps'; recordingId: number }
  | { action: 'topics'; recordingId: number }
  | { action: 'page'; query: RecordingPageQuery }
  | { action: 'count'; recordingId: number; topics?: string[] }
  | { action: 'rename'; recordingId: number; name: string }
  | { action: 'delete'; recordingId: number }
  | { action: 'import-begin'; path: string }
  | { action: 'import-step'; importId: number }
  | { action: 'import-abort'; importId: number }
  | { action: 'import-legacy'; recordings: unknown[] }
  | { action: 'export-chunk'; recordingId: number; after: number }
  | { action: 'close' };

export const RECORDING_LIMITS = {
  maxDatabaseBytes: 2 * 1024 * 1024 * 1024,
  maxPageMessages: 512,
  pageBytes: 4 * 1024 * 1024,
  maxTopicsListed: 5000,
  maxFilterTopics: 5000,
  /** Rows scanned per filtered page request before returning a partial page. */
  scanRows: 20_000,
  exportRows: 2000,
  exportBytes: 4 * 1024 * 1024,
  maxNameLength: 256,
};

/** Capture queue: larger batches than renderer delivery, since nothing waits on display. */
export const RECORDING_QUEUE = {
  maxMessages: 16_384,
  maxBytes: 16 * 1024 * 1024,
  batchMessages: 1024,
  batchBytes: 1024 * 1024,
  flushMs: 100,
};

import { payloadBytes, type PayloadEncoding } from './payload';

const recordingDate = (value: unknown) => {
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date))
    throw new Error('Invalid recording timestamp');
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw new Error('Invalid recording timestamp');
  return result;
};

/** One recorded message. Exported files name the payload `payload`; saved libraries `message`. */
export function parseRecordedMessage(
  msg: any,
  exported: boolean,
): RecordedMessage & {
  timestamp: Date;
  encoding: PayloadEncoding;
} {
  const payload = exported ? msg?.payload : msg?.message;
  const encoding: PayloadEncoding = msg?.encoding ?? 'utf8';
  if (
    typeof msg?.topic !== 'string' ||
    !msg.topic.length ||
    typeof payload !== 'string' ||
    (msg.qos !== undefined && ![0, 1, 2].includes(msg.qos)) ||
    (msg.retain !== undefined && typeof msg.retain !== 'boolean') ||
    (msg.protocolVersion !== undefined && ![3, 4, 5].includes(msg.protocolVersion)) ||
    (msg.properties !== undefined &&
      (msg.properties === null ||
        typeof msg.properties !== 'object' ||
        Array.isArray(msg.properties)))
  )
    throw new Error('Invalid recorded message');
  payloadBytes(payload, encoding);
  return {
    topic: msg.topic,
    message: payload,
    encoding,
    timestamp: recordingDate(msg.timestamp),
    qos: msg.qos ?? 0,
    retain: msg.retain ?? false,
    connectionId: typeof msg.connectionId === 'string' ? msg.connectionId : undefined,
    ...(msg.protocolVersion !== undefined && { protocolVersion: msg.protocolVersion }),
    ...(msg.properties !== undefined && { properties: msg.properties }),
  };
}

/** Recording metadata: name, times, connection and any incomplete-capture reason. */
export function parseRecordingInfo(info: any) {
  if (!info || typeof info.name !== 'string') throw new Error('Invalid recording metadata');
  return {
    name: info.name,
    incompleteReason:
      typeof info.incompleteReason === 'string' ? info.incompleteReason.slice(0, 512) : undefined,
    startTime: recordingDate(info.startTime),
    endTime: recordingDate(info.endTime),
    connectionName: typeof info.connectionName === 'string' ? info.connectionName : 'Unknown',
  };
}

/** Accept both saved recordings and the exported recordingInfo/payload format. */
export function parseRecording(data: any): Recording {
  const info = data?.recordingInfo ?? data;
  if (!info || !Array.isArray(data.messages) || data.messages.length > 100_000)
    throw new Error('Invalid recording metadata or message list');
  const metadata = parseRecordingInfo(info);
  const messages = data.messages.map((msg: any) =>
    parseRecordedMessage(msg, Boolean(data.recordingInfo)),
  );
  const topics = new Set(messages.map((msg: { topic: string }) => msg.topic));
  return {
    id: Number.isFinite(info.id) ? info.id : Date.now(),
    ...metadata,
    messages,
    messageCount: messages.length,
    topic: topics.size === 1 ? messages[0].topic : `${topics.size} Topics`,
  };
}
