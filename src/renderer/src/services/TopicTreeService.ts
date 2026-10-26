import TopicTree from './models/TopicTree';
import {
  UI,
  HISTORY_PROFILES,
  HISTORY_BUDGET,
  MESSAGE_HISTORY,
  type HistoryProfile,
} from '../config';
import MQTTService from './MQTTService';
import type { PayloadEncoding } from '../../../shared/payload';

type MQTTServiceInstance = typeof import('./MQTTService').default;
type EventHandler = (data: any) => void;

interface PendingUpdate {
  allTopics: boolean;
  topicChars: number;
  topics: Set<string>;
  timer: ReturnType<typeof setTimeout>;
}

/** Display-ready message shape consumed by MessagePanel. */
export interface DisplayMessage {
  protocolVersion?: number;
  properties?: Record<string, unknown>;
  encoding: PayloadEncoding;
  id: string;
  connectionId: string;
  topic: string;
  message: string;
  qos: number;
  retain: boolean;
  timestamp: number;
}

export class TopicTreeService {
  private profile: HistoryProfile = 'larger';
  private messagesPerTopic = MESSAGE_HISTORY.MAX_ITEMS_PER_TOPIC;
  private topicTrees = new Map<string, TopicTree>();
  private MQTTService: MQTTServiceInstance | null = null;
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private initialized = false;

  // Throttle treeUpdated emissions per connection.
  private _pendingUpdates = new Map<string, PendingUpdate>();
  private _UPDATE_THROTTLE_MS = 150;

  constructor(private globalBudget = HISTORY_BUDGET.maxBytes) {
    try {
      const saved = localStorage.getItem('mqtt-history-profile');
      if (saved === 'compact' || saved === 'larger') this.profile = saved;
      const perTopic = Number(localStorage.getItem('mqtt-messages-per-topic'));
      if (Number.isSafeInteger(perTopic) && perTopic >= 1 && perTopic <= 10_000)
        this.messagesPerTopic = perTopic;
    } catch {
      /* Storage can be unavailable in tests or restricted environments. */
    }
    this.MQTTService = MQTTService;
    this.setupEventListeners();
    this.startRateCalculationTimer();
    this.initialized = true;
  }

  private setupEventListeners(): void {
    if (!this.MQTTService) return;
    // Only message events here; App owns connection lifecycle.
    this.MQTTService.onAny('message', (data) => this.handleMessage(data));
  }

  private handleMessage(messageData: any): void {
    const { id: connectionId, topic, message, qos, retain, timestamp, encoding } = messageData;

    let topicTree = this.topicTrees.get(connectionId);
    if (!topicTree) {
      topicTree = new TopicTree(connectionId, { ...HISTORY_PROFILES[this.profile] });
      topicTree.setMessagesPerTopic(this.messagesPerTopic);
      this.topicTrees.set(connectionId, topicTree);
      this.emitEvent('treeCreated', { connectionId, tree: topicTree });
    }

    const limitVersion = topicTree.limitVersion;
    topicTree.addMessage(topic, message, qos, retain, timestamp, encoding, {
      key:
        messageData.sessionId === undefined
          ? undefined
          : `${messageData.sessionId}:${messageData.sequence}`,
      protocolVersion: messageData.protocolVersion,
      properties: messageData.properties,
    });

    this.queueUpdate(connectionId, topicTree.limitVersion !== limitVersion ? undefined : topic);
    this.enforceGlobalBudget();
  }

  private queueUpdate(connectionId: string, topic?: string): void {
    const topicTree = this.topicTrees.get(connectionId);
    if (!topicTree) return;
    // Throttle treeUpdated; track which topics changed so listeners can filter.
    if (!this._pendingUpdates.has(connectionId)) {
      const tree = topicTree;
      this._pendingUpdates.set(connectionId, {
        allTopics: false,
        topicChars: 0,
        topics: new Set<string>(),
        timer: setTimeout(() => {
          const pending = this._pendingUpdates.get(connectionId);
          this._pendingUpdates.delete(connectionId);
          this.emitEvent('treeUpdated', {
            connectionId,
            topics: pending?.allTopics ? undefined : pending ? Array.from(pending.topics) : [],
            statistics: tree.getStatistics(),
          });
        }, this._UPDATE_THROTTLE_MS),
      });
    }
    const pending = this._pendingUpdates.get(connectionId)!;
    if (
      topic === undefined ||
      pending.topics.size >= 128 ||
      pending.topicChars + (topic?.length ?? 0) > 262144
    ) {
      pending.allTopics = true;
      pending.topics.clear();
      pending.topicChars = 0;
    }
    if (topic !== undefined && !pending.allTopics && !pending.topics.has(topic)) {
      pending.topics.add(topic);
      pending.topicChars += topic.length;
    }
  }

