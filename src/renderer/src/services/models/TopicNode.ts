import RingBuffer from '../../utils/RingBuffer';
import { MESSAGE_HISTORY } from '../../config';
import { payloadBytes, type PayloadEncoding } from '../../../../shared/payload';
import { serializeProperties } from '../../../../shared/history';

const RATE_BUCKET_MS = 100;

/** Message handed to a node when a publish arrives. */
export interface IncomingMessage {
  /** `sessionId:sequence` from the main process, shared with disk history. */
  key?: string;
  protocolVersion?: number;
  properties?: Record<string, unknown>;
  encoding?: PayloadEncoding;
  payload: string;
  qos: number;
  retain: boolean;
  topic: string;
  timestamp?: number;
}

/** Message as stored in a node's ring buffer (`length` drives the byte budget). */
export interface StoredMessage {
  key?: string;
  protocolVersion?: number;
  properties?: Record<string, unknown>;
  encoding: PayloadEncoding;
  storageBytes: number;
  id: number;
  payload: string | null;
  qos: number;
  retain: boolean;
  timestamp: number;
  topic: string | null;
  length: number;
}

class TopicNode {
  name: string;
  fullPath: string;
  children = new Map<string, TopicNode>(); // O(1) child lookups
  parent: TopicNode | null = null;

  messageCount = 0;
  directMessageCount = 0;
  discardedHistory = 0;
  private sequence = 0;
  private rateBuckets = new Map<number, number>();
  private totalMessageRate = 0;
  lastMessage: IncomingMessage | null = null;
  lastMessageTime: number | null = null;

  messageHistory: RingBuffer<StoredMessage>;

  messageRate = 0; // messages per second
  lastRateCalculation = Date.now();

  // Adaptive rate-window state.
  adaptiveTimeWindow = 5000; // start at 5s (forgiving)
  minTimeWindow = 1000; // floor for fast topics
  maxTimeWindow = 600000; // ceiling for very slow topics
  lastMessageInterval = 0;
  averageInterval = 0;
  intervalSamples: number[] = [];

  hasDirectMessages = false; // node received messages directly (vs. only via children)
  isExpanded = false; // UI state
  level = 0;

  constructor(name: string, fullPath = '') {
    this.name = name;
    this.fullPath = fullPath;
    this.messageHistory = new RingBuffer<StoredMessage>(
      MESSAGE_HISTORY.MAX_ITEMS_PER_TOPIC,
      MESSAGE_HISTORY.MAX_BYTES_PER_TOPIC,
      MESSAGE_HISTORY.COMPACTION_FACTOR,
    );
  }

  addChild(name: string): TopicNode {
    if (!this.children.has(name)) {
      const childPath = this.parent === null ? name : `${this.fullPath}/${name}`;
      const child = new TopicNode(name, childPath);
      child.parent = this;
      child.level = this.level + 1;
      this.children.set(name, child);
    }
    return this.children.get(name)!;
  }

  addMessage(message: IncomingMessage, timestamp = Date.now(), id = ++this.sequence): void {
    // Track interval between messages for the adaptive window.
    if (this.lastMessageTime) {
      this.lastMessageInterval = timestamp - this.lastMessageTime;
      this.updateAdaptiveWindow();
    }

    this.messageCount++;
    this.directMessageCount++;
    this.lastMessageTime = timestamp;
    this.hasDirectMessages = true;

    // Account for the UTF-8 payload, rather than UTF-16 character count.
    const payloadLen = payloadBytes(message.payload, message.encoding).byteLength;
    const propertyJson = serializeProperties(message.properties);
    const properties = propertyJson ? JSON.parse(propertyJson) : undefined;
    // Include normalized property strings and object overhead in both cache budgets.
    const propertyBytes = propertyJson ? propertyJson.length * 4 + 256 : 0;
    const beforeCount = this.messageHistory.count;
    const accepted = this.messageHistory.add({
      id,
      key: message.key,
      encoding: message.encoding ?? 'utf8',
      protocolVersion: message.protocolVersion,
      properties,
      storageBytes: (message.payload.length + message.topic.length) * 2 + 128 + propertyBytes,
      payload: message ? message.payload : null,
      qos: message ? message.qos : 0,
      retain: message ? message.retain : false,
      timestamp,
      topic: message ? message.topic : null,
      length: payloadLen + propertyBytes,
    });
    // No separate unbounded latest-payload cache when history rejects a large message.
    this.lastMessage = accepted ? { ...message, properties } : null;
    this.discardedHistory += beforeCount + 1 - this.messageHistory.count;

    const bucket = Math.floor(timestamp / RATE_BUCKET_MS) * RATE_BUCKET_MS;
    this.rateBuckets.set(bucket, (this.rateBuckets.get(bucket) ?? 0) + 1);
    // Rate estimates must not grow with the lifetime of a busy topic.
    if (this.rateBuckets.size > 128) this.rateBuckets.delete(this.rateBuckets.keys().next().value!);
    this.propagateMessageCount();
  }

