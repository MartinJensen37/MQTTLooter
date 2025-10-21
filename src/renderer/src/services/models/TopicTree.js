import TopicNode from './TopicNode.js';

class TopicTree {
  constructor(connectionId) {
    this.connectionId = connectionId;
    this.root = new TopicNode('', ''); // Root node
    this.topicLookup = new Map(); // HashMap for O(1) topic lookups
    this.messageCount = 0;
    this.createdAt = Date.now();
  }

  addMessage(topic, message, qos = 0, retain = false, timestamp = Date.now()) {
    this.messageCount++;
    
    // Get or create the leaf node for this topic
    const leafNode = this.getOrCreateNode(topic);
    
    // Add message to the leaf node
    const messageData = {
      payload: message,
      qos,
      retain,
      timestamp,
      topic
    };
    
    leafNode.addMessage(messageData, timestamp);
    
    return leafNode;
  }

  getOrCreateNode(topicPath) {
    // Check if we already have this exact topic
    if (this.topicLookup.has(topicPath)) {
      return this.topicLookup.get(topicPath);
    }

    // Split topic into parts
    const parts = topicPath.split('/').filter(part => part !== '');
    let currentNode = this.root;

    // Traverse/create the path
    let currentPath = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath += (currentPath ? '/' : '') + part;
      
      // Get or create child node
      if (!currentNode.children.has(part)) {
        currentNode.addChild(part);
      }
      
      currentNode = currentNode.children.get(part);
    }

    // Cache the leaf node for fast lookup
    this.topicLookup.set(topicPath, currentNode);
    return currentNode;
  }

  getNode(topicPath) {
    return this.topicLookup.get(topicPath);
  }

  getFlattenedNodes(includeCollapsed = false) {
    const nodes = [];
    
    const traverse = (node, depth = 0) => {
      if (node !== this.root) { // Skip root
        nodes.push({
          ...node.toJSON(),
          depth,
          hasChildren: node.children.size > 0
        });
      }

      // Show children if node is expanded OR if we want to include collapsed nodes OR if it's root
      if (node.isExpanded || includeCollapsed || node === this.root) {
        // Sort children by name for consistent display
        const sortedChildren = Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name));
        
        for (const child of sortedChildren) {
          traverse(child, node === this.root ? 0 : depth + 1);
        }
      }
    };

    traverse(this.root);
    return nodes;
  }

  // Toggle node expansion
  toggleNode(topicPath) {
    // First try direct lookup
    let node = this.topicLookup.get(topicPath);
    
    // If not found, traverse the tree to find the node
    if (!node) {
      node = this.findNodeByPath(topicPath);
    }
    
    if (node && node.children.size > 0) {
      node.isExpanded = !node.isExpanded;
      return true;
    }
    return false;
  }
    findNodeByPath(targetPath) {
    const parts = targetPath.split('/').filter(part => part !== '');
    let currentNode = this.root;

    for (const part of parts) {
      if (currentNode.children.has(part)) {
        currentNode = currentNode.children.get(part);
      } else {
        return null;
      }
    }

    return currentNode;
  }

    findNodeByPath(targetPath) {
    const parts = targetPath.split('/').filter(part => part !== '');
    let currentNode = this.root;

    for (const part of parts) {
      if (currentNode.children.has(part)) {
        currentNode = currentNode.children.get(part);
      } else {
        return null;
      }
    }

    return currentNode;
  }

  // Expand all nodes up to a certain depth
  expandToDepth(maxDepth) {
    const traverse = (node, depth = 0) => {
      // Always traverse children first to ensure we reach all nodes
      for (const child of node.children.values()) {
        traverse(child, depth + 1);
      }
      
      // Then set expansion state based on depth
      // Skip the root node (it shouldn't have expansion state)
      if (node !== this.root) {
        if (maxDepth === 0) {
          // Collapse all nodes when maxDepth is 0
          node.isExpanded = false;
        } else {
          // Expand nodes that are at depth less than maxDepth
          node.isExpanded = depth < maxDepth;
        }
      }
    };
    
    traverse(this.root);
  }

  // Search topics
  searchTopics(searchTerm) {
    const results = [];
    const lowerSearch = searchTerm.toLowerCase();
    
    for (const [topicPath, node] of this.topicLookup) {
      if (topicPath.toLowerCase().includes(lowerSearch) || 
          (node.lastMessage && node.lastMessage.payload.toLowerCase().includes(lowerSearch))) {
        results.push(node.toJSON());
      }
    }
    
    return results;
  }

  // Get statistics
  getStatistics() {
    const totalNodes = this.topicLookup.size;
    const leafNodes = Array.from(this.topicLookup.values()).filter(node => node.isLeaf).length;
    const totalMessages = this.messageCount;
    const totalRate = this.root.getTotalMessageRate();
    
    return {
      connectionId: this.connectionId,
      totalNodes,
      leafNodes,
      totalMessages,
      totalRate,
      createdAt: this.createdAt,
      uptime: Date.now() - this.createdAt
    };
  }

  // Clear all data
  clear() {
    this.root = new TopicNode('', '');
    this.topicLookup.clear();
    this.messageCount = 0;
  }

  // Export tree data
  export() {
    return {
      connectionId: this.connectionId,
      statistics: this.getStatistics(),
      nodes: this.getFlattenedNodes(true),
      timestamp: Date.now()
    };
  }

  clearTopicMessages(topicPath) {
    // Get the node for this topic
    const node = this.topicLookup.get(topicPath);
    if (!node) {
      return false; // Topic not found
    }
    
    // Store the previous count for tree statistics
    const previousCount = node.messageCount;
    
    // Clear messages from the node
    node.clearMessages();
    
    // Update the tree's total message count
    this.messageCount = Math.max(0, this.messageCount - previousCount);
    
    return true;
  }
   
}

export default TopicTree;