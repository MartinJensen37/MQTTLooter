// Shared contract for the renderer ↔ main IPC bridge (window.electronAPI).
// Typing this in one place keeps both sides of every invoke/send honest.

/** Result envelope returned by every MQTT IPC handler in the main process. */
export interface IpcResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/** Loose connection config — spans MQTT 3/5, TLS and WebSocket options. */
export interface ConnectionConfig {
  name?: string;
  brokerUrl?: string;
  protocolVersion?: 4 | 5;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Connection state as reported back from the main process. */
export interface MainConnectionInfo {
  isConnected: boolean;
  subscriptions?: Record<string, unknown>;
  protocolVersion?: number;
  [key: string]: unknown;
}

/** Payload returned by a successful mqtt-connect. */
export interface ConnectResultData {
  protocolVersion?: number;
  properties?: Record<string, unknown>;
}

/** MQTT events the main process forwards to the renderer as `mqtt-<event>`. */
export type MqttEventType =
  | 'connected'
  | 'disconnected'
  | 'message'
  | 'message-batch'
  | 'error'
  | 'reconnecting'
  | 'subscribed'
  | 'unsubscribed'
  | 'published';

// Event payloads are loosely shaped across event types; callers narrow as needed.
export type MqttEventCallback = (data: any) => void;

/** The surface the preload bridge exposes on window.electronAPI. */
export interface ElectronAPI {
  history: {
    status(): Promise<IpcResult<import('./history').HistoryStatus>>;
    search(
      query: import('./history-search').HistorySearchQuery,
    ): Promise<IpcResult<import('./history-search').HistorySearchPage>>;
    series(
      query: import('./numeric-series').NumericQuery,
    ): Promise<IpcResult<import('./numeric-series').NumericResult>>;
    page(
      query: import('./history').HistoryQuery,
    ): Promise<IpcResult<import('./history').HistoryPage>>;
    topics(connectionId: string, search: string): Promise<IpcResult<{ path: string }[]>>;
    clear(connectionId: string, topic?: string): Promise<IpcResult>;
    persist(enabled: boolean): Promise<IpcResult>;
    resume(): Promise<IpcResult>;
  };
  recordings: {
    load(): Promise<
      IpcResult<{
        revision: number;
        legacyMigrated: boolean;
        recordings: import('./recording').Recording[];
      }>
    >;
    migrate(recordings: unknown[]): Promise<
      IpcResult<{
        revision: number;
        legacyMigrated: boolean;
        recordings: import('./recording').Recording[];
      }>
    >;
    save(
      recordings: import('./recording').Recording[],
      revision: number,
    ): Promise<IpcResult<number>>;
  };
  mqtt: {
    connect(connectionId: string, config: ConnectionConfig): Promise<IpcResult<ConnectResultData>>;
    disconnect(connectionId: string): Promise<IpcResult>;
    subscribe(
      connectionId: string,
      topic: string,
      qos?: number,
      properties?: unknown,
    ): Promise<IpcResult>;
    unsubscribe(connectionId: string, topic: string, properties?: unknown): Promise<IpcResult>;
    publish(
      connectionId: string,
      topic: string,
      message: unknown,
      options: unknown,
    ): Promise<IpcResult>;
    acknowledgeBatch(batchId: number): Promise<IpcResult>;
    rendererReady(): Promise<IpcResult>;
    getTrafficStatus(): Promise<IpcResult<import('./traffic').TrafficStatus>>;
    getConnections(): Promise<IpcResult<Record<string, MainConnectionInfo>>>;
    on(eventType: MqttEventType, callback: MqttEventCallback): void;
    off(eventType: MqttEventType, callback: MqttEventCallback): void;
    removeAllListeners(): void;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
