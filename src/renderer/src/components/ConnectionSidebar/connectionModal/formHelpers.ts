import type { ConnectionFormData } from './types';

interface ParsedBrokerUrl {
  protocol: string;
  hostname: string;
  port: number;
  pathname: string;
}

export function parseBrokerUrl(url: string): ParsedBrokerUrl {
  try {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol.replace(':', '');
    const hostname = urlObj.hostname;
    const port =
      parseInt(urlObj.port) ||
      (protocol === 'mqtt' ? 1883 : protocol === 'mqtts' ? 8883 : protocol === 'ws' ? 80 : 443);
    const pathname = urlObj.pathname || '';
    return { protocol, hostname, port, pathname };
  } catch {
    return { protocol: 'mqtt', hostname: 'localhost', port: 1883, pathname: '' };
  }
}

export function buildBrokerUrl(
  protocol: string,
  hostname: string,
  port: number | '',
  wsPath = '',
): string {
  let baseUrl = `${protocol}://${hostname}:${port}`;
  if ((protocol === 'ws' || protocol === 'wss') && wsPath) {
    const path = wsPath.startsWith('/') ? wsPath : `/${wsPath}`;
    baseUrl += path;
  }
  return baseUrl;
}

export function createDefaultFormData(): ConnectionFormData {
  return {
    name: '',
    protocol: 'mqtt',
    hostname: 'localhost',
    port: 1883,
    clientId: `mqttlooter_${Date.now()}`,
    username: '',
    password: '',
    clean: true,
    keepalive: 60,
    reconnectPeriod: 1000,
    connectTimeout: 30000,
    protocolVersion: 4,
    wsPath: '/mqtt',
    tls: {
      enabled: false,
      rejectUnauthorized: true,
      ca: null,
      cert: null,
      key: null,
      passphrase: '',
      servername: '',
      alpnProtocols: [],
    },
    sessionExpiryInterval: 0,
    receiveMaximum: 65535,
    maximumPacketSize: 268435455,
    topicAliasMaximum: 0,
    requestResponseInformation: false,
    requestProblemInformation: true,
    userProperties: {},
    willEnabled: false,
    willTopic: '',
    willMessage: '',
    willQos: 0,
    willRetain: false,
    willDelayInterval: 0,
    willMessageExpiryInterval: 0,
    subscriptions: [{ topic: '#', qos: 0 }],
  };
}

/** Build initial form data from an existing connection, or defaults for a new one. */
export function buildInitialFormData(connection: any): ConnectionFormData {
  const base = createDefaultFormData();
  const config = connection?.config;
  if (!config) return base;

  let { protocol, hostname, port, wsPath } = base;
  if (config.brokerUrl) {
    const parsed = parseBrokerUrl(config.brokerUrl);
    protocol = parsed.protocol;
    hostname = parsed.hostname;
    port = parsed.port;
    if ((protocol === 'ws' || protocol === 'wss') && parsed.pathname) {
      wsPath = parsed.pathname;
    }
  }

  return {
    ...base,
    name: config.name || '',
    protocol,
    hostname,
    port,
    wsPath: config.wsPath || wsPath,
    clientId: config.clientId || base.clientId,
    username: config.username || '',
    password: config.password || '',
    clean: config.clean !== undefined ? config.clean : true,
    keepalive: config.keepalive || 60,
    reconnectPeriod: config.reconnectPeriod || 1000,
    connectTimeout: config.connectTimeout || 30000,
    protocolVersion: config.protocolVersion || 4,
    tls: {
      enabled: config.tls?.enabled || false,
      rejectUnauthorized:
        config.tls?.rejectUnauthorized !== undefined ? config.tls.rejectUnauthorized : true,
      ca: config.tls?.ca || null,
      cert: config.tls?.cert || null,
      key: config.tls?.key || null,
      passphrase: config.tls?.passphrase || '',
      servername: config.tls?.servername || '',
      alpnProtocols: config.tls?.alpnProtocols || [],
    },
    sessionExpiryInterval: config.sessionExpiryInterval || 0,
    receiveMaximum: config.receiveMaximum || 65535,
    maximumPacketSize: config.maximumPacketSize || 268435455,
    topicAliasMaximum: config.topicAliasMaximum || 0,
    requestResponseInformation: config.requestResponseInformation || false,
    requestProblemInformation:
      config.requestProblemInformation !== undefined ? config.requestProblemInformation : true,
    userProperties: config.userProperties || {},
    willEnabled: config.willEnabled || false,
    willTopic: config.willTopic || '',
    willMessage: config.willMessage || '',
    willQos: config.willQos || 0,
    willRetain: config.willRetain || false,
    willDelayInterval: config.willDelayInterval || 0,
    willMessageExpiryInterval: config.willMessageExpiryInterval || 0,
    subscriptions: config.subscriptions || [{ topic: '#', qos: 0 }],
  };
}
