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
    let hostname = urlObj.hostname;
    let pathname = urlObj.pathname || '';
    let portText = urlObj.port;
    // Saved before the host field accepted URLs, e.g. mqtt://https://host:1883: recover the host.
    const nested = /^\/\/([^/:]+)(?::(\d+))?/.exec(pathname);
    if (nested && /^(https?|mqtts?|wss?|tcp|ssl|tls)$/.test(hostname)) {
      hostname = nested[1];
      portText = nested[2] ?? portText;
      pathname = '';
    }
    const port =
      parseInt(portText) ||
      (protocol === 'mqtt' ? 1883 : protocol === 'mqtts' ? 8883 : protocol === 'ws' ? 80 : 443);
    return { protocol, hostname, port, pathname };
  } catch {
    return { protocol: 'mqtt', hostname: 'localhost', port: 1883, pathname: '' };
  }
}

const BROKER_SCHEMES: Record<string, string> = {
  mqtt: 'mqtt',
  tcp: 'mqtt',
  mqtts: 'mqtts',
  ssl: 'mqtts',
  tls: 'mqtts',
  ws: 'ws',
  wss: 'wss',
};

/**
 * Text pasted into the host field. A broker address such as `mqtts://host:8883` also gives the
 * protocol, port and WebSocket path; any other URL, such as a broker's web page, keeps only its
 * host. Plain host names are returned trimmed.
 */
export function splitHostInput(text: string): {
  hostname: string;
  protocol?: string;
  port?: number;
  wsPath?: string;
} {
  const match = /^\s*([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/i.exec(text);
  if (!match) return { hostname: text.trim() };
  // Credentials in the address are dropped; they belong in the username and password fields.
  const authority = match[2].replace(/^.*@/, '');
  const hostPort = /^(\[[^\]]*\]|[^:]*)(?::(\d+))?$/.exec(authority);
  const hostname = hostPort?.[1] ?? authority;
  const port = hostPort?.[2] ? Number(hostPort[2]) : undefined;
  const protocol = BROKER_SCHEMES[match[1].toLowerCase()];
  if (!protocol) return { hostname };
  return {
    hostname,
    protocol,
    ...(port && { port }),
    ...(protocol.startsWith('ws') && match[3] && match[3] !== '/' && { wsPath: match[3] }),
  };
}

/** Why a host name cannot be used, or '' when it can. */
export function hostnameError(hostname: string): string {
  const host = hostname.trim();
  if (!host) return 'Hostname is required';
  if (/^\[[0-9a-f:.]+\]$/i.test(host)) return '';
  if (/[\s/:@?#]/.test(host))
    return 'Enter only the host name, for example test.mosquitto.org. Choose the protocol and port beside it.';
  return '';
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
    autoAssignTopicAlias: false,
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
    keepalive: config.keepalive ?? 60,
    reconnectPeriod: config.reconnectPeriod ?? 1000,
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
    autoAssignTopicAlias: config.autoAssignTopicAlias === true,
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