  updateAdaptiveWindow(): void {
    this.intervalSamples.push(this.lastMessageInterval);

    // Keep only the last 5 samples for a fast-adapting running average.
    if (this.intervalSamples.length > 5) {
      this.intervalSamples = this.intervalSamples.slice(-5);
    }

    this.averageInterval =
      this.intervalSamples.reduce((sum, interval) => sum + interval, 0) /
      this.intervalSamples.length;

    // Scale the window to message frequency.
    if (this.averageInterval < 200) {
      this.adaptiveTimeWindow = this.minTimeWindow;
    } else if (this.averageInterval < 2000) {
      this.adaptiveTimeWindow = Math.max(this.minTimeWindow, this.averageInterval * 3);
    } else if (this.averageInterval < 30000) {
      this.adaptiveTimeWindow = Math.min(60000, this.averageInterval * 3);
    } else if (this.averageInterval < 300000) {
      this.adaptiveTimeWindow = Math.min(this.maxTimeWindow, this.averageInterval * 2);
    } else {
      this.adaptiveTimeWindow = this.maxTimeWindow;
    }
  }

  calculateMessageRate(currentTime = Date.now()): void {
    if (!this.hasDirectMessages) {
      this.messageRate = 0;
      this.lastRateCalculation = currentTime;
      return;
    }

    // Count time buckets independently of payload eviction. Boundary precision is 100 ms.
    const cutoff = currentTime - this.adaptiveTimeWindow;
    let recentCount = 0;
    for (const [bucket, count] of this.rateBuckets) {
      if (bucket + RATE_BUCKET_MS > cutoff) recentCount += count;
      if (bucket + RATE_BUCKET_MS <= currentTime - this.maxTimeWindow)
        this.rateBuckets.delete(bucket);
    }

    if (recentCount === 0) {
      this.setMessageRate(0);
      this.lastRateCalculation = currentTime;
      return;
    }

    const windowDurationSeconds = this.adaptiveTimeWindow / 1000;
    const currentRate = recentCount / windowDurationSeconds;

    // Suppress display below 0.01 msg/min.
    const minDisplayRate = 0.01 / 60;
    if (currentRate < minDisplayRate) {
      this.setMessageRate(0);
      this.lastRateCalculation = currentTime;
      return;
    }

    // Exponential smoothing, more responsive for faster topics.
    let alpha: number;
    if (this.averageInterval < 2000) {
      alpha = 0.7;
    } else if (this.averageInterval < 30000) {
      alpha = 0.5;
    } else {
      alpha = 0.3;
    }

    if (
      this.messageRate === 0 ||
      currentTime - this.lastRateCalculation > this.adaptiveTimeWindow
    ) {
      this.setMessageRate(currentRate);
    } else {
      this.setMessageRate(alpha * currentRate + (1 - alpha) * this.messageRate);
    }

    this.lastRateCalculation = currentTime;
  }

