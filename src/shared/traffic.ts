import type { PayloadEncoding } from './payload';

export interface IncomingPublish {
  id: string;
  sessionId: string;
  sequence: number;
  topic: string;
  message: string;
  encoding: PayloadEncoding;
  byteLength: number;
  timestamp: number;
  qos: number;
  retain: boolean;
  properties?: Record<string, unknown>;
  protocolVersion: number;
}

export interface DeliveryCounts {
  received: number;
  processed: number;
  dropped: number;
}

export interface MessageBatch {
  batchId: number;
  messages: IncomingPublish[];
  dropped: Record<string, number>;
}

export interface TrafficStatus {
  connections: Record<string, DeliveryCounts>;
  pendingMessages: number;
  pendingBytes: number;
  inFlightMessages: number;
  inFlightBytes: number;
  /** Topics whose newest message waits in the coalescing overflow. */
  coalescedTopics: number;
  maxMessages: number;
  maxBytes: number;
}

export const DELIVERY_LIMITS = {
  maxMessages: 8192,
  maxBytes: 8 * 1024 * 1024,
  batchMessages: 128,
  batchBytes: 256 * 1024,
  flushMs: 40,
};

/**
 * Renderer delivery beyond the queue keeps each topic's newest message, so a retained flood or
 * a burst still ends with every topic's latest value. Superseded updates count as dropped.
 */
export const DELIVERY_COALESCE = { maxTopics: 32768, maxBytes: 8 * 1024 * 1024 };

/** Estimated structured-clone storage, including binary MQTT 5 properties. */
export function publishStorageBytes(message: IncomingPublish): number {
  return (
    256 +
    (message.id.length + message.topic.length + message.message.length) * 2 +
    (message.properties ? JSON.stringify(message.properties).length * 2 : 0)
  );
}
