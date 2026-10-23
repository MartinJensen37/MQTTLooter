import { contextBridge, ipcRenderer } from 'electron';

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
  history: {
    status: () => ipcRenderer.invoke('history-status'),
    series: (query: unknown) => ipcRenderer.invoke('history-series', query),
    page: (query: unknown) => ipcRenderer.invoke('history-page', query),
    topics: (connectionId: string, search: string) =>
      ipcRenderer.invoke('history-topics', connectionId, search),
    clear: (connectionId: string, topic?: string) =>
      ipcRenderer.invoke('history-clear', connectionId, topic),
    persist: (enabled: boolean) => ipcRenderer.invoke('history-persist', enabled),
    resume: () => ipcRenderer.invoke('history-resume'),
  },
  recordings: {
    load: () => ipcRenderer.invoke('recordings-load'),
    migrate: (recordings: unknown[]) => ipcRenderer.invoke('recordings-migrate', recordings),
    save: (recordings: unknown[], revision: number) =>
      ipcRenderer.invoke('recordings-save', recordings, revision),
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
    getTrafficStatus: () => ipcRenderer.invoke('mqtt-traffic-status'),
    getConnections: () => ipcRenderer.invoke('mqtt-get-connections'),

    on: mqttEvents.on,
    off: mqttEvents.off,
    removeAllListeners: mqttEvents.removeAllListeners,
  },
});