  private setMessageRate(rate: number): void {
    const delta = rate - this.messageRate;
    this.messageRate = rate;
    this.totalMessageRate = Math.max(0, this.totalMessageRate + delta);
    let node = this.parent;
    while (node) {
      node.totalMessageRate = Math.max(0, node.totalMessageRate + delta);
      node = node.parent;
    }
  }

  propagateMessageCount(): void {
    let current = this.parent;
    while (current) {
      current.messageCount++; // parents accumulate counts but not rates
      current = current.parent;
    }
  }

  getTotalChildMessages(): number {
    return this.messageCount;
  }

  getTotalMessageRate(): number {
    return this.totalMessageRate;
  }

  getPath(): string {
    return this.fullPath;
  }

  getDisplayName(): string {
    return this.name || '/';
  }

  getFormattedRate(): string {
    if (!this.hasDirectMessages || this.messageRate === 0) return '';

    if (this.messageRate >= 1) {
      return `${Math.round(this.messageRate * 10) / 10} msg/s`;
    } else if (this.messageRate >= 1 / 60) {
      return `${Math.round(this.messageRate * 60 * 10) / 10} msg/min`;
    } else {
      return `${Math.round(this.messageRate * 3600 * 10) / 10} msg/hr`;
    }
  }

  toJSON() {
    return {
      name: this.name,
      fullPath: this.fullPath,
      messageCount: this.messageCount,
      messageRate:
        this.hasDirectMessages && this.messageRate > 0
          ? Math.round(this.messageRate * 1000) / 1000
          : 0,
      formattedRate: this.hasDirectMessages ? this.getFormattedRate() : '',
      lastMessage: this.lastMessage
        ? {
            qos: this.lastMessage.qos,
            retain: this.lastMessage.retain,
            topic: this.lastMessage.topic,
            timestamp: this.lastMessage.timestamp,
            encoding: this.lastMessage.encoding,
            protocolVersion: this.lastMessage.protocolVersion,
            payload: this.lastMessage.payload.slice(0, 160),
            truncated: this.lastMessage.payload.length > 160,
          }
        : null,
      lastMessageTime: this.lastMessageTime,
      lastMessageId: this.lastMessage ? (this.messageHistory.last()?.id ?? null) : null,
      isLeaf: this.hasDirectMessages && this.children.size === 0,
      hasDirectMessages: this.hasDirectMessages,
      isExpanded: this.isExpanded,
      level: this.level,
      childCount: this.children.size,
      totalMessages: this.getTotalChildMessages(),
      totalRate:
        this.getTotalMessageRate() > 0 ? Math.round(this.getTotalMessageRate() * 1000) / 1000 : 0,
      adaptiveWindow: Math.round((this.adaptiveTimeWindow / 1000) * 10) / 10, // seconds
      averageInterval: Math.round(this.averageInterval),
      bufferCount: this.messageHistory ? this.messageHistory.count : 0,
      discardedHistory: this.discardedHistory,
    };
  }

  clearMessages(): void {
    const previousCount = this.directMessageCount;

    this.messageCount -= previousCount;
    this.directMessageCount = 0;
    this.discardedHistory = 0;
    this.lastMessage = null;
    this.lastMessageTime = null;
    this.messageHistory.clear();
    this.setMessageRate(0);
    this.rateBuckets.clear();
    this.lastRateCalculation = Date.now();
    this.hasDirectMessages = false;

    this.lastMessageInterval = 0;
    this.averageInterval = 0;
    this.intervalSamples = [];
    this.adaptiveTimeWindow = 5000;

    this.propagateMessageCountReduction(previousCount);
  }

  trimOldestMessage(): StoredMessage | undefined {
    const removed = this.messageHistory.removeOldest();
    if (removed) this.discardedHistory++;
    if (!this.messageHistory.count) this.lastMessage = null;
    return removed;
  }

  propagateMessageCountReduction(countToReduce: number): void {
    let current = this.parent;
    while (current) {
      current.messageCount = Math.max(0, current.messageCount - countToReduce);
      current = current.parent;
    }
  }
}

export default TopicNode;
