import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
// mqtt-connection-manager is still CommonJS; bundled via esbuild interop.
import { MQTTConnectionManager } from './mqtt-connection-manager';

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
const mqttManager = new MQTTConnectionManager();

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
      contextIsolation: true,
    },
  });

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
    icon: join(__dirname, '../../assets/MQTTLooter_logo_small.png'),
    show: false, // shown on ready-to-show to avoid a white flash
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../preload/preload.js'),
      webSecurity: true,
      backgroundThrottling: false, // keep MQTT/UI responsive when backgrounded
    },
  });

  // electron-vite injects ELECTRON_RENDERER_URL for the dev server; otherwise load the build.
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && rendererUrl) {
    mainWindow.loadURL(rendererUrl);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
    }
    mainWindow?.show();
    if (!app.isPackaged) mainWindow?.focus();
  });

  mainWindow.on('closed', () => {
    mqttManager.disconnectAll();
    mainWindow = null;
  });

  setupMQTTEventForwarding();
}

// Relay every MQTT manager event to the renderer as `mqtt-<event>`.
function setupMQTTEventForwarding() {
  const events = [
    'connected', 'disconnected', 'message', 'error',
    'reconnecting', 'subscribed', 'unsubscribed', 'published',
  ];
  events.forEach((event) => {
    mqttManager.on(event, (data: unknown) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(`mqtt-${event}`, data);
      }
    });
  });
}

ipcMain.handle('mqtt-connect', async (_event, connectionId, config) => {
  try {
    console.log(`IPC: Connecting ${connectionId} with protocol version ${config.protocolVersion}`);
    const result = await mqttManager.connect(connectionId, config);
    console.log(`IPC: Successfully connected ${connectionId}`);
    return { success: true, data: result };
  } catch (error) {
    console.error(`IPC: Failed to connect ${connectionId}:`, error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('mqtt-disconnect', async (_event, connectionId) => {
  try {
    const result = await mqttManager.disconnect(connectionId);
    return { success: result };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('mqtt-subscribe', async (_event, connectionId, topic, qos = 0, properties = {}) => {
  try {
    console.log(`IPC: Subscribing ${connectionId} to ${topic} with QoS ${qos}`);
    const result = await mqttManager.subscribe(connectionId, topic, qos, properties);
    console.log(`IPC: Subscription successful for ${connectionId}: ${topic}`);
    return { success: true, data: result };
  } catch (error) {
    console.error(`IPC: Subscribe failed for ${connectionId}:`, (error as Error).message);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('mqtt-unsubscribe', async (_event, connectionId, topic, properties = {}) => {
  try {
    console.log(`IPC: Unsubscribing ${connectionId} from ${topic}`);
    const result = await mqttManager.unsubscribe(connectionId, topic, properties);
    console.log(`IPC: Unsubscription successful for ${connectionId}: ${topic}`);
    return { success: true, data: result };
  } catch (error) {
    console.error(`IPC: Unsubscribe failed for ${connectionId}:`, (error as Error).message);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('mqtt-publish', async (_event, connectionId, topic, message, options) => {
  try {
    await mqttManager.publish(connectionId, topic, message, options);
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('mqtt-get-connections', async () => {
  try {
    return { success: true, data: mqttManager.getAllConnections() };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

app.on('ready', () => {
  // Splash first, then the main window once it has had a moment to paint.
  createSplashWindow();
  setTimeout(createWindow, 100);
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
    setTimeout(createWindow, 100);
  }
});