  getHistorySettings() {
    return {
      profile: this.profile,
      maxBytes: this.globalBudget,
      retainedBytes: [...this.topicTrees.values()].reduce(
        (sum, tree) => sum + tree.storageBytes,
        0,
      ),
      maxPinnedTopics: HISTORY_BUDGET.maxPinnedTopics,
      messagesPerTopic: this.messagesPerTopic,
    };
  }

  /** Messages each topic keeps in the live cache, for every connection. */
  setMessagesPerTopic(count: number): boolean {
    if (!Number.isSafeInteger(count) || count < 1 || count > 10_000) return false;
    this.messagesPerTopic = count;
    try {
      localStorage.setItem('mqtt-messages-per-topic', String(count));
    } catch {
      /* Keep this session's setting. */
    }
    for (const [id, tree] of this.topicTrees) {
      tree.setMessagesPerTopic(count);
      this.queueUpdate(id);
    }
    this.emitEvent('historySettingsChanged', this.getHistorySettings());
    return true;
  }

  setHistoryProfile(profile: HistoryProfile): boolean {
    if (profile !== 'compact' && profile !== 'larger') return false;
    const limits = HISTORY_PROFILES[profile];
    if (
      [...this.topicTrees.values()].some(
        (tree) =>
          tree.protectedBytes > limits.maxBytes || tree.protectedNodeCount > limits.maxNodes,
      )
    )
      return false;
    this.profile = profile;
    try {
      localStorage.setItem('mqtt-history-profile', profile);
    } catch {
      /* Keep this session's setting. */
    }
    for (const [id, tree] of this.topicTrees) {
      tree.setLimits({ ...limits });
      this.queueUpdate(id);
    }
    this.enforceGlobalBudget();
    this.emitEvent('historySettingsChanged', this.getHistorySettings());
    return true;
  }

  /** Protect a view's selected topic; `owner` separates the main selection from a pinned pane. */
  selectTopic(connectionId: string, path: string | null, owner?: string): void {
    this.topicTrees.get(connectionId)?.selectTopic(path, owner);
  }

  toggleTopicPin(connectionId: string, path: string): boolean {
    const changed = this.topicTrees.get(connectionId)?.pinTopic(path) ?? false;
    if (changed) this.queueUpdate(connectionId);
    return changed;
  }

  /** Free payloads before catalog entries, across every connection including inactive ones. */
  private enforceGlobalBudget(): void {
    let total = this.getHistorySettings().retainedBytes;
    for (const stage of ['history', 'protectedHistory', 'metadata']) {
      for (const [id, tree] of this.topicTrees) {
        if (total <= this.globalBudget) return;
        const before = tree.storageBytes;
        const target = Math.max(0, before - (total - this.globalBudget));
        if (stage === 'metadata') tree.trimMetadata(target);
        else tree.trimHistory(target, tree.limits.maxMessages, stage === 'protectedHistory');
        total += tree.storageBytes - before;
        if (tree.storageBytes !== before) this.queueUpdate(id);
      }
    }
  }

  /** Recalculate rates on a timer, including idle topics, instead of per message. */
  private startRateCalculationTimer(): void {
    setInterval(() => {
      const now = Date.now();
      this.topicTrees.forEach((tree) => tree.updateRates(now));
      this.emitEvent('ratesUpdated', { trees: this.getAllTreeStatistics() });
    }, UI.RATE_EMIT_INTERVAL_MS);
  }

