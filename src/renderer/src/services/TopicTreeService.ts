import TopicTree from './models/TopicTree';
import { UI } from '../config';

type MQTTServiceInstance = typeof import('./MQTTService').default;
type EventHandler = (data: any) => void;

interface PendingUpdate {
  topics: Set<string>;
  timer: ReturnType<typeof setTimeout>;
}

/** Display-ready message shape consumed by MessagePanel. */
export interface DisplayMessage {
  id: string;
  connectionId: string;
  topic: string;
  message: string;
  qos: number;
  retain: boolean;
  timestamp: number;
}

class TopicTreeService {
  private topicTrees = new Map<string, TopicTree>();
  private MQTTService: MQTTServiceInstance | null = null;
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private initialized = false;

  // Throttle treeUpdated emissions per connection.
  private _pendingUpdates = new Map<string, PendingUpdate>();
  private _UPDATE_THROTTLE_MS = 150;

  constructor() {
    this.initializeAsync();
  }

  private async initializeAsync(): Promise<void> {
    try {
      // Dynamic import avoids a circular dependency with MQTTService.
      const module = await import('./MQTTService');
      this.MQTTService = module.default;
      this.setupEventListeners();
      this.startRateCalculationTimer();
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize TopicTreeService:', error);
    }
  }

  private setupEventListeners(): void {
    if (!this.MQTTService) return;
    // Only message events here; App owns connection lifecycle.
    this.MQTTService.onAny('message', (data) => this.handleMessage(data));
  }

  private handleMessage(messageData: any): void {
    const { id: connectionId, topic, message, qos, retain, timestamp } = messageData;

    let topicTree = this.topicTrees.get(connectionId);
    if (!topicTree) {
      topicTree = new TopicTree(connectionId);
      this.topicTrees.set(connectionId, topicTree);
      this.emitEvent('treeCreated', { connectionId, tree: topicTree });
    }

    topicTree.addMessage(topic, message, qos, retain, timestamp);

    // Throttle treeUpdated; track which topics changed so listeners can filter.
    if (!this._pendingUpdates.has(connectionId)) {
      const tree = topicTree;
      this._pendingUpdates.set(connectionId, {
        topics: new Set<string>(),
        timer: setTimeout(() => {
          const pending = this._pendingUpdates.get(connectionId);
          this._pendingUpdates.delete(connectionId);
          this.emitEvent('treeUpdated', {
            connectionId,
            topics: pending ? Array.from(pending.topics) : [],
            statistics: tree.getStatistics(),
          });
        }, this._UPDATE_THROTTLE_MS),
      });
    }
    this._pendingUpdates.get(connectionId)!.topics.add(topic);
  }

  /** Emit pre-calculated statistics at a moderate interval (no per-node iteration). */
  private startRateCalculationTimer(): void {
    setInterval(() => {
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

  getTopicTreeNodes(connectionId: string, includeCollapsed = false) {
    const tree = this.topicTrees.get(connectionId);
    return tree ? tree.getFlattenedNodes(includeCollapsed) : [];
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
    tree.clear();
    this.emitEvent('treeCleared', { connectionId });
    return true;
  }

  removeTopicTree(connectionId: string): boolean {
    const removed = this.topicTrees.delete(connectionId);
    if (removed) this.emitEvent('treeRemoved', { connectionId });
    return removed;
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
        id: `${m.timestamp}`,
        connectionId,
        topic: m.topic || topicPath,
        message: m.payload || '',
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
