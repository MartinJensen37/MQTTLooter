const mqtt = require('mqtt');
const { EventEmitter } = require('events');

class MQTTConnection extends EventEmitter {
  constructor(id, config) {
    super();
    this.id = id;
    this.config = config;
    this.client = null;
    this.isConnected = false;
    this.subscriptions = new Set();
    this.eventHandlers = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3; // Limit reconnection attempts
    this.isDestroyed = false; // Flag to prevent operations on destroyed connections
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (this.isDestroyed) {
        reject(new Error('Connection has been destroyed'));
        return;
      }

      try {
        const options = {
          clientId: this.config.clientId || `mqttlooter_${Math.random().toString(36).substr(2, 9)}`,
          username: this.config.username || undefined,
          password: this.config.password || undefined,
          clean: this.config.clean !== undefined ? this.config.clean : true,
          keepalive: this.config.keepalive || 60,
          connectTimeout: this.config.connectTimeout || 30000,
          // CRITICAL: Limit reconnection attempts and add backoff
          reconnectPeriod: this.config.reconnectPeriod || 5000,
          will: this.config.will || undefined,
          ca: this.config.ca || undefined,
          cert: this.config.cert || undefined,
          key: this.config.key || undefined,
          rejectUnauthorized: this.config.rejectUnauthorized !== undefined ? this.config.rejectUnauthorized : true
        };

        this.client = mqtt.connect(this.config.brokerUrl, options);

        const connectHandler = (connack) => {
          if (this.isDestroyed) return; // Don't proceed if destroyed
          
          console.log(`MQTT Connected: ${this.config.name} (${this.id})`);
          this.isConnected = true;
          this.reconnectAttempts = 0; // Reset counter on successful connection
          
          // Auto-subscribe to configured topics
          this.config.subscriptions?.forEach(sub => {
            this.subscribe(sub.topic, sub.qos || 0).catch(error => {
              console.error(`Auto-subscribe failed for ${sub.topic}:`, error);
              // Don't let subscription errors break the connection
            });
          });

          this.emit('connected', { id: this.id, connack });
          resolve(connack);
        };

        const messageHandler = (topic, message, packet) => {
          if (this.isDestroyed) return;
          
          this.emit('message', {
            id: this.id,
            topic,
            message: message.toString(),
            qos: packet.qos,
            retain: packet.retain,
            timestamp: Date.now()
          });
        };

        const errorHandler = (error) => {
          if (this.isDestroyed) return;
          
          console.error(`MQTT Error (${this.id}):`, error);
          this.reconnectAttempts++;
          
          // Disable further reconnection if max attempts reached
          if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.warn(`Max reconnection attempts (${this.maxReconnectAttempts}) reached for ${this.id}. Disabling reconnection.`);
            if (this.client && this.client.options) {
              this.client.options.reconnectPeriod = 0; // Disable reconnection
            }
          }
          
          this.emit('error', { id: this.id, error: error.message });
          
          // Only reject on first error, not on reconnection errors
          if (this.reconnectAttempts === 1) {
            reject(error);
          }
        };

        const closeHandler = () => {
          if (this.isDestroyed) return;
          
          console.log(`MQTT Disconnected: ${this.id}`);
          this.isConnected = false;
          this.emit('disconnected', { id: this.id });
        };

        const reconnectHandler = () => {
          if (this.isDestroyed) {
            // If connection is destroyed, force end the client
            if (this.client) {
              this.client.end(true);
            }
            return;
          }
          
          this.reconnectAttempts++;
          console.log(`MQTT Reconnecting: ${this.id} (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
          
          // Stop reconnection if max attempts reached
          if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.warn(`Max reconnection attempts reached for ${this.id}. Stopping reconnection.`);
            if (this.client) {
              this.client.options.reconnectPeriod = 0;
              this.client.end(true);
            }
            return;
          }
          
          this.emit('reconnecting', { id: this.id, attempt: this.reconnectAttempts });
        };

        // Store handlers for cleanup
        this.eventHandlers.set('connect', connectHandler);
        this.eventHandlers.set('message', messageHandler);
        this.eventHandlers.set('error', errorHandler);
        this.eventHandlers.set('close', closeHandler);
        this.eventHandlers.set('reconnect', reconnectHandler);

        // Attach handlers
        this.client.on('connect', connectHandler);
        this.client.on('message', messageHandler);
        this.client.on('error', errorHandler);
        this.client.on('close', closeHandler);
        this.client.on('reconnect', reconnectHandler);

      } catch (error) {
        console.error(`Failed to create MQTT connection for ${this.id}:`, error);
        reject(error);
      }
    });
  }

  disconnect() {
    return new Promise((resolve) => {
      console.log(`Disconnecting MQTT connection: ${this.id}`);
      
      // Mark as destroyed to prevent any further operations
      this.isDestroyed = true;
      
      if (this.client) {
        // Disable reconnection immediately
        if (this.client.options) {
          this.client.options.reconnectPeriod = 0;
          this.client.options.maxReconnectTimes = 0;
        }

        // Remove all event listeners before disconnecting
        this.eventHandlers.forEach((handler, event) => {
          this.client.removeListener(event, handler);
        });
        this.eventHandlers.clear();

        // Force end the connection
        this.client.end(true, {}, () => {
          console.log(`MQTT client forcefully disconnected: ${this.id}`);
          this.client = null;
          this.isConnected = false;
          this.subscriptions.clear();
          resolve();
        });
        
        // Fallback timeout in case end() doesn't call callback
        setTimeout(() => {
          if (this.client) {
            console.warn(`Force cleanup timeout for ${this.id}`);
            this.client = null;
            this.isConnected = false;
            this.subscriptions.clear();
          }
          resolve();
        }, 2000);
      } else {
        resolve();
      }
    });
  }

  subscribe(topic, qos = 0) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.isConnected || this.isDestroyed) {
        reject(new Error('Not connected'));
        return;
      }

      this.client.subscribe(topic, { qos }, (err, granted) => {
        if (err) {
          reject(err);
        } else {
          this.subscriptions.add(topic);
          this.emit('subscribed', { id: this.id, topic, qos, granted });
          resolve(granted);
        }
      });
    });
  }

  unsubscribe(topic) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.isConnected || this.isDestroyed) {
        reject(new Error('Not connected'));
        return;
      }

      this.client.unsubscribe(topic, (err) => {
        if (err) {
          reject(err);
        } else {
          this.subscriptions.delete(topic);
          this.emit('unsubscribed', { id: this.id, topic });
          resolve();
        }
      });
    });
  }

  publish(topic, message, options = {}) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.isConnected || this.isDestroyed) {
        reject(new Error('Not connected'));
        return;
      }

      const publishOptions = {
        qos: options.qos || 0,
        retain: options.retain || false,
        ...options
      };

      this.client.publish(topic, message, publishOptions, (err) => {
        if (err) {
          reject(err);
        } else {
          this.emit('published', { id: this.id, topic, message, options: publishOptions });
          resolve();
        }
      });
    });
  }

  getStatus() {
    return {
      id: this.id,
      config: this.config,
      isConnected: this.isConnected,
      subscriptions: Array.from(this.subscriptions),
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      isDestroyed: this.isDestroyed
    };
  }
}

class MQTTConnectionManager extends EventEmitter {
  constructor() {
    super();
    this.connections = new Map();
    this.connectionHandlers = new Map(); // Track forwarded event handlers
  }

  createConnection(id, config) {
    if (this.connections.has(id)) {
      throw new Error(`Connection with ID ${id} already exists`);
    }

    const connection = new MQTTConnection(id, config);
    
    // Create handlers map for this connection
    const handlers = {};
    
    // Forward all events with connection context - but store handlers for cleanup
    ['connected', 'disconnected', 'message', 'error', 'reconnecting', 'subscribed', 'unsubscribed', 'published']
      .forEach(event => {
        const handler = (data) => {
          this.emit(event, data);
        };
        handlers[event] = handler;
        connection.on(event, handler);
      });

    // Store handlers for cleanup
    this.connectionHandlers.set(id, handlers);
    this.connections.set(id, connection);
    
    return connection;
  }

  async connect(id, config) {
    let connection = this.connections.get(id);
    
    if (!connection) {
      connection = this.createConnection(id, config);
    } else {
      // Update config if connection exists but not connected
      if (!connection.isConnected) {
        connection.config = config;
      }
    }

    return await connection.connect();
  }

  async disconnect(id) {
    console.log(`MQTTConnectionManager: Disconnecting connection ${id}`);
    const connection = this.connections.get(id);
    
    if (connection) {
      // Ensure connection is properly disconnected
      await connection.disconnect();
      
      // Clean up forwarded event handlers
      const handlers = this.connectionHandlers.get(id);
      if (handlers) {
        Object.entries(handlers).forEach(([event, handler]) => {
          connection.removeListener(event, handler);
        });
        this.connectionHandlers.delete(id);
      }
      
      // Remove from connections map
      this.connections.delete(id);
      
      console.log(`MQTTConnectionManager: Successfully disconnected and removed ${id}`);
      return true;
    }
    
    console.warn(`MQTTConnectionManager: Connection ${id} not found for disconnection`);
    return false;
  }

  async subscribe(id, topic, qos = 0) {
    const connection = this.connections.get(id);
    if (!connection) {
      throw new Error(`Connection ${id} not found`);
    }
    return await connection.subscribe(topic, qos);
  }

  async unsubscribe(id, topic) {
    const connection = this.connections.get(id);
    if (!connection) {
      throw new Error(`Connection ${id} not found`);
    }
    return await connection.unsubscribe(topic);
  }

  async publish(id, topic, message, options = {}) {
    const connection = this.connections.get(id);
    if (!connection) {
      throw new Error(`Connection ${id} not found`);
    }
    return await connection.publish(topic, message, options);
  }

  getConnection(id) {
    return this.connections.get(id);
  }

  getAllConnections() {
    const connections = {};
    this.connections.forEach((connection, id) => {
      connections[id] = connection.getStatus();
    });
    return connections;
  }

  // Enhanced cleanup method
  async disconnectAll() {
    console.log('MQTTConnectionManager: Disconnecting all connections...');
    const disconnectPromises = Array.from(this.connections.keys()).map(id => {
      return this.disconnect(id).catch(error => {
        console.error(`Error disconnecting ${id}:`, error);
      });
    });
    
    await Promise.all(disconnectPromises);
    console.log('MQTTConnectionManager: All connections disconnected');
  }

  // Clean up method for when the manager itself is destroyed
  cleanup() {
    console.log('Cleaning up MQTTConnectionManager...');
    this.disconnectAll();
    this.removeAllListeners();
    this.connectionHandlers.clear();
  }
}

// Make sure to export the classes properly
module.exports = {
  MQTTConnectionManager,
  MQTTConnection
};