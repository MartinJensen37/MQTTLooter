import TopicNode from './TopicNode';

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

  constructor(connectionId: string) {
    this.connectionId = connectionId;
    this.root = new TopicNode('', '');
  }

  addMessage(topic: string, message: string, qos = 0, retain = false, timestamp = Date.now()) {
    this.messageCount++;
    const leafNode = this.getOrCreateNode(topic);
    leafNode.addMessage({ payload: message, qos, retain, topic, timestamp }, timestamp);
    return leafNode;
  }

  getOrCreateNode(topicPath: string): TopicNode {
    const cached = this.topicLookup.get(topicPath);
    if (cached) return cached;

    const parts = topicPath.split('/');
    let currentNode = this.root;
    for (const part of parts) {
      if (!currentNode.children.has(part)) {
        currentNode.addChild(part);
      }
      currentNode = currentNode.children.get(part)!;
    }

    this.topicLookup.set(topicPath, currentNode);
    return currentNode;
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
    node.clearMessages();
    this.messageCount = Math.max(0, this.messageCount - previousCount);
    return true;
  }
}

export default TopicTree;
