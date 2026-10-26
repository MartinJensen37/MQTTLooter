import mqtt, {
  type IClientOptions,
  type IClientPublishOptions,
  type IClientSubscribeOptions,
  type IConnackPacket,
  type IPublishPacket,
  type ISubscriptionGrant,
  type MqttClient,
} from 'mqtt';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'events';
import { encodePayload, payloadBytes, type PayloadEncoding } from '../shared/payload';
import { normalizePublishProperties, validatePublishTopic } from '../shared/publish-properties';

type Properties = Record<string, any>;
/** MQTT.js passes these on to the TLS socket, including a key passphrase it does not declare. */
type ClientOptions = IClientOptions & { passphrase?: string };

/** A PEM file chosen in the connection editor. */
interface PemFile {
  content?: string;
}

/** The connection settings this manager reads; the editor saves more for itself. */
export interface BrokerConfig {
  brokerUrl: string;
  wsPath?: string;
  wsHeaders?: Record<string, string>;
  clientId?: string;
  clean?: boolean;
  keepalive?: number;
  connectTimeout?: number;
  reconnectPeriod?: number;
  protocolVersion?: 4 | 5;
  username?: string;
  password?: string;
  tls?: {
    enabled?: boolean;
    rejectUnauthorized?: boolean;
    servername?: string;
    ca?: PemFile | null;
    cert?: PemFile | null;
    key?: PemFile | null;
    passphrase?: string;
    alpnProtocols?: string[];
  };
  willEnabled?: boolean;
  willTopic?: string;
  willMessage?: string;
  willQos?: 0 | 1 | 2;
  willRetain?: boolean;
  willDelayInterval?: number;
  willMessageExpiryInterval?: number;
  autoAssignTopicAlias?: boolean;
  properties?: Properties;
  sessionExpiryInterval?: number;
  receiveMaximum?: number;
  maximumPacketSize?: number;
  topicAliasMaximum?: number;
  requestResponseInformation?: boolean;
  requestProblemInformation?: boolean;
  userProperties?: Record<string, string | string[]>;
  subscriptions?: { topic: string; qos?: 0 | 1 | 2; properties?: Properties }[];
}

/** What a connect resolves to; `connack` is absent when the connection was already open. */
export interface ConnectResult {
  id: string;
  protocolVersion: number;
  connack?: IConnackPacket;
  properties?: IConnackPacket['properties'];
}

export interface PublishOptions {
  qos?: 0 | 1 | 2;
  retain?: boolean;
  dup?: boolean;
  encoding?: PayloadEncoding;
  properties?: unknown;
}

const MANAGER_EVENTS = [
  'connected',
  'disconnected',
  'message',
  'error',
  'reconnecting',
  'subscribed',
  'unsubscribed',
  'published',
] as const;

// mqtt-packet refuses to encode an empty user property map and MQTT.js then never sends the
// packet, so a CONNECT would wait for a CONNACK forever. Leave the property out instead.
function withoutEmptyUserProperties(properties: Properties = {}): Properties {
  const { userProperties, ...rest } = properties;
  return userProperties && Object.keys(userProperties).length ? properties : rest;
}

class MQTTConnection extends EventEmitter {
  id: string;
  sessionId = randomUUID();
  sequence = 0;
  config: BrokerConfig;
  client: MqttClient | null = null;
  isConnected = false;
  subscriptions = new Map<
    string,
    { qos: number; properties: Properties; granted?: ISubscriptionGrant[] }
  >();
  eventHandlers = new Map<string, (...args: any[]) => void>();
  reconnectAttempts = 0;
  maxReconnectAttempts = 3;
  isDestroyed = false;
  pendingConnect: Promise<ConnectResult> | null = null;
  cancelConnect: ((error: Error) => void) | null = null;
  connectionTimeout: ReturnType<typeof setTimeout> | undefined;
  disconnectPromise: Promise<void> | undefined;
  connectionStats = {
    messagesReceived: 0,
    messagesPublished: 0,
    connectionStartTime: null as number | null,
    lastMessageTime: null as number | null,
    bytesReceived: 0,
    bytesSent: 0,
  };

  constructor(id: string, config: BrokerConfig) {
    super();
    this.id = id;
    this.config = config;
  }

