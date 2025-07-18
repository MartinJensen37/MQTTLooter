const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { MQTTConnectionManager } = require('./mqtt-connection-manager');

let mainWindow;
let mqttManager = new MQTTConnectionManager();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, '../../assets/MQTTLooter_logo_small.png'),
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, '../preload/preload.js')
    }
  });

  const isDev = process.env.NODE_ENV === 'development';
  
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/build/index.html'));
  }
  
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mqttManager.disconnectAll();
    mainWindow = null;
  });

  // Set up MQTT event forwarding
  setupMQTTEventForwarding();
}

function setupMQTTEventForwarding() {
  // Forward all MQTT events to renderer
  ['connected', 'disconnected', 'message', 'error', 'reconnecting', 'subscribed', 'unsubscribed', 'published']
    .forEach(event => {
      mqttManager.on(event, (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(`mqtt-${event}`, data);
        }
      });
    });
}

ipcMain.handle('mqtt-connect', async (event, connectionId, config) => {
  try {
    console.log(`IPC: Connecting ${connectionId} with protocol version ${config.protocolVersion}`);
    const result = await mqttManager.connect(connectionId, config);
    console.log(`IPC: Successfully connected ${connectionId}`);
    return { success: true, data: result };
  } catch (error) {
    console.error(`IPC: Failed to connect ${connectionId}:`, error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('mqtt-disconnect', async (event, connectionId) => {
  try {
    const result = await mqttManager.disconnect(connectionId);
    return { success: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('mqtt-subscribe', async (event, connectionId, topic, qos = 0, properties = {}) => {
  try {
    console.log(`IPC: Subscribing ${connectionId} to ${topic} with QoS ${qos}`);
    const result = await mqttManager.subscribe(connectionId, topic, qos, properties);
    console.log(`IPC: Subscription successful for ${connectionId}: ${topic}`);
    return { success: true, data: result };
  } catch (error) {
    console.error(`IPC: Subscribe failed for ${connectionId}:`, error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('mqtt-unsubscribe', async (event, connectionId, topic, properties = {}) => {
  try {
    console.log(`IPC: Unsubscribing ${connectionId} from ${topic}`);
    const result = await mqttManager.unsubscribe(connectionId, topic, properties);
    console.log(`IPC: Unsubscription successful for ${connectionId}: ${topic}`);
    return { success: true, data: result };
  } catch (error) {
    console.error(`IPC: Unsubscribe failed for ${connectionId}:`, error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('mqtt-publish', async (event, connectionId, topic, message, options) => {
  try {
    await mqttManager.publish(connectionId, topic, message, options);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('mqtt-get-connections', async (event) => {
  try {
    return { success: true, data: mqttManager.getAllConnections() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  mqttManager.disconnectAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});