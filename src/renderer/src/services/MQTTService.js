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
    
    if (this.connections.has(connectionId)) {
      const connection = this.connections.get(connectionId);
      
      switch (eventType) {
        case 'connected':
          connection.isConnected = true;
          connection.status = 'connected';
          connection.protocolVersion = data.protocolVersion;
          if (data.properties) connection.mqtt5Properties = data.properties;
          break;
        case 'disconnected':
          connection.isConnected = false;
          connection.status = 'disconnected';
          break;
        case 'error':
          connection.status = 'error';
          break;
        case 'reconnecting':
          connection.status = 'reconnecting';
          connection.reconnectAttempt = data.attempt;
          break;
      }
      
      this.connections.set(connectionId, connection);
    }

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

  async connect(connectionId, config) {
    const connectionData = {
      id: connectionId,
      config,
      status: 'connecting',
      isConnected: false,
      createdAt: Date.now(),
      protocolVersion: config.protocolVersion || 4,
      ...(config.protocolVersion === 5 && {
        mqtt5Properties: config.properties || {}
      })
    };

    this.connections.set(connectionId, connectionData);

    try {
      const result = await window.electronAPI.mqtt.connect(connectionId, config);
      
      if (result.success) {
        connectionData.status = 'connected';
        connectionData.isConnected = true;
        connectionData.protocolVersion = result.data?.protocolVersion || config.protocolVersion || 4;
        if (result.data?.properties) {
          connectionData.mqtt5Properties = result.data.properties;
        }
        this.connections.set(connectionId, connectionData);
      } else {
        connectionData.status = 'error';
        connectionData.isConnected = false;
        this.connections.set(connectionId, connectionData);
        throw new Error(result.error);
      }
      
      return result;
    } catch (error) {
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
      const result = await window.electronAPI.mqtt.disconnect(connectionId);
      
      if (result.success) {
        const connection = this.connections.get(connectionId);
        if (connection) {
          connection.isConnected = false;
          connection.status = 'disconnected';
          this.connections.set(connectionId, connection);
        }
        
        const keysToDelete = [];
        this.eventHandlers.forEach((_, key) => {
          if (key.startsWith(`${connectionId}:`) && !key.startsWith('*:')) {
            keysToDelete.push(key);
          }
        });
        keysToDelete.forEach(key => {
          this.eventHandlers.delete(key);
        });
      } else {
        throw new Error(result.error);
      }
      
      return result;
    } catch (error) {
      throw error;
    }
  }

  async deleteConnection(connectionId) {
    try {
      const connection = this.connections.get(connectionId);
      if (connection?.isConnected) {
        await this.disconnect(connectionId);
      }
      
      this.connections.delete(connectionId);
      
      const keysToDelete = [];
      this.eventHandlers.forEach((_, key) => {
        if (key.startsWith(`${connectionId}:`)) {
          keysToDelete.push(key);
        }
      });
      keysToDelete.forEach(key => {
        this.eventHandlers.delete(key);
      });
      
      return { success: true };
    } catch (error) {
      throw error;
    }
  }

  async subscribe(connectionId, topic, qos = 0, properties = {}) {
    return await window.electronAPI.mqtt.subscribe(connectionId, topic, qos, properties);
  }

  async unsubscribe(connectionId, topic, properties = {}) {
    return await window.electronAPI.mqtt.unsubscribe(connectionId, topic, properties);
  }

  async publish(connectionId, data) {
    const { topic, message, qos, retain, properties } = data;
    const options = { 
      qos: qos || 0, 
      retain: retain || false,
      ...(properties && { properties })
    };
    
    const result = await window.electronAPI.mqtt.publish(connectionId, topic, message, options);
    
    if (!result.success) {
      throw new Error(result.error);
    }
    
    return result;
  }

  getConnection(connectionId) {
    return this.connections.get(connectionId);
  }

  getAllConnections() {
    return Array.from(this.connections.values());
  }

  async getConnectionStatistics(connectionId) {
    const result = await window.electronAPI.mqtt.getConnectionStatistics(connectionId);
    if (result.success) {
      return result.data;
    }
    throw new Error(result.error);
  }

  async getAllStatistics() {
    const result = await window.electronAPI.mqtt.getAllStatistics();
    if (result.success) {
      return result.data;
    }
    throw new Error(result.error);
  }
  
  async updateConnectionConfig(connectionId, config) {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.config = config;
      this.connections.set(connectionId, connection);
    }
    return { success: true };
  }

  async refreshConnectionsFromMain() {
    const result = await window.electronAPI.mqtt.getConnections();
    if (result.success) {
      return result.data;
    }
    throw new Error(result.error);
  }

  isConnected(connectionId) {
    const connection = this.connections.get(connectionId);
    return connection?.isConnected || false;
  }

  getProtocolVersion(connectionId) {
    const connection = this.connections.get(connectionId);
    return connection?.protocolVersion || 4;
  }

  supportsMqtt5(connectionId) {
    return this.getProtocolVersion(connectionId) === 5;
  }

  getMqtt5Properties(connectionId) {
    const connection = this.connections.get(connectionId);
    return connection?.mqtt5Properties || {};
  }

}

export default new MQTTService();