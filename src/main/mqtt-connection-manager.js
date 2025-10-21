const mqtt = require('mqtt');
const fs = require('fs');
const { EventEmitter } = require('events');

class MQTTConnection extends EventEmitter {
  constructor(id, config) {
    super();
    this.id = id;
    this.config = config;
    this.client = null;
    this.isConnected = false;
    this.subscriptions = new Map();
    this.eventHandlers = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.isDestroyed = false;
    this.connectionStats = {
      messagesReceived: 0,
      messagesPublished: 0,
      connectionStartTime: null,
      lastMessageTime: null,
      bytesReceived: 0,
      bytesSent: 0
    };
  }

connect() {
  return new Promise((resolve, reject) => {
    if (this.isDestroyed) {
      reject(new Error('Connection has been destroyed'));
      return;
    }

    try {
      // Build the complete broker URL including WebSocket path
      let brokerUrl = this.config.brokerUrl;
      
      // For WebSocket connections, ensure the path is included
      if ((this.config.brokerUrl.startsWith('ws://') || this.config.brokerUrl.startsWith('wss://')) && this.config.wsPath) {
        const url = new URL(this.config.brokerUrl);
        if (!url.pathname || url.pathname === '/') {
          // If no path in the URL, add the wsPath
          const path = this.config.wsPath.startsWith('/') ? this.config.wsPath : `/${this.config.wsPath}`;
          brokerUrl = `${url.protocol}//${url.host}${path}`;
        }
      }

      console.log(`Connecting to broker: ${brokerUrl}`);

      const options = {
        clientId: this.config.clientId || `mqttlooter_${Math.random().toString(36).substr(2, 9)}`,
        clean: this.config.clean !== undefined ? this.config.clean : true,
        keepalive: this.config.keepalive || 60,
        connectTimeout: this.config.connectTimeout || 30000,
        reconnectPeriod: 0,
        protocolVersion: this.config.protocolVersion || 4
      };

      // Authentication
      if (this.config.username) options.username = this.config.username;
      if (this.config.password) options.password = this.config.password;

      // TLS/SSL Configuration
      if (this.config.tls && (this.config.tls.enabled || 
          brokerUrl.startsWith('mqtts://') || 
          brokerUrl.startsWith('wss://'))) {
        
        options.rejectUnauthorized = this.config.tls.rejectUnauthorized !== undefined 
          ? this.config.tls.rejectUnauthorized 
          : true;

        // Server name for SNI
        if (this.config.tls.servername) {
          options.servername = this.config.tls.servername;
        }

        // CA Certificate
        if (this.config.tls.ca && this.config.tls.ca.content) {
          options.ca = Buffer.from(this.config.tls.ca.content, 'utf8');
        }

        // Client Certificate
        if (this.config.tls.cert && this.config.tls.cert.content) {
          options.cert = Buffer.from(this.config.tls.cert.content, 'utf8');
        }

        // Private Key
        if (this.config.tls.key && this.config.tls.key.content) {
          options.key = Buffer.from(this.config.tls.key.content, 'utf8');
          
          // Private Key Passphrase
          if (this.config.tls.passphrase) {
            options.passphrase = this.config.tls.passphrase;
          }
        }

        // ALPN Protocols (if specified)
        if (this.config.tls.alpnProtocols && this.config.tls.alpnProtocols.length > 0) {
          options.ALPNProtocols = this.config.tls.alpnProtocols;
        }

        console.log(`TLS configuration applied for connection ${this.id}:`, {
          rejectUnauthorized: options.rejectUnauthorized,
          hasCa: !!options.ca,
          hasCert: !!options.cert,
          hasKey: !!options.key,
          hasPassphrase: !!options.passphrase,
          servername: options.servername
        });
      }

      // WebSocket specific options
      if (brokerUrl.startsWith('ws://') || brokerUrl.startsWith('wss://')) {
        console.log(`WebSocket connection with path: ${this.config.wsPath || 'default'}`);
        
        // Additional WebSocket options can be added here if needed
        // For example, custom headers, protocols, etc.
        if (this.config.wsHeaders) {
          options.wsOptions = {
            headers: this.config.wsHeaders
          };
        }
      }

      // Last Will and Testament
      if (this.config.willEnabled && this.config.willTopic && this.config.willMessage) {
        options.will = {
          topic: this.config.willTopic,
          payload: this.config.willMessage,
          qos: this.config.willQos || 0,
          retain: this.config.willRetain || false
        };

        // MQTT 5.0 will properties
        if (this.config.protocolVersion === 5) {
          options.will.properties = {};
          if (this.config.willDelayInterval > 0) {
            options.will.properties.willDelayInterval = this.config.willDelayInterval;
          }
          if (this.config.willMessageExpiryInterval > 0) {
            options.will.properties.messageExpiryInterval = this.config.willMessageExpiryInterval;
          }
        }
      }

      // MQTT 5.0 specific handling
      if (this.config.protocolVersion === 5) {
        options.cleanStart = options.clean;
        delete options.clean;
        
        // MQTT 5.0 properties
        if (this.config.sessionExpiryInterval > 0 || 
            this.config.receiveMaximum !== 65535 || 
            this.config.maximumPacketSize !== 268435455 ||
            this.config.topicAliasMaximum > 0 ||
            this.config.requestResponseInformation ||
            !this.config.requestProblemInformation) {
          
          options.properties = {};
          if (this.config.sessionExpiryInterval > 0) {
            options.properties.sessionExpiryInterval = this.config.sessionExpiryInterval;
          }
          if (this.config.receiveMaximum !== 65535) {
            options.properties.receiveMaximum = this.config.receiveMaximum;
          }
          if (this.config.maximumPacketSize !== 268435455) {
            options.properties.maximumPacketSize = this.config.maximumPacketSize;
          }
          if (this.config.topicAliasMaximum > 0) {
            options.properties.topicAliasMaximum = this.config.topicAliasMaximum;
          }
          if (this.config.requestResponseInformation) {
            options.properties.requestResponseInformation = true;
          }
          if (!this.config.requestProblemInformation) {
            options.properties.requestProblemInformation = false;
          }
        }
      }

      const connectionTimeout = setTimeout(() => {
        if (this.client) this.client.end(true);
        reject(new Error(`Connection timeout after ${options.connectTimeout}ms`));
      }, options.connectTimeout);

      // Use the complete broker URL with WebSocket path
      this.client = mqtt.connect(brokerUrl, options);

        if (!this.client) {
          clearTimeout(connectionTimeout);
          reject(new Error('MQTT client creation failed'));
          return;
        }

        const connectHandler = async (connack) => {
          clearTimeout(connectionTimeout);
          if (this.isDestroyed) return;
          
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.connectionStats.connectionStartTime = Date.now();
          
          const connectionData = {
            id: this.id,
            connack,
            protocolVersion: this.config.protocolVersion || 4
          };

          // Auto-subscribe to configured topics
          if (this.config.subscriptions && Array.isArray(this.config.subscriptions)) {
            for (const subscription of this.config.subscriptions) {
              if (subscription.topic && subscription.topic.trim()) {
                try {
                  await this.subscribe(subscription.topic, subscription.qos || 0);
                } catch (error) {
                  console.error(`Failed to auto-subscribe to ${subscription.topic}:`, error);
                }
              }
            }
          }

          this.emit('connected', connectionData);
          resolve(connectionData);
        };

        const errorHandler = (error) => {
          clearTimeout(connectionTimeout);
          if (this.isDestroyed) return;
          
          this.emit('error', { 
            id: this.id, 
            error: error.message,
            code: error.code,
            protocolVersion: this.config.protocolVersion
          });
          
          if (!this.isConnected) {
            reject(error);
          }
        };

        const closeHandler = () => {
          clearTimeout(connectionTimeout);
          if (this.isDestroyed) return;
          
          this.isConnected = false;
          this.emit('disconnected', { id: this.id });
        };

        const messageHandler = (topic, message, packet) => {
          if (this.isDestroyed) return;
          
          this.connectionStats.messagesReceived++;
          this.connectionStats.lastMessageTime = Date.now();
          this.connectionStats.bytesReceived += message.length;

          this.emit('message', {
            id: this.id,
            topic,
            message: message.toString(),
            packet,
            timestamp: Date.now(),
            qos: packet.qos,
            retain: packet.retain,
            protocolVersion: this.config.protocolVersion || 4
          });
        };

        // Store and attach handlers
        this.eventHandlers.set('connect', connectHandler);
        this.eventHandlers.set('error', errorHandler);
        this.eventHandlers.set('close', closeHandler);
        this.eventHandlers.set('message', messageHandler);

        this.client.on('connect', connectHandler);
        this.client.on('error', errorHandler);
        this.client.on('close', closeHandler);
        this.client.on('message', messageHandler);

      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect() {
    return new Promise((resolve) => {
      this.isDestroyed = true;
      
      if (this.client) {
        this.eventHandlers.forEach((handler, event) => {
          this.client.removeListener(event, handler);
        });
        this.eventHandlers.clear();

        this.client.end(true, {}, () => {
          this.client = null;
          this.isConnected = false;
          this.subscriptions.clear();
          resolve();
        });

        setTimeout(() => {
          if (this.client) {
            this.client = null;
            this.isConnected = false;
            this.subscriptions.clear();
          }
          resolve();
        }, 1000);
      } else {
        resolve();
      }
    });
  }

  subscribe(topic, qos = 0, properties = {}) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.isConnected || this.isDestroyed) {
        reject(new Error('Not connected'));
        return;
      }

      const subscribeOptions = { qos };
      if (this.config.protocolVersion === 5 && Object.keys(properties).length > 0) {
        subscribeOptions.properties = properties;
      }

      this.client.subscribe(topic, subscribeOptions, (err, granted) => {
        if (err) {
          reject(err);
        } else {
          this.subscriptions.set(topic, { qos, properties, granted });
          const subscriptionData = {
            id: this.id,
            topic,
            qos,
            granted,
            protocolVersion: this.config.protocolVersion || 4
          };
          this.emit('subscribed', subscriptionData);
          resolve(subscriptionData);
        }
      });
    });
  }

