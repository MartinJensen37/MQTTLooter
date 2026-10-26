import mqtt from 'mqtt';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'events';
import { encodePayload, payloadBytes } from '../shared/payload';
import { normalizePublishProperties, validatePublishTopic } from '../shared/publish-properties';

class MQTTConnection extends EventEmitter {
  constructor(id, config) {
    super();
    this.id = id;
    this.sessionId = randomUUID();
    this.sequence = 0;
    this.config = config;
    this.client = null;
    this.isConnected = false;
    this.subscriptions = new Map();
    this.eventHandlers = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.isDestroyed = false;
    this.pendingConnect = null;
    this.cancelConnect = null;
    this.connectionTimeout = null;
    this.connectionStats = {
      messagesReceived: 0,
      messagesPublished: 0,
      connectionStartTime: null,
      lastMessageTime: null,
      bytesReceived: 0,
      bytesSent: 0,
    };
  }

  connect() {
    if (this.pendingConnect) return this.pendingConnect;
    if (this.isConnected)
      return Promise.resolve({ id: this.id, protocolVersion: this.config.protocolVersion || 4 });
    this.pendingConnect = this.open().finally(() => {
      this.pendingConnect = null;
    });
    return this.pendingConnect;
  }

  open() {
    return new Promise((resolve, reject) => {
      if (this.isDestroyed) {
        reject(new Error('Connection has been destroyed'));
        return;
      }

      try {
        // Build the complete broker URL including WebSocket path
        let brokerUrl = this.config.brokerUrl;

        // For WebSocket connections, ensure the path is included
        if (
          (this.config.brokerUrl.startsWith('ws://') ||
            this.config.brokerUrl.startsWith('wss://')) &&
          this.config.wsPath
        ) {
          const url = new URL(this.config.brokerUrl);
          if (!url.pathname || url.pathname === '/') {
            // If no path in the URL, add the wsPath
            const path = this.config.wsPath.startsWith('/')
              ? this.config.wsPath
              : `/${this.config.wsPath}`;
            url.pathname = path;
            brokerUrl = url.toString();
          }
        }

        const options = {
          clientId: this.config.clientId || `mqttlooter_${Math.random().toString(36).substr(2, 9)}`,
          clean: this.config.clean !== undefined ? this.config.clean : true,
          keepalive: this.config.keepalive ?? 60,
          connectTimeout: this.config.connectTimeout || 30000,
          reconnectPeriod: 0,
          resubscribe: false,
          protocolVersion: this.config.protocolVersion || 4,
        };

        // Authentication
        if (this.config.username) options.username = this.config.username;
        if (this.config.password) options.password = this.config.password;

        // TLS/SSL Configuration
        if (
          this.config.tls &&
          (this.config.tls.enabled ||
            brokerUrl.startsWith('mqtts://') ||
            brokerUrl.startsWith('wss://'))
        ) {
          options.rejectUnauthorized =
            this.config.tls.rejectUnauthorized !== undefined
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
        }

        // WebSocket specific options
        if (brokerUrl.startsWith('ws://') || brokerUrl.startsWith('wss://')) {
          const wsOptions = {};
          if (this.config.wsHeaders) wsOptions.headers = this.config.wsHeaders;
          // MQTT.js forwards CA, certificate and key to secure WebSockets, but not the server
          // name, so SNI and the host name check would otherwise use the URL's host.
          if (options.servername) wsOptions.servername = options.servername;
          if (Object.keys(wsOptions).length) options.wsOptions = wsOptions;
        }

        // Last Will and Testament
        if (this.config.willEnabled && this.config.willTopic) {
          options.will = {
            topic: this.config.willTopic,
            payload: this.config.willMessage ?? '',
            qos: this.config.willQos || 0,
            retain: this.config.willRetain || false,
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

        // MQTT.js uses `clean` for both MQTT 3.1.1 and MQTT 5.
        if (this.config.protocolVersion === 5) {
          // MQTT.js sizes the alias table from each CONNACK's Topic Alias Maximum and discards
          // it on reconnect, so aliases follow the negotiated limit and session lifecycle.
          if (this.config.autoAssignTopicAlias === true) options.autoAssignTopicAlias = true;
          options.properties = { ...this.config.properties };
          for (const key of [
            'sessionExpiryInterval',
            'receiveMaximum',
            'maximumPacketSize',
            'topicAliasMaximum',
            'requestResponseInformation',
            'requestProblemInformation',
            'userProperties',
          ]) {
            if (this.config[key] !== undefined) options.properties[key] = this.config[key];
          }
        }

        let settled = false;
        const fail = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(this.connectionTimeout);
          this.cancelConnect = null;
          reject(error);
          this.client?.end(true);
        };
        this.cancelConnect = fail;
        this.connectionTimeout = setTimeout(() => {
          fail(new Error(`Connection timeout after ${options.connectTimeout}ms`));
        }, options.connectTimeout);

        this.client = mqtt.connect(brokerUrl, options);
        const connectHandler = (connack) => {
          if (this.isDestroyed) return;
          settled = true;
          clearTimeout(this.connectionTimeout);
          this.cancelConnect = null;
          this.isConnected = true;
          this.sessionId = randomUUID();
          this.sequence = 0;
          this.reconnectAttempts = 0;
          this.client.options.reconnectPeriod = this.config.reconnectPeriod ?? 1000;
          this.connectionStats.connectionStartTime = Date.now();
          const data = {
            id: this.id,
            connack,
            properties: connack.properties,
            protocolVersion: this.config.protocolVersion || 4,
          };
          this.emit('connected', data);
          resolve(data);
          const desired = new Map(
            (this.config.subscriptions || [])
              .filter((sub) => sub.topic)
              .map((sub) => [sub.topic, sub]),
          );
          this.subscriptions.forEach((sub, topic) => desired.set(topic, { ...sub, topic }));
          desired.forEach((sub) => {
            this.subscribe(sub.topic, sub.qos ?? 0, sub.properties || {}).catch((error) => {
              if (!this.isDestroyed) this.emit('error', { id: this.id, error: error.message });
            });
          });
        };
        const errorHandler = (error) => {
          if (this.isDestroyed) return;
          this.emit('error', { id: this.id, error: error.message, code: error.code });
          fail(error);
        };
        const closeHandler = () => {
          if (this.isDestroyed) return;
          this.isConnected = false;
          this.emit('disconnected', { id: this.id });
          fail(new Error('Connection closed before CONNACK'));
        };
        const reconnectHandler = () => {
          if (!this.isDestroyed)
            this.emit('reconnecting', { id: this.id, attempt: ++this.reconnectAttempts });
        };
        const messageHandler = (topic, message, packet) => {
          if (this.isDestroyed) return;
          const timestamp = Date.now();
          this.connectionStats.messagesReceived++;
          this.connectionStats.lastMessageTime = timestamp;
          this.connectionStats.bytesReceived += message.length;
          this.emit('message', {
            id: this.id,
            sessionId: this.sessionId,
            sequence: ++this.sequence,
            topic,
            ...encodePayload(message),
            timestamp,
            qos: packet.qos,
            retain: packet.retain,
            properties: packet.properties,
            protocolVersion: this.config.protocolVersion || 4,
          });
        };
        Object.entries({
          connect: connectHandler,
          error: errorHandler,
          close: closeHandler,
          reconnect: reconnectHandler,
          message: messageHandler,
        }).forEach(([event, handler]) => {
          this.eventHandlers.set(event, handler);
          this.client.on(event, handler);
        });
      } catch (error) {
        clearTimeout(this.connectionTimeout);
        this.cancelConnect = null;
        reject(error);
      }
    });
  }

  disconnect() {
    if (this.disconnectPromise) return this.disconnectPromise;
    this.isDestroyed = true;
    this.isConnected = false;
    clearTimeout(this.connectionTimeout);
    this.cancelConnect?.(new Error('Connection cancelled'));
    this.disconnectPromise = new Promise((resolve) => {
      const client = this.client;
      if (!client) {
        resolve();
        return;
      }
      this.eventHandlers.forEach((handler, event) => client.removeListener(event, handler));
      this.eventHandlers.clear();
      // A late transport error must not become an unhandled EventEmitter error.
      client.on('error', () => {});
      let fallback;
      const done = () => {
        clearTimeout(fallback);
        this.client = null;
        this.subscriptions.clear();
        resolve();
      };
      fallback = setTimeout(done, 1000);
      client.end(true, {}, done);
    });
    return this.disconnectPromise;
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
        if (err || granted?.some((sub) => sub.qos > 2)) {
          reject(err || new Error(`Subscription rejected: ${topic}`));
        } else {
          this.subscriptions.set(topic, { qos, properties, granted });
          const subscriptionData = {
            id: this.id,
            topic,
            qos,
            granted,
            protocolVersion: this.config.protocolVersion || 4,
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

      const unsubscribeOptions =
        this.config.protocolVersion === 5 && Object.keys(properties).length > 0
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
            protocolVersion: this.config.protocolVersion || 4,
          };
          this.emit('unsubscribed', unsubscriptionData);
          resolve(unsubscriptionData);
        }
      });
    });
  }

  publish(topic, message, options = {}) {
    return new Promise((resolve, reject) => {
      validatePublishTopic(topic);
      if (!options || typeof options !== 'object' || Array.isArray(options))
        throw new Error('Invalid publish options');
      if (options.qos !== undefined && ![0, 1, 2].includes(options.qos))
        throw new Error('QoS must be 0, 1 or 2');
      if (options.retain !== undefined && typeof options.retain !== 'boolean')
        throw new Error('Retain must be a boolean');
      const bytes = Buffer.from(payloadBytes(message, options.encoding ?? 'utf8'));
      const properties = normalizePublishProperties(
        options.properties,
        this.config.protocolVersion || 4,
        bytes,
      );
      if (!this.client || !this.isConnected || this.isDestroyed) {
        reject(new Error('Not connected'));
        return;
      }

      const publishOptions = {
        qos: options.qos || 0,
        retain: options.retain || false,
        dup: options.dup || false,
      };

      if (properties) {
        publishOptions.properties = { ...properties };
        if (properties.correlationData)
          publishOptions.properties.correlationData = Buffer.from(
            properties.correlationData.data,
            'base64',
          );
      }

      this.client.publish(topic, bytes, publishOptions, (err) => {
        if (err) {
          reject(err);
        } else {
          this.connectionStats.messagesPublished++;
          this.connectionStats.bytesSent += bytes.byteLength;

          const publishData = {
            id: this.id,
            encoding: options.encoding ?? 'utf8',
            byteLength: bytes.byteLength,
            topic,
            message,
            options: publishOptions,
            timestamp: Date.now(),
            protocolVersion: this.config.protocolVersion || 4,
          };

          this.emit('published', publishData);
          resolve(publishData);
        }
      });
    });
  }

  // Sent over IPC: never include the config, which holds passwords and private keys.
  getStatus() {
    return {
      id: this.id,
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
          : 0,
      },
    };
  }

  getStatistics() {
    return {
      ...this.connectionStats,
      uptime: this.connectionStats.connectionStartTime
        ? Date.now() - this.connectionStats.connectionStartTime
        : 0,
      subscriptionCount: this.subscriptions.size,
      protocolVersion: this.config.protocolVersion || 4,
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
    [
      'connected',
      'disconnected',
      'message',
      'error',
      'reconnecting',
      'subscribed',
      'unsubscribed',
      'published',
    ].forEach((event) => {
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
    if (connection?.isConnected || connection?.pendingConnect) return connection.connect();
    if (connection) await this.disconnect(id);
    connection = this.createConnection(id, config);
    try {
      return await connection.connect();
    } catch (error) {
      if (this.connections.get(id) === connection) await this.disconnect(id);
      throw error;
    }
  }

  async disconnect(id) {
    const connection = this.connections.get(id);
    if (!connection) return true;
    this.connections.delete(id);
    const handlers = this.connectionHandlers.get(id);
    this.connectionHandlers.delete(id);
    await connection.disconnect();
    if (handlers)
      Object.entries(handlers).forEach(([event, handler]) =>
        connection.removeListener(event, handler),
      );
    // Unlike 'disconnected', which automatic reconnects also emit, the connection is gone.
    this.emit('closed', { id });
    return true;
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
    const disconnectPromises = Array.from(this.connections.keys()).map((id) => {
      return this.disconnect(id).catch((error) => {
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

export { MQTTConnectionManager, MQTTConnection };
