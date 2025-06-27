import TopicTree from './models/TopicTree.js';

class TopicTreeService {
  constructor() {
    this.topicTrees = new Map(); // HashMap of topic trees per connection
    this.MQTTService = null;
    this.eventHandlers = new Map();
    this.initialized = false;
    
    // Initialize when MQTTService is available
    this.initializeAsync();
  }

  async initializeAsync() {
    try {
      // Dynamically import MQTTService to avoid circular dependencies
      const module = await import('./MQTTService.js');
      this.MQTTService = module.default;
      this.setupEventListeners();
      this.startRateCalculationTimer();
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize TopicTreeService:', error);
    }
  }

  setupEventListeners() {
    if (!this.MQTTService) return;

    // Listen to MQTT events and build topic trees
    this.MQTTService.onAny('connected', (data) => {
      this.handleConnectionEvent('connected', data);
    });

    this.MQTTService.onAny('disconnected', (data) => {
      this.handleConnectionEvent('disconnected', data);
    });

    this.MQTTService.onAny('message', (data) => {
      this.handleMessage(data);
    });

    this.MQTTService.onAny('error', (data) => {
      this.handleConnectionEvent('error', data);
    });
  }

  handleConnectionEvent(eventType, data) {
    const { id: connectionId } = data;
    
    switch (eventType) {
      case 'connected':
        // Create new topic tree for this connection
        if (!this.topicTrees.has(connectionId)) {
          this.topicTrees.set(connectionId, new TopicTree(connectionId));
        }
        this.emitEvent('treeCreated', { connectionId, tree: this.topicTrees.get(connectionId) });
        break;
        
      case 'disconnected':
        // Keep the tree but mark as disconnected
        this.emitEvent('treeDisconnected', { connectionId });
        break;
        
      case 'error':
        this.emitEvent('treeError', { connectionId, error: data.error });
        break;
    }
  }

  handleMessage(messageData) {
    const { id: connectionId, topic, message, qos, retain, timestamp } = messageData;
    
    // Get or create topic tree for this connection
    let topicTree = this.topicTrees.get(connectionId);
    if (!topicTree) {
      topicTree = new TopicTree(connectionId);
      this.topicTrees.set(connectionId, topicTree);
    }
    
    // Add message to topic tree
    const node = topicTree.addMessage(topic, message, qos, retain, timestamp);
    
    // Emit tree update event
    this.emitEvent('treeUpdated', { 
      connectionId, 
      topic, 
      node: node.toJSON(),
      statistics: topicTree.getStatistics()
    });
  }

  startRateCalculationTimer() {
    // Update message rates every second
    setInterval(() => {
      this.topicTrees.forEach(tree => {
        tree.topicLookup.forEach(node => {
          node.calculateMessageRate();
        });
      });
      
      // Emit rate update event
      this.emitEvent('ratesUpdated', {
        trees: this.getAllTreeStatistics()
      });
    }, 1000);
  }

  // Event system for the service
  on(eventType, handler) {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    this.eventHandlers.get(eventType).add(handler);
  }

  off(eventType, handler) {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.eventHandlers.delete(eventType);
      }
    }
  }

  emitEvent(eventType, data) {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error('TopicTreeService event handler error:', error);
        }
      });
    }
  }

  // Public API methods
  getTopicTree(connectionId) {
    return this.topicTrees.get(connectionId);
  }

  getTopicTreeNodes(connectionId, includeCollapsed = false) {
    const tree = this.topicTrees.get(connectionId);
    return tree ? tree.getFlattenedNodes(includeCollapsed) : [];
  }

  toggleTopicNode(connectionId, topicPath) {
    const tree = this.topicTrees.get(connectionId);
    if (tree) {
      const result = tree.toggleNode(topicPath);
      if (result) {
        this.emitEvent('nodeToggled', { connectionId, topicPath });
      }
      return result;
    }
    return false;
  }

  expandTopicTreeToDepth(connectionId, depth) {
    const tree = this.topicTrees.get(connectionId);
    if (tree) {
      tree.expandToDepth(depth);
      this.emitEvent('treeExpanded', { connectionId, depth });
      return true;
    }
    return false;
  }

  searchTopics(connectionId, searchTerm) {
    const tree = this.topicTrees.get(connectionId);
    return tree ? tree.searchTopics(searchTerm) : [];
  }

  getTopicTreeStatistics(connectionId) {
    const tree = this.topicTrees.get(connectionId);
    return tree ? tree.getStatistics() : null;
  }

  getAllTreeStatistics() {
    const statistics = {};
    this.topicTrees.forEach((tree, connectionId) => {
      statistics[connectionId] = tree.getStatistics();
    });
    return statistics;
  }

  clearTopicTree(connectionId) {
    const tree = this.topicTrees.get(connectionId);
    if (tree) {
      tree.clear();
      this.emitEvent('treeCleared', { connectionId });
      return true;
    }
    return false;
  }

  removeTopicTree(connectionId) {
    const removed = this.topicTrees.delete(connectionId);
    if (removed) {
      this.emitEvent('treeRemoved', { connectionId });
    }
    return removed;
  }

  // Get all connection IDs that have topic trees
  getConnectionIds() {
    return Array.from(this.topicTrees.keys());
  }

  // Check if service is ready
  isReady() {
    return this.initialized && this.MQTTService !== null;
  }

  // Export all trees
  exportAll() {
    const exports = {};
    this.topicTrees.forEach((tree, connectionId) => {
      exports[connectionId] = tree.export();
    });
    return {
      timestamp: Date.now(),
      trees: exports
    };
  }
}

// Create singleton instance
const topicTreeService = new TopicTreeService();

export default topicTreeService;