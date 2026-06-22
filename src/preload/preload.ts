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
  mqtt: {
    connect: (connectionId: string, config: unknown) =>
      ipcRenderer.invoke('mqtt-connect', connectionId, config),
    disconnect: (connectionId: string) =>
      ipcRenderer.invoke('mqtt-disconnect', connectionId),
    subscribe: (connectionId: string, topic: string, qos = 0) =>
      ipcRenderer.invoke('mqtt-subscribe', connectionId, topic, qos),
    unsubscribe: (connectionId: string, topic: string) =>
      ipcRenderer.invoke('mqtt-unsubscribe', connectionId, topic),
    publish: (connectionId: string, topic: string, message: unknown, options: unknown) =>
      ipcRenderer.invoke('mqtt-publish', connectionId, topic, message, options),
    getConnections: () => ipcRenderer.invoke('mqtt-get-connections'),

    on: mqttEvents.on,
    off: mqttEvents.off,
    removeAllListeners: mqttEvents.removeAllListeners,
  },
});
