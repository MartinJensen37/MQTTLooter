class MQTTService {
  constructor() {
    this.connections = new Map();
    this.eventHandlers = new Map();
    this.setupGlobalEventHandlers();
  }

  setupGlobalEventHandlers() {
    if (!window.electronAPI) {
      console.error('ElectronAPI not available');
      return;
    }

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
          connection.isConnected = true;
          connection.status = 'connected';
          break;
        case 'disconnected':
          connection.isConnected = false;
          connection.status = 'disconnected';
          break;
        case 'error':
          connection.status = 'error';
          break;
      }
      
      this.connections.set(connectionId, connection);
    }

    // Call registered handlers
    const handlers = this.eventHandlers.get(`${connectionId}:${eventType}`) || new Set();
    const globalHandlers = this.eventHandlers.get(`*:${eventType}`) || new Set();
    
    [...handlers, ...globalHandlers].forEach(handler => {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error in event handler for ${eventType}:`, error);
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
      console.log(`MQTTService: Connecting ${connectionId}`);
      const result = await window.electronAPI.mqtt.connect(connectionId, config);
      
      if (result.success) {
        connectionData.status = 'connected';
        connectionData.isConnected = true;
        this.connections.set(connectionId, connectionData);
        console.log(`MQTTService: Successfully connected ${connectionId}`);
      } else {
        connectionData.status = 'error';
        connectionData.isConnected = false;
        this.connections.set(connectionId, connectionData);
        console.error(`MQTTService: Failed to connect ${connectionId}:`, result.error);
        throw new Error(result.error);
      }
      
      return result;
    } catch (error) {
      console.error(`MQTTService: Connect error for ${connectionId}:`, error);
      const connectionData = this.connections.get(connectionId);
      if (connectionData) {
        connectionData.status = 'error';
        connectionData.isConnected = false;
        this.connections.set(connectionId, connectionData);
      }
      throw error;
    }
  }

  async disconnect(connectionId) {
    try {
      console.log(`MQTTService: Disconnecting ${connectionId}`);
      const result = await window.electronAPI.mqtt.disconnect(connectionId);
      
      if (result.success) {
        // Update connection status but DON'T remove from connections
        const connection = this.connections.get(connectionId);
        if (connection) {
          connection.isConnected = false;
          connection.status = 'disconnected';
          this.connections.set(connectionId, connection);
          console.log(`MQTTService: Successfully disconnected ${connectionId}, keeping connection config`);
        }
        
        // Clean up connection-specific event handlers (but keep the connection)
        const keysToDelete = [];
        this.eventHandlers.forEach((_, key) => {
          if (key.startsWith(`${connectionId}:`) && !key.startsWith('*:')) {
            keysToDelete.push(key);
          }
        });
        keysToDelete.forEach(key => {
          console.log(`Cleaning up connection-specific event handler: ${key}`);
          this.eventHandlers.delete(key);
        });
      } else {
        console.error(`MQTTService: Failed to disconnect ${connectionId}:`, result.error);
        throw new Error(result.error);
      }
      
      return result;
    } catch (error) {
      console.error(`MQTTService: Disconnect error for ${connectionId}:`, error);
      throw error;
    }
  }

  // New method for completely removing a connection (used by delete function)
  async deleteConnection(connectionId) {
    try {
      console.log(`MQTTService: Deleting connection ${connectionId}`);
      
      // First disconnect if connected
      const connection = this.connections.get(connectionId);
      if (connection?.isConnected) {
        await this.disconnect(connectionId);
      }
      
      // Remove from local connections completely
      this.connections.delete(connectionId);
      
      // Clean up ALL event handlers for this connection
      const keysToDelete = [];
      this.eventHandlers.forEach((_, key) => {
        if (key.startsWith(`${connectionId}:`)) {
          keysToDelete.push(key);
        }
      });
      keysToDelete.forEach(key => {
        console.log(`Cleaning up event handler for deleted connection: ${key}`);
        this.eventHandlers.delete(key);
      });
      
      console.log(`MQTTService: Successfully deleted connection ${connectionId}`);
      return { success: true };
    } catch (error) {
      console.error(`MQTTService: Delete connection error for ${connectionId}:`, error);
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
      console.log('MQTTService: Refreshing connections from main process');
      const result = await window.electronAPI.mqtt.getConnections();
      if (result.success) {
        console.log('MQTTService: Received connections from main:', result.data);
        return result.data;
      }
      throw new Error(result.error);
    } catch (error) {
      console.error('MQTTService: Failed to refresh connections:', error);
      throw error;
    }
  }
}

export default new MQTTService();