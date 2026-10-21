import TopicNode from './TopicNode';
import { CONNECTION_HISTORY } from '../../config';
import type { PayloadEncoding } from '../../../../shared/payload';

export type TopicNodeJSON = ReturnType<TopicNode['toJSON']>;

export interface FlattenedNode extends TopicNodeJSON {
  depth: number;
  hasChildren: boolean;
}

class TopicTree {
  connectionId: string;
  root: TopicNode;
  topicLookup = new Map<string, TopicNode>(); // O(1) topic → leaf lookups
  messageCount = 0;
  createdAt = Date.now();
  private sequence = 0;
  private nodeCount = 0;
  private retainedBytes = 0;
  private retainedMessages = 0;
  discardedMessages = 0;
  evictedTopics = 0;
  limitVersion = 0;

  private nodeBytes(node: TopicNode): number {
    return 256 + 2 * (node.name.length + node.fullPath.length);
  }

  constructor(
    connectionId: string,
    readonly limits = { ...CONNECTION_HISTORY },
  ) {
    if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 1))
      throw new RangeError('History limits must be positive integers');
    this.connectionId = connectionId;
    this.root = new TopicNode('', '');
  }

  addMessage(
    topic: string,
    message: string,
    qos = 0,
    retain = false,
    timestamp = Date.now(),
    encoding: PayloadEncoding = 'utf8',
  ) {
    this.messageCount++;
    const leafNode = this.getOrCreateNode(topic);
    if (!leafNode) {
      this.discardedMessages++;
      this.limitVersion++;
      return undefined;
    }
    const beforeBytes = leafNode.messageHistory.storageUsage;
    const beforeCount = leafNode.messageHistory.count;
    leafNode.addMessage(
      { payload: message, encoding, qos, retain, topic, timestamp },
      timestamp,
      ++this.sequence,
    );
    this.retainedBytes += leafNode.messageHistory.storageUsage - beforeBytes;
    this.retainedMessages += leafNode.messageHistory.count - beforeCount;
    const discarded = beforeCount + 1 - leafNode.messageHistory.count;
    this.discardedMessages += discarded;
    if (discarded) this.limitVersion++;
    // Map insertion order is least-recently-received first.
    this.topicLookup.delete(topic);
    this.topicLookup.set(topic, leafNode);
    while (
      this.retainedBytes > this.limits.maxBytes ||
      this.retainedMessages > this.limits.maxMessages
    ) {
      if (!this.evictOldestTopic()) break;
    }
    return this.topicLookup.get(topic);
  }

  private getOrCreateNode(topicPath: string): TopicNode | undefined {
    const cached = this.topicLookup.get(topicPath);
    if (cached) return cached;
    const parts = topicPath.split('/');
    if (parts.length > this.limits.maxDepth || parts.length > this.limits.maxNodes)
      return undefined;
    const missingNodes = () => {
      let current = this.root;
      for (let i = 0; i < parts.length; i++) {
        const next = current.children.get(parts[i]);
        if (!next) return parts.length - i;
        current = next;
      }
      return 0;
    };
    while (this.nodeCount + missingNodes() > this.limits.maxNodes) {
      if (!this.evictOldestTopic()) return undefined;
    }
    let currentNode = this.root;
    for (const part of parts) {
      const existing = currentNode.children.get(part);
      if (existing) currentNode = existing;
      else {
        currentNode = currentNode.addChild(part);
        this.nodeCount++;
        this.retainedBytes += this.nodeBytes(currentNode);
      }
    }
    this.topicLookup.set(topicPath, currentNode);
    return currentNode;
  }

  private evictOldestTopic(): boolean {
    const entry = this.topicLookup.entries().next().value;
    if (!entry) return false;
    const [path, node] = entry;
    this.topicLookup.delete(path);
    this.discardedMessages += node.messageHistory.count;
    this.retainedMessages -= node.messageHistory.count;
    this.retainedBytes -= node.messageHistory.storageUsage;
    node.clearMessages();
    this.evictedTopics++;
    this.limitVersion++;
    let current = node;
    // Preserve parents that still own direct messages or descendants.
    while (
      current.parent &&
      current.children.size === 0 &&
      !this.topicLookup.has(current.fullPath)
    ) {
      this.nodeCount--;
      this.retainedBytes -= this.nodeBytes(current);
      const parent = current.parent;
      parent.children.delete(current.name);
      current = parent;
    }
    return true;
  }

  getNode(topicPath: string): TopicNode | undefined {
    return this.topicLookup.get(topicPath) ?? this.findNodeByPath(topicPath) ?? undefined;
  }

  getFlattenedNodes(includeCollapsed = false): FlattenedNode[] {
    const nodes: FlattenedNode[] = [];

    const traverse = (node: TopicNode, depth = 0) => {
      if (node !== this.root) {
        nodes.push({ ...node.toJSON(), depth, hasChildren: node.children.size > 0 });
      }

      // Recurse when expanded, when collapsed nodes are requested, or at the root.
      if (node.isExpanded || includeCollapsed || node === this.root) {
        const sortedChildren = Array.from(node.children.values()).sort((a, b) =>
          a.name.localeCompare(b.name),
        );
        for (const child of sortedChildren) {
          traverse(child, node === this.root ? 0 : depth + 1);
        }
      }
    };

    traverse(this.root);
    return nodes;
  }

  toggleNode(topicPath: string): boolean {
    const node = this.topicLookup.get(topicPath) ?? this.findNodeByPath(topicPath);
    if (node && node.children.size > 0) {
      node.isExpanded = !node.isExpanded;
      return true;
    }
    return false;
  }

  findNodeByPath(targetPath: string): TopicNode | null {
    const parts = targetPath.split('/');
    let currentNode = this.root;
    for (const part of parts) {
      const child = currentNode.children.get(part);
      if (!child) return null;
      currentNode = child;
    }
    return currentNode;
  }

  expandToDepth(maxDepth: number): void {
    const traverse = (node: TopicNode, depth = 0) => {
      for (const child of node.children.values()) {
        traverse(child, depth + 1);
      }
      // Root carries no expansion state.
      if (node !== this.root) {
        node.isExpanded = maxDepth === 0 ? false : depth < maxDepth;
      }
    };
    traverse(this.root);
  }

  searchTopics(searchTerm: string): TopicNodeJSON[] {
    const results: TopicNodeJSON[] = [];
    const lowerSearch = searchTerm.toLowerCase();
    for (const [topicPath, node] of this.topicLookup) {
      if (
        topicPath.toLowerCase().includes(lowerSearch) ||
        node.lastMessage?.payload.toLowerCase().includes(lowerSearch)
      ) {
        results.push(node.toJSON());
      }
    }
    return results;
  }

  getStatistics() {
    const totalNodes = this.topicLookup.size;
    const leafNodes = Array.from(this.topicLookup.values()).filter(
      (node) => node.hasDirectMessages && node.children.size === 0,
    ).length;
    return {
      connectionId: this.connectionId,
      totalNodes,
      nodeCount: this.nodeCount,
      retainedBytes: this.retainedBytes,
      retainedMessages: this.retainedMessages,
      discardedMessages: this.discardedMessages,
      evictedTopics: this.evictedTopics,
      limits: this.limits,
      leafNodes,
      totalMessages: this.messageCount,
      totalRate: this.root.getTotalMessageRate(),
      createdAt: this.createdAt,
      uptime: Date.now() - this.createdAt,
    };
  }

  updateRates(now = Date.now()): void {
    for (const node of this.topicLookup.values()) node.calculateMessageRate(now);
  }

  clear(): void {
    this.root = new TopicNode('', '');
    this.topicLookup.clear();
    this.messageCount = 0;
    this.nodeCount = 0;
    this.retainedBytes = 0;
    this.retainedMessages = 0;
    this.discardedMessages = 0;
    this.evictedTopics = 0;
    this.limitVersion++;
  }

  export() {
    return {
      connectionId: this.connectionId,
      statistics: this.getStatistics(),
      nodes: this.getFlattenedNodes(true),
      timestamp: Date.now(),
    };
  }

  clearTopicMessages(topicPath: string): boolean {
    const node = this.topicLookup.get(topicPath);
    if (!node) return false;

    const previousCount = node.directMessageCount;
    this.retainedBytes -= node.messageHistory.storageUsage;
    this.retainedMessages -= node.messageHistory.count;
    node.clearMessages();
    this.messageCount = Math.max(0, this.messageCount - previousCount);
    return true;
  }
}

export default TopicTree;
