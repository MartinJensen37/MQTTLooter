// Shared types for the ConnectionModal form and its section components.

export interface TlsFile {
  name: string;
  content: string;
  size: number;
  lastModified: number;
}

export interface TlsConfig {
  enabled: boolean;
  rejectUnauthorized: boolean;
  ca: TlsFile | null;
  cert: TlsFile | null;
  key: TlsFile | null;
  passphrase: string;
  servername: string;
  alpnProtocols: string[];
}

export interface Subscription {
  topic: string;
  qos: number;
}

export interface ConnectionFormData {
  name: string;
  protocol: string;
  hostname: string;
  port: number | '';
  clientId: string;
  username: string;
  password: string;
  clean: boolean;
  keepalive: number;
  reconnectPeriod: number;
  connectTimeout: number;
  protocolVersion: number;
  wsPath: string;
  tls: TlsConfig;
  sessionExpiryInterval: number;
  receiveMaximum: number;
  maximumPacketSize: number;
  topicAliasMaximum: number;
  requestResponseInformation: boolean;
  requestProblemInformation: boolean;
  userProperties: Record<string, unknown>;
  willEnabled: boolean;
  willTopic: string;
  willMessage: string;
  willQos: number;
  willRetain: boolean;
  willDelayInterval: number;
  willMessageExpiryInterval: number;
  subscriptions: Subscription[];
}

export type FormErrors = Record<string, string | null | undefined>;

/** Single-field updater used across all form sections. */
export type FieldChange = (field: keyof ConnectionFormData, value: any) => void;

export type CertFileType = 'ca' | 'cert' | 'key';
