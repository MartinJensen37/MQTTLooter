const { contextBridge, ipcRenderer } = require('electron');

const createEventHandler = (eventPrefix) => {
  const handlers = new Map();
  
  return {
    on: (eventType, callback) => {
      const eventName = `${eventPrefix}-${eventType}`;
      if (!handlers.has(eventName)) {
        handlers.set(eventName, new Set());
        ipcRenderer.on(eventName, (event, data) => {
          handlers.get(eventName).forEach(cb => cb(data));
        });
      }
      handlers.get(eventName).add(callback);
    },
    
    off: (eventType, callback) => {
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
    
    removeAllListeners: () => {
      handlers.forEach((_, eventName) => {
        ipcRenderer.removeAllListeners(eventName);
      });
      handlers.clear();
    }
  };
};

const mqttEvents = createEventHandler('mqtt');

contextBridge.exposeInMainWorld('electronAPI', {
  // MQTT Operations
  mqtt: {
    connect: (connectionId, config) => ipcRenderer.invoke('mqtt-connect', connectionId, config),
    disconnect: (connectionId) => ipcRenderer.invoke('mqtt-disconnect', connectionId),
    subscribe: (connectionId, topic, qos = 0) => ipcRenderer.invoke('mqtt-subscribe', connectionId, topic, qos),
    unsubscribe: (connectionId, topic) => ipcRenderer.invoke('mqtt-unsubscribe', connectionId, topic),
    // Updated to match index.js signature: (connectionId, topic, message, options)
    publish: (connectionId, topic, message, options) => ipcRenderer.invoke('mqtt-publish', connectionId, topic, message, options),
    getConnections: () => ipcRenderer.invoke('mqtt-get-connections'),
    
    // Event handling
    on: mqttEvents.on,
    off: mqttEvents.off,
    removeAllListeners: mqttEvents.removeAllListeners
  }
});