  on(eventType: string, handler: EventHandler): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    this.eventHandlers.get(eventType)!.add(handler);
  }

  off(eventType: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) this.eventHandlers.delete(eventType);
    }
  }

  private emitEvent(eventType: string, data: any): void {
    const handlers = this.eventHandlers.get(eventType);
    if (!handlers) return;
    handlers.forEach((handler) => {
      try {
        handler(data);
      } catch (error) {
        console.error('TopicTreeService event handler error:', error);
      }
    });
  }

  getTopicTree(connectionId: string): TopicTree | undefined {
    return this.topicTrees.get(connectionId);
  }

  getTopicTreeNodes(connectionId: string, includeCollapsed = false, searchTerm = '') {
    const tree = this.topicTrees.get(connectionId);
    return tree ? tree.getFlattenedNodes(includeCollapsed, searchTerm) : [];
  }

  toggleTopicNode(connectionId: string, topicPath: string): boolean {
    const tree = this.topicTrees.get(connectionId);
    if (!tree) return false;
    const result = tree.toggleNode(topicPath);
    if (result) this.emitEvent('nodeToggled', { connectionId, topicPath });
    return result;
  }

  expandTopicTreeToDepth(connectionId: string, depth: number): boolean {
    const tree = this.topicTrees.get(connectionId);
    if (!tree) return false;
    tree.expandToDepth(depth);
    this.emitEvent('treeExpanded', { connectionId, depth });
    return true;
  }

  searchTopics(connectionId: string, searchTerm: string) {
    const tree = this.topicTrees.get(connectionId);
    return tree ? tree.searchTopics(searchTerm) : [];
  }

  getTopicTreeStatistics(connectionId: string) {
    const tree = this.topicTrees.get(connectionId);
    return tree ? tree.getStatistics() : null;
  }

  getAllTreeStatistics(): Record<string, ReturnType<TopicTree['getStatistics']>> {
    const statistics: Record<string, ReturnType<TopicTree['getStatistics']>> = {};
    this.topicTrees.forEach((tree, connectionId) => {
      statistics[connectionId] = tree.getStatistics();
    });
    return statistics;
  }

  clearTopicTree(connectionId: string): boolean {
    const tree = this.topicTrees.get(connectionId);
    if (!tree) return false;
    this.cancelPendingUpdate(connectionId);
    tree.clear();
    this.emitEvent('treeCleared', { connectionId });
    return true;
  }

  removeTopicTree(connectionId: string): boolean {
    this.cancelPendingUpdate(connectionId);
    const removed = this.topicTrees.delete(connectionId);
    if (removed) this.emitEvent('treeRemoved', { connectionId });
    return removed;
  }

  private cancelPendingUpdate(connectionId: string): void {
    const pending = this._pendingUpdates.get(connectionId);
    if (pending) clearTimeout(pending.timer);
    this._pendingUpdates.delete(connectionId);
  }

  getConnectionIds(): string[] {
    return Array.from(this.topicTrees.keys());
  }

  isReady(): boolean {
    return this.initialized && this.MQTTService !== null;
  }

  /** Messages for a topic, newest-first, mapped to MessagePanel's shape. */
  getTopicMessages(connectionId: string, topicPath: string): DisplayMessage[] {
    const tree = this.topicTrees.get(connectionId);
    if (!tree) return [];
    const node = tree.getNode(topicPath);
    if (!node || !node.messageHistory) return [];
    return node.messageHistory
      .toArray()
      .reverse()
      .map((m) => ({
        id: m.key ?? `${connectionId}:${topicPath}:${m.id}`,
        connectionId,
        topic: m.topic || topicPath,
        message: m.payload || '',
        encoding: m.encoding,
        protocolVersion: m.protocolVersion,
        properties: m.properties,
        qos: m.qos || 0,
        retain: m.retain || false,
        timestamp: m.timestamp,
      }));
  }

  exportAll() {
    const exports: Record<string, ReturnType<TopicTree['export']>> = {};
    this.topicTrees.forEach((tree, connectionId) => {
      exports[connectionId] = tree.export();
    });
    return { timestamp: Date.now(), trees: exports };
  }

  clearTopicMessages(connectionId: string, topicPath: string): boolean {
    const tree = this.topicTrees.get(connectionId);
    if (!tree) return false;

    const success = tree.clearTopicMessages(topicPath);
    if (success) {
      this.emitEvent('topicMessagesCleared', {
        connectionId,
        topicPath,
        statistics: tree.getStatistics(),
      });
      const node = tree.getNode(topicPath);
      if (node) {
        this.emitEvent('treeUpdated', {
          connectionId,
          topic: topicPath,
          node: node.toJSON(),
          statistics: tree.getStatistics(),
        });
      }
    }
    return success;
  }
}

const topicTreeService = new TopicTreeService();
export default topicTreeService;
