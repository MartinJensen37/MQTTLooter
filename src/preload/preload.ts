import { contextBridge, ipcRenderer, webFrame } from 'electron';

type EventCallback = (data: unknown) => void;

// Wraps ipcRenderer events so the renderer can add/remove callbacks per event
// type without leaking listeners (one ipcRenderer listener per event name).
function createEventHandler(eventPrefix: string) {
  const handlers = new Map<string, Set<EventCallback>>();

  return {
    on(eventType: string, callback: EventCallback) {
      const eventName = `${eventPrefix}-${eventType}`;
      if (!handlers.has(eventName)) {
        handlers.set(eventName, new Set());
        ipcRenderer.on(eventName, (_event, data) => {
          handlers.get(eventName)?.forEach((cb) => cb(data));
        });
      }
      handlers.get(eventName)!.add(callback);
    },

    off(eventType: string, callback: EventCallback) {
      const eventName = `${eventPrefix}-${eventType}`;
      const eventHandlers = handlers.get(eventName);
      if (eventHandlers) {
        eventHandlers.delete(callback);
        if (eventHandlers.size === 0) {
          ipcRenderer.removeAllListeners(eventName);
          handlers.delete(eventName);
        }
      }
    },

    removeAllListeners() {
      handlers.forEach((_, eventName) => ipcRenderer.removeAllListeners(eventName));
      handlers.clear();
    },
  };
}

const mqttEvents = createEventHandler('mqtt');

contextBridge.exposeInMainWorld('electronAPI', {
  app: {
    /** Tools > Settings in the app menu. Returns a function that stops listening. */
    onOpenSettings: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('app-open-settings', listener);
      return () => {
        ipcRenderer.removeListener('app-open-settings', listener);
      };
    },
    /** Interface zoom from Settings > Text size. */
    setZoom: (factor: number) => {
      if (Number.isFinite(factor) && factor >= 0.5 && factor <= 2) webFrame.setZoomFactor(factor);
    },
  },
  history: {
    status: () => ipcRenderer.invoke('history-status'),
    search: (query: unknown) => ipcRenderer.invoke('history-search', query),
    series: (query: unknown) => ipcRenderer.invoke('history-series', query),
    page: (query: unknown) => ipcRenderer.invoke('history-page', query),
    topics: (connectionId: string, search: string) =>
      ipcRenderer.invoke('history-topics', connectionId, search),
    clear: (connectionId: string, topic?: string) =>
      ipcRenderer.invoke('history-clear', connectionId, topic),
    persist: (enabled: boolean) => ipcRenderer.invoke('history-persist', enabled),
    resume: () => ipcRenderer.invoke('history-resume'),
    exportSearch: (query: unknown, format: string, connectionName: string) =>
      ipcRenderer.invoke('history-export-search', query, format, connectionName),
    export: (connectionId: string, topic: string, format: string, connectionName: string) =>
      ipcRenderer.invoke('history-export', connectionId, topic, format, connectionName),
  },
  decoders: {
    list: () => ipcRenderer.invoke('decoders-list'),
    save: (decoders: unknown[]) => ipcRenderer.invoke('decoders-save', decoders),
    types: (sources: string[]) => ipcRenderer.invoke('decoders-types', sources),
    decode: (decoderId: string, message: string, encoding: string) =>
      ipcRenderer.invoke('decoders-decode', decoderId, message, encoding),
  },
  credentials: {
    status: () => ipcRenderer.invoke('credentials-status'),
    get: (connectionId: string) => ipcRenderer.invoke('credentials-get', connectionId),
    set: (connectionId: string, secrets: unknown) =>
      ipcRenderer.invoke('credentials-set', connectionId, secrets),
  },
  recordings: {
    status: () => ipcRenderer.invoke('recordings-status'),
    start: (connectionId: string, connectionName: string, name: string) =>
      ipcRenderer.invoke('recordings-start', connectionId, connectionName, name),
    stop: (connectionId: string) => ipcRenderer.invoke('recordings-stop', connectionId),
    list: () => ipcRenderer.invoke('recordings-list'),
    topics: (id: number) => ipcRenderer.invoke('recordings-topics', id),
    gaps: (id: number) => ipcRenderer.invoke('recordings-gaps', id),
    count: (id: number, topics?: string[]) => ipcRenderer.invoke('recordings-count', id, topics),
    page: (query: unknown) => ipcRenderer.invoke('recordings-page', query),
    rename: (id: number, name: string) => ipcRenderer.invoke('recordings-rename', id, name),
    delete: (id: number) => ipcRenderer.invoke('recordings-delete', id),
    import: () => ipcRenderer.invoke('recordings-import'),
    migrate: (recordings: unknown[]) => ipcRenderer.invoke('recordings-migrate', recordings),
    export: (id: number) => ipcRenderer.invoke('recordings-export', id),
  },
  mqtt: {
    connect: (connectionId: string, config: unknown) =>
      ipcRenderer.invoke('mqtt-connect', connectionId, config),
    disconnect: (connectionId: string) => ipcRenderer.invoke('mqtt-disconnect', connectionId),
    subscribe: (connectionId: string, topic: string, qos = 0, properties = {}) =>
      ipcRenderer.invoke('mqtt-subscribe', connectionId, topic, qos, properties),
    unsubscribe: (connectionId: string, topic: string, properties = {}) =>
      ipcRenderer.invoke('mqtt-unsubscribe', connectionId, topic, properties),
    publish: (connectionId: string, topic: string, message: unknown, options: unknown) =>
      ipcRenderer.invoke('mqtt-publish', connectionId, topic, message, options),
    acknowledgeBatch: (batchId: number) => ipcRenderer.invoke('mqtt-ack-batch', batchId),
    rendererReady: () => ipcRenderer.invoke('mqtt-renderer-ready'),
    getTrafficStatus: () => ipcRenderer.invoke('mqtt-traffic-status'),
    getConnections: () => ipcRenderer.invoke('mqtt-get-connections'),

    on: mqttEvents.on,
    off: mqttEvents.off,
    removeAllListeners: mqttEvents.removeAllListeners,
  },
});