  unsubscribe(topic, properties = {}) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.isConnected || this.isDestroyed) {
        reject(new Error('Not connected'));
        return;
      }

      const unsubscribeOptions = this.config.protocolVersion === 5 && Object.keys(properties).length > 0 
        ? { properties } 
        : undefined;

      this.client.unsubscribe(topic, unsubscribeOptions, (err) => {
        if (err) {
          reject(err);
        } else {
          this.subscriptions.delete(topic);
          const unsubscriptionData = {
            id: this.id,
            topic,
            protocolVersion: this.config.protocolVersion || 4
          };
          this.emit('unsubscribed', unsubscriptionData);
          resolve(unsubscriptionData);
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
        dup: options.dup || false
      };

      if (this.config.protocolVersion === 5 && options.properties) {
        publishOptions.properties = options.properties;
      }

      this.client.publish(topic, message, publishOptions, (err, packet) => {
        if (err) {
          reject(err);
        } else {
          this.connectionStats.messagesPublished++;
          this.connectionStats.bytesSent += (typeof message === 'string' ? message.length : message.byteLength || 0);
          
          const publishData = {
            id: this.id,
            topic,
            message,
            options: publishOptions,
            timestamp: Date.now(),
            protocolVersion: this.config.protocolVersion || 4
          };
          
          this.emit('published', publishData);
          resolve(publishData);
        }
      });
    });
  }

  getStatus() {
    return {
      id: this.id,
      config: this.config,
      isConnected: this.isConnected,
      subscriptions: Object.fromEntries(this.subscriptions),
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      isDestroyed: this.isDestroyed,
      protocolVersion: this.config.protocolVersion || 4,
      statistics: {
        ...this.connectionStats,
        uptime: this.connectionStats.connectionStartTime 
          ? Date.now() - this.connectionStats.connectionStartTime 
          : 0
      }
    };
  }

  getStatistics() {
    return {
      ...this.connectionStats,
      uptime: this.connectionStats.connectionStartTime 
        ? Date.now() - this.connectionStats.connectionStartTime 
        : 0,
      subscriptionCount: this.subscriptions.size,
      protocolVersion: this.config.protocolVersion || 4
    };
  }
}

