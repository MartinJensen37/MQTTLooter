const { contextBridge, ipcRenderer } = require('electron');
const mqtt = require('mqtt');
const EventEmitter = require('events');

// Expose safe APIs to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    // MQTT functionality
    mqtt: {
        connect: (url, options) => mqtt.connect(url, options)
    },
    
    // EventEmitter
    EventEmitter: EventEmitter,
    
    // Storage
    localStorage: {
        getItem: (key) => localStorage.getItem(key),
        setItem: (key, value) => localStorage.setItem(key, value),
        removeItem: (key) => localStorage.removeItem(key)
    },
    
    // Menu events
    onMenuNewConnection: (callback) => {
        ipcRenderer.on('menu-new-connection', callback);
    },
    
    // Remove listeners
    removeAllListeners: (channel) => {
        ipcRenderer.removeAllListeners(channel);
    }
});