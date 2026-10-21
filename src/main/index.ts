import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { MQTTConnectionManager } from './mqtt-connection-manager';
import { RecordingStore } from './recording-store';

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
const mqttManager = new MQTTConnectionManager();
const recordingStore = new RecordingStore(join(app.getPath('userData'), 'recordings.json'));
// One main process owns the library; renderer revisions prevent stale snapshots within it.
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on('second-instance', () => {
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.show();
  mainWindow?.focus();
});

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
      sandbox: true,
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
      sandbox: true,
      preload: join(__dirname, '../preload/preload.js'),
      webSecurity: true,
      backgroundThrottling: false, // keep MQTT/UI responsive when backgrounded
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  mainWindow.webContents.on('render-process-gone', () => void mqttManager.disconnectAll());

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
}

// Relay every MQTT manager event to the renderer as `mqtt-<event>`.
function setupMQTTEventForwarding() {
  const events = [
    'connected',
    'disconnected',
    'message',
    'error',
    'reconnecting',
    'subscribed',
    'unsubscribed',
    'published',
  ];
  events.forEach((event) => {
    mqttManager.on(event, (data: unknown) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(`mqtt-${event}`, data);
      }
    });
  });
}

// Register once; recreating a window must not duplicate event forwarding.
setupMQTTEventForwarding();

function handleIPC(channel: string, handler: (...args: any[]) => any) {
  ipcMain.handle(channel, (event, ...args) => {
    if (
      !mainWindow ||
      event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame
    ) {
      return { success: false, error: 'Untrusted IPC sender' };
    }
    return handler(event, ...args);
  });
}

handleIPC('mqtt-connect', async (_event, connectionId, config) => {
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

handleIPC('mqtt-disconnect', async (_event, connectionId) => {
  try {
    const result = await mqttManager.disconnect(connectionId);
    return { success: result };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

handleIPC('mqtt-subscribe', async (_event, connectionId, topic, qos = 0, properties = {}) => {
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

handleIPC('mqtt-unsubscribe', async (_event, connectionId, topic, properties = {}) => {
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

handleIPC('mqtt-publish', async (_event, connectionId, topic, message, options) => {
  try {
    await mqttManager.publish(connectionId, topic, message, options);
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

handleIPC('mqtt-get-connections', async () => {
  try {
    return { success: true, data: mqttManager.getAllConnections() };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

app.on('ready', () => {
  if (!primaryInstance) return;
  // Splash first, then the main window once it has had a moment to paint.
  createSplashWindow();
  setTimeout(createWindow, 100);
});

for (const [channel, handler] of Object.entries({
  'recordings-load': () => recordingStore.load(),
  'recordings-migrate': (recordings: unknown) => recordingStore.migrate(recordings),
  'recordings-save': (recordings: unknown, revision: number) =>
    recordingStore.save(recordings, revision),
})) {
  handleIPC(channel, async (_event, ...args) => {
    try {
      return { success: true, data: await (handler as (...args: any[]) => unknown)(...args) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });
}

let finishingQuit = false;
app.on('before-quit', (event) => {
  if (!finishingQuit && recordingStore.busy) {
    event.preventDefault();
    void recordingStore.flush().finally(() => {
      finishingQuit = true;
      app.quit();
    });
  }
});

app.on('window-all-closed', () => {
  mqttManager.disconnectAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (primaryInstance && mainWindow === null) {
    createSplashWindow();
    setTimeout(createWindow, 100);
  }
});
