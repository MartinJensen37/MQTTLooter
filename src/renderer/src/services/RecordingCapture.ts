import type { RecordedMessage, Recording } from '../components/RecordingPanel/recordingPanel/types';
import type { PayloadEncoding } from '../../../shared/payload';

/** A recording owns its messages independently of the browsing history. */
export default class RecordingCapture {
  readonly messages: RecordedMessage[] = [];
  readonly topics = new Set<string>();
  readonly startTime = new Date();
  private bytes = 0;
  incompleteReason?: string;

  constructor(
    readonly connectionId: string,
    readonly connectionName: string,
    readonly maxMessages = 10_000,
    readonly maxBytes = 2 * 1024 * 1024,
  ) {}

  add(data: {
    id: string;
    topic: string;
    message: string;
    encoding?: PayloadEncoding;
    timestamp: number;
    qos: number;
    retain: boolean;
  }): boolean {
    if (data.id !== this.connectionId) return true;
    const message: RecordedMessage = {
      connectionId: data.id,
      topic: data.topic,
      message: data.message,
      encoding: data.encoding ?? 'utf8',
      timestamp: data.timestamp,
      qos: data.qos,
      retain: data.retain,
    };
    const bytes = new TextEncoder().encode(JSON.stringify(message)).byteLength;
    if (this.messages.length >= this.maxMessages || this.bytes + bytes > this.maxBytes)
      return false;
    this.messages.push(message);
    this.topics.add(data.topic);
    this.bytes += bytes;
    return true;
  }

  finish(): Recording | null {
    if (!this.messages.length) return null;
    return {
      id: Date.now(),
      incompleteReason: this.incompleteReason,
      name: `Recording ${this.startTime.toLocaleString()}`,
      startTime: this.startTime,
      endTime: new Date(),
      messageCount: this.messages.length,
      messages: this.messages,
      topic: this.topics.size === 1 ? this.messages[0].topic : `${this.topics.size} Topics`,
      connectionName: this.connectionName,
    };
  }
}
