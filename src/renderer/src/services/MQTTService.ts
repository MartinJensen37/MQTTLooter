import type {
  ConnectionConfig,
  IpcResult,
  MainConnectionInfo,
  MqttEventType,
} from '../../../shared/ipc';

type EventHandler = (data: any) => void;

/** Connection state tracked in the renderer. */
export interface RendererConnection {
  id: string;
  config: ConnectionConfig;
  status: string;
  isConnected: boolean;
  createdAt: number;
  protocolVersion: number;
  mqtt5Properties?: Record<string, unknown>;
  subscriptions?: string[];
  reconnectAttempt?: number;
}

export interface PublishData {
  topic: string;
  message: unknown;
  qos?: number;
  retain?: boolean;
  properties?: Record<string, unknown>;
}

const EVENT_TYPES: MqttEventType[] = [
  'connected',
  'disconnected',
  'message',
  'error',
  'reconnecting',
  'subscribed',
  'unsubscribed',
  'published',
];

class MQTTService {
  private connections = new Map<string, RendererConnection>();
  private eventHandlers = new Map<string, Set<EventHandler>>();

  constructor() {
    this.setupGlobalEventHandlers();
  }

  private setupGlobalEventHandlers(): void {
    if (!window.electronAPI) {
      console.error('ElectronAPI not available');
      return;
    }
    EVENT_TYPES.forEach((eventType) => {
      window.electronAPI.mqtt.on(eventType, (data) => this.handleEvent(eventType, data));
    });
  }

  private handleEvent(eventType: string, data: any): void {
    const connectionId = data.id;

    const connection = this.connections.get(connectionId);
    if (connection) {
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

    const handlers = this.eventHandlers.get(`${connectionId}:${eventType}`) ?? new Set();
    const globalHandlers = this.eventHandlers.get(`*:${eventType}`) ?? new Set();
    [...handlers, ...globalHandlers].forEach((handler) => {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error in event handler for ${eventType}:`, error);
      }
    });
  }

  on(connectionId: string, eventType: string, handler: EventHandler): void {
    const key = `${connectionId}:${eventType}`;
    if (!this.eventHandlers.has(key)) {
      this.eventHandlers.set(key, new Set());
    }
    this.eventHandlers.get(key)!.add(handler);
  }

  onAny(eventType: string, handler: EventHandler): void {
    this.on('*', eventType, handler);
  }

  off(connectionId: string, eventType: string, handler: EventHandler): void {
    const key = `${connectionId}:${eventType}`;
    const handlers = this.eventHandlers.get(key);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) this.eventHandlers.delete(key);
    }
  }

  async connect(connectionId: string, config: ConnectionConfig): Promise<IpcResult> {
    const connectionData: RendererConnection = {
      id: connectionId,
      config,
      status: 'connecting',
      isConnected: false,
      createdAt: Date.now(),
      protocolVersion: config.protocolVersion || 4,
      ...(config.protocolVersion === 5 && { mqtt5Properties: config.properties || {} }),
    };
    this.connections.set(connectionId, connectionData);

    try {
      const result = await window.electronAPI.mqtt.connect(connectionId, config);
      if (result.success) {
        connectionData.status = 'connected';
        connectionData.isConnected = true;
        connectionData.protocolVersion =
          result.data?.protocolVersion || config.protocolVersion || 4;
        if (result.data?.properties) connectionData.mqtt5Properties = result.data.properties;
        this.connections.set(connectionId, connectionData);
      } else {
        connectionData.status = 'error';
        connectionData.isConnected = false;
        this.connections.set(connectionId, connectionData);
        throw new Error(result.error);
      }
      return result;
    } catch (error) {
      const existing = this.connections.get(connectionId);
      if (existing) {
        existing.status = 'error';
        existing.isConnected = false;
        this.connections.set(connectionId, existing);
      }
      throw error;
    }
  }

  async disconnect(connectionId: string): Promise<IpcResult> {
    const result = await window.electronAPI.mqtt.disconnect(connectionId);

    if (result.success) {
      const connection = this.connections.get(connectionId);
      if (connection) {
        connection.isConnected = false;
        connection.status = 'disconnected';
        this.connections.set(connectionId, connection);
      }
      this.removeHandlers((key) => key.startsWith(`${connectionId}:`) && !key.startsWith('*:'));
    } else {
      throw new Error(result.error);
    }
    return result;
  }

  async deleteConnection(connectionId: string): Promise<IpcResult> {
    const connection = this.connections.get(connectionId);
    if (connection?.isConnected) {
      await this.disconnect(connectionId);
    }
    this.connections.delete(connectionId);
    this.removeHandlers((key) => key.startsWith(`${connectionId}:`));
    return { success: true };
  }

  private removeHandlers(predicate: (key: string) => boolean): void {
    for (const key of [...this.eventHandlers.keys()]) {
      if (predicate(key)) this.eventHandlers.delete(key);
    }
  }

  async subscribe(connectionId: string, topic: string, qos = 0, properties = {}): Promise<IpcResult> {
    return window.electronAPI.mqtt.subscribe(connectionId, topic, qos, properties);
  }

  async unsubscribe(connectionId: string, topic: string, properties = {}): Promise<IpcResult> {
    return window.electronAPI.mqtt.unsubscribe(connectionId, topic, properties);
  }

  async publish(connectionId: string, data: PublishData): Promise<IpcResult> {
    const { topic, message, qos, retain, properties } = data;
    const options = {
      qos: qos || 0,
      retain: retain || false,
      ...(properties && { properties }),
    };
    const result = await window.electronAPI.mqtt.publish(connectionId, topic, message, options);
    if (!result.success) throw new Error(result.error);
    return result;
  }

  getConnection(connectionId: string): RendererConnection | undefined {
    return this.connections.get(connectionId);
  }

  getAllConnections(): RendererConnection[] {
    return Array.from(this.connections.values());
  }

  async updateConnectionConfig(
    connectionId: string,
    config: ConnectionConfig,
  ): Promise<IpcResult> {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.config = config;
      this.connections.set(connectionId, connection);
    }
    return { success: true };
  }

  async refreshConnectionsFromMain(): Promise<Record<string, MainConnectionInfo>> {
    const result = await window.electronAPI.mqtt.getConnections();
    if (result.success) return result.data ?? {};
    throw new Error(result.error);
  }

  isConnected(connectionId: string): boolean {
    return this.connections.get(connectionId)?.isConnected || false;
  }

  getProtocolVersion(connectionId: string): number {
    return this.connections.get(connectionId)?.protocolVersion || 4;
  }

  supportsMqtt5(connectionId: string): boolean {
    return this.getProtocolVersion(connectionId) === 5;
  }

  getMqtt5Properties(connectionId: string): Record<string, unknown> {
    return this.connections.get(connectionId)?.mqtt5Properties || {};
  }
}

export default new MQTTService();
