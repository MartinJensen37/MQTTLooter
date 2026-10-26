// Connection settings, saved by the connection editor and used by main to connect.

type Properties = Record<string, any>;

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

/** A saved connection: the broker settings and the name shown in the sidebar. */
export interface ConnectionConfig extends BrokerConfig {
  name?: string;
}
