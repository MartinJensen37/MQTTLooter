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
    this.messageTimestamps = []; // Array to store message timestamps for rate calculation
    this.messageRate = 0; // Messages per second
    this.lastRateCalculation = Date.now();

    // Adaptive rate calculation properties
    this.adaptiveTimeWindow = 5000; // Start with 5 second window (more forgiving)
    this.minTimeWindow = 1000;      // Minimum 1 second for fast topics
    this.maxTimeWindow = 600000;    // Maximum 10 minutes for very slow topics
    this.lastMessageInterval = 0;   // Time between last two messages
    this.averageInterval = 0;       // Running average of intervals
    this.intervalSamples = [];      // Sample intervals for adaptive calculation

    // Tree properties
    this.hasDirectMessages = false; // True if this node has received messages directly
    this.isExpanded = false; // UI state
    this.level = 0;
  }

  addChild(name) {
    if (!this.children.has(name)) {
      const childPath = this.fullPath ? `${this.fullPath}/${name}` : name;
      const child = new TopicNode(name, childPath);
      child.parent = this;
      child.level = this.level + 1;
      this.children.set(name, child);
    }
    return this.children.get(name);
  }

  addMessage(message, timestamp = Date.now()) {
    // Calculate interval between messages for adaptive window
    if (this.lastMessageTime) {
      this.lastMessageInterval = timestamp - this.lastMessageTime;
      this.updateAdaptiveWindow();
    }

    this.messageCount++;
    this.lastMessage = message;
    this.lastMessageTime = timestamp;
    this.hasDirectMessages = true; // Mark this node as having direct messages

    // Add timestamp for rate calculation
    this.messageTimestamps.push(timestamp);

    // Keep only recent timestamps within the adaptive window + buffer
    const cutoff = timestamp - (this.adaptiveTimeWindow * 2); // Increased buffer
    this.messageTimestamps = this.messageTimestamps.filter(ts => ts > cutoff);

    // Calculate rate immediately for instant feedback
    this.calculateMessageRate(timestamp);

    // Propagate count up the tree (but don't mark parents as direct message nodes)
    this.propagateMessageCount();
  }

  updateAdaptiveWindow() {
    // Add current interval to samples
    this.intervalSamples.push(this.lastMessageInterval);

    // Keep only last 5 samples for running average (reduced for faster adaptation)
    if (this.intervalSamples.length > 5) {
      this.intervalSamples = this.intervalSamples.slice(-5);
    }

    // Calculate average interval
    this.averageInterval = this.intervalSamples.reduce((sum, interval) => sum + interval, 0) / this.intervalSamples.length;

    // Adaptive time window based on message frequency - more generous windows
    if (this.averageInterval < 200) {
      // Very fast messages (>5/sec) - use minimum window
      this.adaptiveTimeWindow = this.minTimeWindow;
    } else if (this.averageInterval < 2000) {
      // Fast messages (0.5-5/sec) - scale window
      this.adaptiveTimeWindow = Math.max(this.minTimeWindow, this.averageInterval * 3);
    } else if (this.averageInterval < 30000) {
      // Medium messages (1/30sec to 0.5/sec) - scale window
      this.adaptiveTimeWindow = Math.min(60000, this.averageInterval * 3);
    } else if (this.averageInterval < 300000) {
      // Slow messages (1/5min to 1/30sec) - scale window
      this.adaptiveTimeWindow = Math.min(this.maxTimeWindow, this.averageInterval * 2);
    } else {
      // Very slow messages - use maximum window
      this.adaptiveTimeWindow = this.maxTimeWindow;
    }
  }

  calculateMessageRate(currentTime = Date.now()) {
    // Only nodes with direct messages have a rate
    if (!this.hasDirectMessages) {
      this.messageRate = 0;
      this.lastRateCalculation = currentTime;
      return;
    }

    if (this.messageTimestamps.length === 0) {
      this.messageRate = 0;
      this.lastRateCalculation = currentTime;
      return;
    }

    // Remove old timestamps based on adaptive window
    this.messageTimestamps = this.messageTimestamps.filter(timestamp =>
      currentTime - timestamp <= this.adaptiveTimeWindow
    );

    if (this.messageTimestamps.length === 0) {
      this.messageRate = 0;
      this.lastRateCalculation = currentTime;
      return;
    }

    // Calculate rate: messages in window / window duration in seconds
    const windowDurationSeconds = this.adaptiveTimeWindow / 1000;
    const currentRate = this.messageTimestamps.length / windowDurationSeconds;

    // More relaxed minimum display rate: 0.01 msg/min = 0.000167 msg/sec
    const minDisplayRate = 0.01 / 60;

    // Hide rate if it's too low
    if (currentRate < minDisplayRate) {
      this.messageRate = 0;
      this.lastRateCalculation = currentTime;
      return;
    }

    // Adaptive smoothing based on message frequency
    let alpha;
    if (this.averageInterval < 2000) {
      // Fast messages - more responsive
      alpha = 0.7;
    } else if (this.averageInterval < 30000) {
      // Medium messages - balanced
      alpha = 0.5;
    } else {
      // Slow messages - more stable
      alpha = 0.3;
    }

    // Use exponential smoothing with adaptive alpha
    if (this.messageRate === 0 || currentTime - this.lastRateCalculation > this.adaptiveTimeWindow) {
      // First calculation or been too long - use current rate
      this.messageRate = currentRate;
    } else {
      // Smooth the rate with adaptive response
      this.messageRate = alpha * currentRate + (1 - alpha) * this.messageRate;
    }

    this.lastRateCalculation = currentTime;
  }

  propagateMessageCount() {
    let current = this.parent;
    while (current) {
      current.messageCount++;
      // For parent nodes, do not calculate rate (only direct message nodes have rates)
      current = current.parent;
    }
  }

  getTotalChildMessages() {
    let total = this.hasDirectMessages ? this.messageCount : 0;
    for (const child of this.children.values()) {
      total += child.getTotalChildMessages();
    }
    return total;
  }

  getTotalMessageRate() {
    // Only sum rates of nodes with direct messages
    let totalRate = this.hasDirectMessages ? this.messageRate : 0;
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

  // Helper method to format rate for display
  getFormattedRate() {
    // Only nodes with direct messages display a rate
    if (!this.hasDirectMessages || this.messageRate === 0) return '';

    if (this.messageRate >= 1) {
      // >= 1 msg/sec: show as "X.X msg/s"
      return `${Math.round(this.messageRate * 10) / 10} msg/s`;
    } else if (this.messageRate >= 1/60) {
      // >= 1 msg/min: show as "X.X msg/min"  
      return `${Math.round(this.messageRate * 60 * 10) / 10} msg/min`;
    } else {
      // < 1 msg/min: show as "X.X msg/hr"
      return `${Math.round(this.messageRate * 3600 * 10) / 10} msg/hr`;
    }
  }

  toJSON() {
    return {
      name: this.name,
      fullPath: this.fullPath,
      messageCount: this.messageCount,
      messageRate: (this.hasDirectMessages && this.messageRate > 0) ? Math.round(this.messageRate * 1000) / 1000 : 0,
      formattedRate: this.hasDirectMessages ? this.getFormattedRate() : '',
      lastMessage: this.lastMessage,
      lastMessageTime: this.lastMessageTime,
      isLeaf: this.hasDirectMessages && this.children.size === 0,
      isExpanded: this.isExpanded,
      level: this.level,
      childCount: this.children.size,
      totalMessages: this.getTotalChildMessages(),
      totalRate: this.getTotalMessageRate() > 0 ? Math.round(this.getTotalMessageRate() * 1000) / 1000 : 0,
      // Debug info (can be removed in production)
      adaptiveWindow: Math.round(this.adaptiveTimeWindow / 1000 * 10) / 10, // Window in seconds
      averageInterval: Math.round(this.averageInterval),
      timestampCount: this.messageTimestamps.length
    };
  }
}

export default TopicNode;