  connect(): Promise<ConnectResult> {
    if (this.pendingConnect) return this.pendingConnect;
    if (this.isConnected)
      return Promise.resolve({ id: this.id, protocolVersion: this.config.protocolVersion || 4 });
    this.pendingConnect = this.open().finally(() => {
      this.pendingConnect = null;
    });
    return this.pendingConnect;
  }

  open(): Promise<ConnectResult> {
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

        const options: ClientOptions = {
          clientId: this.config.clientId || `mqttlooter_${Math.random().toString(36).slice(2, 11)}`,
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
        const tls = this.config.tls;
        if (
          tls &&
          (tls.enabled || brokerUrl.startsWith('mqtts://') || brokerUrl.startsWith('wss://'))
        ) {
          options.rejectUnauthorized =
            tls.rejectUnauthorized !== undefined ? tls.rejectUnauthorized : true;

          // Server name for SNI
          if (tls.servername) options.servername = tls.servername;
          if (tls.ca?.content) options.ca = Buffer.from(tls.ca.content, 'utf8');
          if (tls.cert?.content) options.cert = Buffer.from(tls.cert.content, 'utf8');
          if (tls.key?.content) {
            options.key = Buffer.from(tls.key.content, 'utf8');
            if (tls.passphrase) options.passphrase = tls.passphrase;
          }
          if (tls.alpnProtocols && tls.alpnProtocols.length > 0) {
            options.ALPNProtocols = tls.alpnProtocols;
          }
        }

        // WebSocket specific options
        if (brokerUrl.startsWith('ws://') || brokerUrl.startsWith('wss://')) {
          const wsOptions: Record<string, unknown> = {};
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
            const properties: Properties = {};
            if ((this.config.willDelayInterval ?? 0) > 0) {
              properties.willDelayInterval = this.config.willDelayInterval;
            }
            if ((this.config.willMessageExpiryInterval ?? 0) > 0) {
              properties.messageExpiryInterval = this.config.willMessageExpiryInterval;
            }
            options.will.properties = properties;
          }
        }

        // MQTT.js uses `clean` for both MQTT 3.1.1 and MQTT 5.
        if (this.config.protocolVersion === 5) {
          // MQTT.js sizes the alias table from each CONNACK's Topic Alias Maximum and discards
          // it on reconnect, so aliases follow the negotiated limit and session lifecycle.
          if (this.config.autoAssignTopicAlias === true) options.autoAssignTopicAlias = true;
          const properties: Properties = { ...this.config.properties };
          for (const key of [
            'sessionExpiryInterval',
            'receiveMaximum',
            'maximumPacketSize',
            'topicAliasMaximum',
            'requestResponseInformation',
            'requestProblemInformation',
            'userProperties',
          ] as const) {
            if (this.config[key] !== undefined) properties[key] = this.config[key];
          }
          options.properties = withoutEmptyUserProperties(properties);
        }

        let settled = false;
        const fail = (error: Error) => {
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

        const client = mqtt.connect(brokerUrl, options);
        this.client = client;
        const connectHandler = (connack: IConnackPacket) => {
          if (this.isDestroyed) return;
          settled = true;
          clearTimeout(this.connectionTimeout);
          this.cancelConnect = null;
          this.isConnected = true;
          this.sessionId = randomUUID();
          this.sequence = 0;
          this.reconnectAttempts = 0;
          client.options.reconnectPeriod = this.config.reconnectPeriod ?? 1000;
          this.connectionStats.connectionStartTime = Date.now();
          const data: ConnectResult = {
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
          this.subscriptions.forEach((sub, topic) =>
            desired.set(topic, { ...sub, qos: sub.qos as 0 | 1 | 2, topic }),
          );
          desired.forEach((sub) => {
            this.subscribe(sub.topic, sub.qos ?? 0, sub.properties || {}).catch((error) => {
              if (!this.isDestroyed) this.emit('error', { id: this.id, error: error.message });
            });
          });
        };
        const errorHandler = (error: Error & { code?: string | number }) => {
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
        const messageHandler = (topic: string, message: Buffer, packet: IPublishPacket) => {
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
          this.eventHandlers.set(event, handler as (...args: any[]) => void);
          (client as unknown as EventEmitter).on(event, handler as (...args: any[]) => void);
        });
      } catch (error) {
        clearTimeout(this.connectionTimeout);
        this.cancelConnect = null;
        reject(error);
      }
    });
  }

  disconnect(): Promise<void> {
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
      this.eventHandlers.forEach((handler, event) =>
        (client as unknown as EventEmitter).removeListener(event, handler),
      );
      this.eventHandlers.clear();
      // A late transport error must not become an unhandled EventEmitter error.
      client.on('error', () => {});
      const done = () => {
        clearTimeout(fallback);
        this.client = null;
        this.subscriptions.clear();
        resolve();
      };
      const fallback = setTimeout(done, 1000);
      client.end(true, {}, done);
    });
    return this.disconnectPromise;
  }

  subscribe(topic: string, qos: number = 0, properties: Properties = {}) {
    return new Promise((resolve, reject) => {
      const client = this.client;
      if (!client || !this.isConnected || this.isDestroyed) {
        reject(new Error('Not connected'));
        return;
      }

      const subscribeOptions: IClientSubscribeOptions = { qos: qos as 0 | 1 | 2 };
      properties = withoutEmptyUserProperties(properties);
      if (this.config.protocolVersion === 5 && Object.keys(properties).length > 0) {
        subscribeOptions.properties = properties;
      }

      client.subscribe(topic, subscribeOptions, (err, granted) => {
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

  unsubscribe(topic: string, properties: Properties = {}) {
    return new Promise((resolve, reject) => {
      const client = this.client;
      if (!client || !this.isConnected || this.isDestroyed) {
        reject(new Error('Not connected'));
        return;
      }

      properties = withoutEmptyUserProperties(properties);
      const unsubscribeOptions =
        this.config.protocolVersion === 5 && Object.keys(properties).length > 0
          ? { properties }
          : undefined;

      client.unsubscribe(topic, unsubscribeOptions, (err) => {
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

  publish(topic: string, message: string, options: PublishOptions = {}) {
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
      const client = this.client;
      if (!client || !this.isConnected || this.isDestroyed) {
        reject(new Error('Not connected'));
        return;
      }

      const publishOptions: IClientPublishOptions = {
        qos: options.qos || 0,
        retain: options.retain || false,
        dup: options.dup || false,
      };

      if (properties) {
        const { correlationData, ...rest } = properties;
        publishOptions.properties = {
          ...rest,
          ...(correlationData && { correlationData: Buffer.from(correlationData.data, 'base64') }),
        } as IClientPublishOptions['properties'];
      }

      client.publish(topic, bytes, publishOptions, (err) => {
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
  connections = new Map<string, MQTTConnection>();
  connectionHandlers = new Map<string, Record<string, (data: unknown) => void>>();

  createConnection(id: string, config: BrokerConfig) {
    if (this.connections.has(id)) {
      throw new Error(`Connection with ID ${id} already exists`);
    }

    const connection = new MQTTConnection(id, config);

    const handlers: Record<string, (data: unknown) => void> = {};
    MANAGER_EVENTS.forEach((event) => {
      const handler = (data: unknown) => this.emit(event, data);
      handlers[event] = handler;
      connection.on(event, handler);
    });

    this.connectionHandlers.set(id, handlers);
    this.connections.set(id, connection);

    return connection;
  }

  async connect(id: string, config: BrokerConfig) {
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

  async disconnect(id: string) {
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

  private find(id: string) {
    const connection = this.connections.get(id);
    if (!connection) throw new Error(`Connection ${id} not found`);
    return connection;
  }

  async subscribe(id: string, topic: string, qos = 0, properties: Properties = {}) {
    return await this.find(id).subscribe(topic, qos, properties);
  }

  async unsubscribe(id: string, topic: string, properties: Properties = {}) {
    return await this.find(id).unsubscribe(topic, properties);
  }

  async publish(id: string, topic: string, message: string, options: PublishOptions = {}) {
    return await this.find(id).publish(topic, message, options);
  }

  getConnection(id: string) {
    return this.connections.get(id);
  }

  getAllConnections() {
    const connections: Record<string, ReturnType<MQTTConnection['getStatus']>> = {};
    this.connections.forEach((connection, id) => {
      connections[id] = connection.getStatus();
    });
    return connections;
  }

  getConnectionStatistics(id: string) {
    return this.find(id).getStatistics();
  }

  getAllStatistics() {
    const stats: Record<string, ReturnType<MQTTConnection['getStatistics']>> = {};
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
    void this.disconnectAll();
    this.removeAllListeners();
    this.connectionHandlers.clear();
  }
}

export { MQTTConnectionManager, MQTTConnection };