class MQTTConnectionManager extends EventEmitter {
  constructor() {
    super();
    this.connections = new Map();
    this.connectionHandlers = new Map();
  }

  createConnection(id, config) {
    if (this.connections.has(id)) {
      throw new Error(`Connection with ID ${id} already exists`);
    }

    const connection = new MQTTConnection(id, config);
    
    const handlers = {};
    ['connected', 'disconnected', 'message', 'error', 'reconnecting', 'subscribed', 'unsubscribed', 'published']
      .forEach(event => {
        const handler = (data) => this.emit(event, data);
        handlers[event] = handler;
        connection.on(event, handler);
      });

    this.connectionHandlers.set(id, handlers);
    this.connections.set(id, connection);
    
    return connection;
  }

  async connect(id, config) {
    let connection = this.connections.get(id);
    
    if (!connection) {
      connection = this.createConnection(id, config);
    } else {
      if (!connection.isConnected) {
        connection.config = config;
      }
    }

    return await connection.connect();
  }

  async disconnect(id) {
    const connection = this.connections.get(id);
    
    if (connection) {
      await connection.disconnect();
      
      const handlers = this.connectionHandlers.get(id);
      if (handlers) {
        Object.entries(handlers).forEach(([event, handler]) => {
          connection.removeListener(event, handler);
        });
        this.connectionHandlers.delete(id);
      }
      
      this.connections.delete(id);
      return true;
    }
    
    return false;
  }

  async subscribe(id, topic, qos = 0, properties = {}) {
    const connection = this.connections.get(id);
    if (!connection) {
      throw new Error(`Connection ${id} not found`);
    }
    return await connection.subscribe(topic, qos, properties);
  }

  async unsubscribe(id, topic, properties = {}) {
    const connection = this.connections.get(id);
    if (!connection) {
      throw new Error(`Connection ${id} not found`);
    }
    return await connection.unsubscribe(topic, properties);
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

  getConnectionStatistics(id) {
    const connection = this.connections.get(id);
    if (!connection) {
      throw new Error(`Connection ${id} not found`);
    }
    return connection.getStatistics();
  }

  getAllStatistics() {
    const stats = {};
    this.connections.forEach((connection, id) => {
      stats[id] = connection.getStatistics();
    });
    return stats;
  }

  async disconnectAll() {
    const disconnectPromises = Array.from(this.connections.keys()).map(id => {
      return this.disconnect(id).catch(error => {
        console.error(`Error disconnecting ${id}:`, error);
      });
    });
    
    await Promise.all(disconnectPromises);
  }

  cleanup() {
    this.disconnectAll();
    this.removeAllListeners();
    this.connectionHandlers.clear();
  }
}

module.exports = {
  MQTTConnectionManager,
  MQTTConnection
};