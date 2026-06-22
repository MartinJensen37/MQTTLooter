import RingBuffer from '../../utils/RingBuffer';
import { MESSAGE_HISTORY } from '../../config';

/** Message handed to a node when a publish arrives. */
export interface IncomingMessage {
  payload: string;
  qos: number;
  retain: boolean;
  topic: string;
  timestamp?: number;
}

/** Message as stored in a node's ring buffer (`length` drives the byte budget). */
export interface StoredMessage {
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
      const childPath = this.fullPath ? `${this.fullPath}/${name}` : name;
      const child = new TopicNode(name, childPath);
      child.parent = this;
      child.level = this.level + 1;
      this.children.set(name, child);
    }
    return this.children.get(name)!;
  }

  addMessage(message: IncomingMessage, timestamp = Date.now()): void {
    // Track interval between messages for the adaptive window.
    if (this.lastMessageTime) {
      this.lastMessageInterval = timestamp - this.lastMessageTime;
      this.updateAdaptiveWindow();
    }

    this.messageCount++;
    this.lastMessage = message;
    this.lastMessageTime = timestamp;
    this.hasDirectMessages = true;

    const payloadLen = message?.payload ? message.payload.length : 0;
    this.messageHistory.add({
      payload: message ? message.payload : null,
      qos: message ? message.qos : 0,
      retain: message ? message.retain : false,
      timestamp,
      topic: message ? message.topic : null,
      length: payloadLen,
    });

    this.calculateMessageRate(timestamp);
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

    // Count ring-buffer entries within the adaptive window (ordered oldest→newest).
    const cutoff = currentTime - this.adaptiveTimeWindow;
    const allMessages = this.messageHistory.toArray();
    let recentCount = 0;
    for (let i = allMessages.length - 1; i >= 0; i--) {
      if (allMessages[i].timestamp >= cutoff) {
        recentCount++;
      } else {
        break;
      }
    }

    if (recentCount === 0) {
      this.messageRate = 0;
      this.lastRateCalculation = currentTime;
      return;
    }

    const windowDurationSeconds = this.adaptiveTimeWindow / 1000;
    const currentRate = recentCount / windowDurationSeconds;

    // Suppress display below 0.01 msg/min.
    const minDisplayRate = 0.01 / 60;
    if (currentRate < minDisplayRate) {
      this.messageRate = 0;
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

    if (this.messageRate === 0 || currentTime - this.lastRateCalculation > this.adaptiveTimeWindow) {
      this.messageRate = currentRate;
    } else {
      this.messageRate = alpha * currentRate + (1 - alpha) * this.messageRate;
    }

    this.lastRateCalculation = currentTime;
  }

  propagateMessageCount(): void {
    let current = this.parent;
    while (current) {
      current.messageCount++; // parents accumulate counts but not rates
      current = current.parent;
    }
  }

  getTotalChildMessages(): number {
    let total = this.hasDirectMessages ? this.messageCount : 0;
    for (const child of this.children.values()) {
      total += child.getTotalChildMessages();
    }
    return total;
  }

  getTotalMessageRate(): number {
    let totalRate = this.hasDirectMessages ? this.messageRate : 0;
    for (const child of this.children.values()) {
      totalRate += child.getTotalMessageRate();
    }
    return totalRate;
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
      lastMessage: this.lastMessage,
      lastMessageTime: this.lastMessageTime,
      isLeaf: this.hasDirectMessages && this.children.size === 0,
      isExpanded: this.isExpanded,
      level: this.level,
      childCount: this.children.size,
      totalMessages: this.getTotalChildMessages(),
      totalRate:
        this.getTotalMessageRate() > 0 ? Math.round(this.getTotalMessageRate() * 1000) / 1000 : 0,
      adaptiveWindow: Math.round((this.adaptiveTimeWindow / 1000) * 10) / 10, // seconds
      averageInterval: Math.round(this.averageInterval),
      bufferCount: this.messageHistory ? this.messageHistory.count : 0,
    };
  }

  clearMessages(): void {
    const previousCount = this.messageCount;

    this.messageCount = 0;
    this.lastMessage = null;
    this.lastMessageTime = null;
    this.messageHistory.clear();
    this.messageRate = 0;
    this.lastRateCalculation = Date.now();
    this.hasDirectMessages = false;

    this.lastMessageInterval = 0;
    this.averageInterval = 0;
    this.intervalSamples = [];
    this.adaptiveTimeWindow = 5000;

    this.propagateMessageCountReduction(previousCount);
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
