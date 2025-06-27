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
  }

  connect() {
    return new Promise((resolve, reject) => {
      try {
        const options = {
          clientId: this.config.clientId || `mqttlooter_${Math.random().toString(36).substr(2, 9)}`,
          username: this.config.username || undefined,
          password: this.config.password || undefined,
          clean: this.config.clean !== undefined ? this.config.clean : true,
          keepalive: this.config.keepalive || 60,
          connectTimeout: this.config.connectTimeout || 30000,
          reconnectPeriod: this.config.reconnectPeriod || 5000,
          will: this.config.will || undefined,
          ca: this.config.ca || undefined,
          cert: this.config.cert || undefined,
          key: this.config.key || undefined,
          rejectUnauthorized: this.config.rejectUnauthorized !== undefined ? this.config.rejectUnauthorized : true
        };

        this.client = mqtt.connect(this.config.brokerUrl, options);

        this.client.on('connect', (connack) => {
          console.log(`MQTT Connected: ${this.config.name} (${this.id})`);
          this.isConnected = true;
          
          // Auto-subscribe to configured topics
          this.config.subscriptions?.forEach(sub => {
            this.subscribe(sub.topic, sub.qos || 0);
          });

          this.emit('connected', { id: this.id, connack });
          resolve(connack);
        });

        this.client.on('message', (topic, message, packet) => {
          this.emit('message', {
            id: this.id,
            topic,
            message: message.toString(),
            qos: packet.qos,
            retain: packet.retain,
            timestamp: Date.now()
          });
        });

        this.client.on('error', (error) => {
          console.error(`MQTT Error (${this.id}):`, error);
          this.emit('error', { id: this.id, error: error.message });
          reject(error);
        });

        this.client.on('close', () => {
          console.log(`MQTT Disconnected: ${this.id}`);
          this.isConnected = false;
          this.emit('disconnected', { id: this.id });
        });

        this.client.on('reconnect', () => {
          console.log(`MQTT Reconnecting: ${this.id}`);
          this.emit('reconnecting', { id: this.id });
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect() {
    return new Promise((resolve) => {
      if (this.client) {
        this.client.end(true, {}, () => {
          this.client = null;
          this.isConnected = false;
          this.subscriptions.clear();
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  subscribe(topic, qos = 0) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.isConnected) {
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
      if (!this.client || !this.isConnected) {
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
      if (!this.client || !this.isConnected) {
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
      subscriptions: Array.from(this.subscriptions)
    };
  }
}

class MQTTConnectionManager extends EventEmitter {
  constructor() {
    super();
    this.connections = new Map();
  }

  createConnection(id, config) {
    if (this.connections.has(id)) {
      throw new Error(`Connection with ID ${id} already exists`);
    }

    const connection = new MQTTConnection(id, config);
    
    // Forward all events with connection context
    ['connected', 'disconnected', 'message', 'error', 'reconnecting', 'subscribed', 'unsubscribed', 'published']
      .forEach(event => {
        connection.on(event, (data) => {
          this.emit(event, data);
        });
      });

    this.connections.set(id, connection);
    return connection;
  }

  async connect(id, config) {
    let connection = this.connections.get(id);
    
    if (!connection) {
      connection = this.createConnection(id, config);
    }

    return await connection.connect();
  }

  async disconnect(id) {
    const connection = this.connections.get(id);
    if (connection) {
      await connection.disconnect();
      this.connections.delete(id);
      return true;
    }
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

  async disconnectAll() {
    const promises = Array.from(this.connections.keys()).map(id => this.disconnect(id));
    await Promise.all(promises);
  }
}

module.exports = { MQTTConnectionManager, MQTTConnection };