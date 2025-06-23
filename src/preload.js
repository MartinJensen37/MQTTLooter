const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    subscribeToMqtt: (topic) => ipcRenderer.invoke('subscribe-to-mqtt', topic),
    onMqttMessage: (callback) => ipcRenderer.on('mqtt-message', (event, message) => callback(message)),
});