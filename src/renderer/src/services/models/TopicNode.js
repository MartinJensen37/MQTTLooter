class TopicNode {
  constructor(name, fullPath = '') {
    this.name = name;
    this.fullPath = fullPath;
    this.children = new Map(); // HashMap for O(1) lookups
    this.parent = null;
    
    // Message tracking
    this.messageCount = 0;
    this.lastMessage = null;
    this.lastMessageTime = null;
    this.messageHistory = []; // For rate calculation
    this.messageRate = 0; // Messages per second
    
    // Tree properties
    this.isLeaf = true; // Has actual messages
    this.isExpanded = false; // UI state
    this.level = 0;
    
    // Rate calculation
    this.rateCalculationWindow = 60000; // 1 minute window
    this.lastRateCalculation = Date.now();
  }

  addChild(name) {
    if (!this.children.has(name)) {
      const childPath = this.fullPath ? `${this.fullPath}/${name}` : name;
      const child = new TopicNode(name, childPath);
      child.parent = this;
      child.level = this.level + 1;
      this.children.set(name, child);
      
      // Update parent's leaf status
      this.isLeaf = false;
    }
    return this.children.get(name);
  }

  addMessage(message, timestamp = Date.now()) {
    this.messageCount++;
    this.lastMessage = message;
    this.lastMessageTime = timestamp;
    this.messageHistory.push(timestamp);
    
    // Clean old messages from history (keep only last minute)
    const cutoff = timestamp - this.rateCalculationWindow;
    this.messageHistory = this.messageHistory.filter(time => time > cutoff);
    
    // Calculate rate
    this.calculateMessageRate(timestamp);
    
    // Propagate count up the tree
    this.propagateMessageCount();
  }

  calculateMessageRate(currentTime = Date.now()) {
    if (currentTime - this.lastRateCalculation > 1000) { // Update every second
      const cutoff = currentTime - this.rateCalculationWindow;
      const recentMessages = this.messageHistory.filter(time => time > cutoff);
      this.messageRate = recentMessages.length / (this.rateCalculationWindow / 1000);
      this.lastRateCalculation = currentTime;
    }
  }

  propagateMessageCount() {
    let current = this.parent;
    while (current) {
      current.messageCount++;
      current.calculateMessageRate();
      current = current.parent;
    }
  }

  getTotalChildMessages() {
    let total = this.isLeaf ? this.messageCount : 0;
    for (const child of this.children.values()) {
      total += child.getTotalChildMessages();
    }
    return total;
  }

  getTotalMessageRate() {
    let totalRate = this.isLeaf ? this.messageRate : 0;
    for (const child of this.children.values()) {
      totalRate += child.getTotalMessageRate();
    }
    return totalRate;
  }

  getPath() {
    return this.fullPath;
  }

  getDisplayName() {
    return this.name || '/';
  }

  toJSON() {
    return {
      name: this.name,
      fullPath: this.fullPath,
      messageCount: this.messageCount,
      messageRate: this.messageRate,
      lastMessage: this.lastMessage,
      lastMessageTime: this.lastMessageTime,
      isLeaf: this.isLeaf,
      isExpanded: this.isExpanded,
      level: this.level,
      childCount: this.children.size,
      totalMessages: this.getTotalChildMessages(),
      totalRate: this.getTotalMessageRate()
    };
  }
}

export default TopicNode;