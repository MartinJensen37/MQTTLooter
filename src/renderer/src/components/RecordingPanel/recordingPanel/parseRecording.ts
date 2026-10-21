import type { Recording } from './types';
import { payloadBytes, type PayloadEncoding } from '../../../../../shared/payload';

/** Accept both saved recordings and the exported recordingInfo/payload format. */
export function parseRecording(data: any): Recording {
  const info = data?.recordingInfo ?? data;
  if (
    !info ||
    typeof info.name !== 'string' ||
    !Array.isArray(data.messages) ||
    data.messages.length > 100_000
  ) {
    throw new Error('Invalid recording metadata or message list');
  }
  const date = (value: unknown) => {
    if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date))
      throw new Error('Invalid recording timestamp');
    const result = new Date(value);
    if (!Number.isFinite(result.getTime())) throw new Error('Invalid recording timestamp');
    return result;
  };
  const messages = data.messages.map((msg: any) => {
    const payload = data.recordingInfo ? msg?.payload : msg?.message;
    const encoding: PayloadEncoding = msg?.encoding ?? 'utf8';
    if (
      typeof msg?.topic !== 'string' ||
      !msg.topic.length ||
      typeof payload !== 'string' ||
      (msg.qos !== undefined && ![0, 1, 2].includes(msg.qos)) ||
      (msg.retain !== undefined && typeof msg.retain !== 'boolean')
    )
      throw new Error('Invalid recorded message');
    payloadBytes(payload, encoding);
    return {
      topic: msg.topic,
      message: payload,
      encoding,
      timestamp: date(msg.timestamp),
      qos: msg.qos ?? 0,
      retain: msg.retain ?? false,
      connectionId: typeof msg.connectionId === 'string' ? msg.connectionId : undefined,
    };
  });
  const topics = new Set(messages.map((msg: { topic: string }) => msg.topic));
  return {
    id: Number.isFinite(info.id) ? info.id : Date.now(),
    name: info.name,
    startTime: date(info.startTime),
    endTime: date(info.endTime),
    messages,
    messageCount: messages.length,
    topic: topics.size === 1 ? messages[0].topic : `${topics.size} Topics`,
    connectionName: typeof info.connectionName === 'string' ? info.connectionName : 'Unknown',
  };
}
