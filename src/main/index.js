const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { MQTTConnectionManager } = require('./mqtt-connection-manager');

let mainWindow;
let splashWindow;
let mqttManager = new MQTTConnectionManager();

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Create a simple HTML splash screen
  splashWindow.loadURL(`data:text/html;charset=utf-8,
    <html>
      <body style="margin:0; padding:0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                   color: white; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif; 
                   text-align: center; display: flex; flex-direction: column; justify-content: center; 
                   align-items: center; height: 100vh; border-radius: 8px;">
        <div style="background: rgba(255,255,255,0.1); padding: 40px; border-radius: 12px; backdrop-filter: blur(10px);">
          <h1 style="margin: 0 0 20px 0; font-weight: 300; font-size: 28px;">MQTTLooter</h1>
          <p style="margin: 0 0 30px 0; opacity: 0.9;">Loading application...</p>
          <div style="width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.3); 
                      border-radius: 50%; border-top: 3px solid white; 
                      animation: spin 1s linear infinite; margin: 0 auto;"></div>
        </div>
        <style>
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        </style>
      </body>
    </html>
  `);

  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, '../../assets/MQTTLooter_logo_small.png'),
    show: false, // Don't show until ready
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, '../preload/preload.js'),
      webSecurity: true,
      backgroundThrottling: false // Prevent throttling for better performance
    }
  });

  const isDev = process.env.NODE_ENV === 'development';
  
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    //mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/build/index.html'));
  }
  
  // Show main window when ready and close splash
  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
    }
    mainWindow.show();
    
    // Focus the window
    if (isDev) {
      mainWindow.focus();
    }
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

app.on('ready', () => {
  // Show splash immediately
  createSplashWindow();
  
  // Create main window with a small delay to let splash show
  setTimeout(() => {
    createWindow();
  }, 100);
});

app.on('window-all-closed', () => {
  mqttManager.disconnectAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createSplashWindow();
    setTimeout(() => {
      createWindow();
    }, 100);
  }
});