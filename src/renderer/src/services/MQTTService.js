class MQTTService {
  constructor() {
    this.connections = new Map();
    this.eventHandlers = new Map();
    this.setupGlobalEventHandlers();
  }

  setupGlobalEventHandlers() {
    if (!window.electronAPI) return;

    const eventTypes = ['connected', 'disconnected', 'message', 'error', 'reconnecting', 'subscribed', 'unsubscribed', 'published'];
    
    eventTypes.forEach(eventType => {
      window.electronAPI.mqtt.on(eventType, (data) => {
        this.handleEvent(eventType, data);
      });
    });
  }

  handleEvent(eventType, data) {
    const { id: connectionId } = data;
    
    // Update connection status
    if (this.connections.has(connectionId)) {
      const connection = this.connections.get(connectionId);
      
      switch (eventType) {
        case 'connected':
          connection.status = 'connected';
          connection.isConnected = true;
          break;
        case 'disconnected':
          connection.status = 'disconnected';
          connection.isConnected = false;
          break;
        case 'reconnecting':
          connection.status = 'reconnecting';
          break;
        case 'error':
          connection.status = 'error';
          connection.lastError = data.error;
          break;
      }
    }

    // Call registered handlers
    const handlers = this.eventHandlers.get(`${connectionId}:${eventType}`) || new Set();
    const globalHandlers = this.eventHandlers.get(`*:${eventType}`) || new Set();
    
    [...handlers, ...globalHandlers].forEach(handler => {
      try {
        handler(data);
      } catch (error) {
        console.error('Event handler error:', error);
      }
    });
  }

  // Event handling methods
  on(connectionId, eventType, handler) {
    const key = `${connectionId}:${eventType}`;
    if (!this.eventHandlers.has(key)) {
      this.eventHandlers.set(key, new Set());
    }
    this.eventHandlers.get(key).add(handler);
  }

  onAny(eventType, handler) {
    this.on('*', eventType, handler);
  }

  off(connectionId, eventType, handler) {
    const key = `${connectionId}:${eventType}`;
    const handlers = this.eventHandlers.get(key);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.eventHandlers.delete(key);
      }
    }
  }

  // Connection management
  async connect(connectionId, config) {
    const connectionData = {
      id: connectionId,
      config,
      status: 'connecting',
      isConnected: false,
      createdAt: Date.now()
    };

    this.connections.set(connectionId, connectionData);

    try {
      const result = await window.electronAPI.mqtt.connect(connectionId, config);
      if (!result.success) {
        connectionData.status = 'error';
        connectionData.lastError = result.error;
        throw new Error(result.error);
      }
      return result;
    } catch (error) {
      connectionData.status = 'error';
      connectionData.lastError = error.message;
      throw error;
    }
  }

  async disconnect(connectionId) {
    try {
      const result = await window.electronAPI.mqtt.disconnect(connectionId);
      if (result.success) {
        this.connections.delete(connectionId);
        
        // Clean up event handlers for this connection
        const keysToDelete = [];
        this.eventHandlers.forEach((_, key) => {
          if (key.startsWith(`${connectionId}:`)) {
            keysToDelete.push(key);
          }
        });
        keysToDelete.forEach(key => this.eventHandlers.delete(key));
      }
      return result;
    } catch (error) {
      throw error;
    }
  }

  async subscribe(connectionId, topic, qos = 0) {
    return await window.electronAPI.mqtt.subscribe(connectionId, topic, qos);
  }

  async unsubscribe(connectionId, topic) {
    return await window.electronAPI.mqtt.unsubscribe(connectionId, topic);
  }

  async publish(connectionId, topic, message, options = {}) {
    return await window.electronAPI.mqtt.publish(connectionId, topic, message, options);
  }

  // Connection info
  getConnection(connectionId) {
    return this.connections.get(connectionId);
  }

  getAllConnections() {
    return Array.from(this.connections.values());
  }

  async refreshConnectionsFromMain() {
    try {
      const result = await window.electronAPI.mqtt.getConnections();
      if (result.success) {
        return result.data;
      }
      throw new Error(result.error);
    } catch (error) {
      console.error('Failed to refresh connections:', error);
      throw error;
    }
  }
}

export default new MQTTService();