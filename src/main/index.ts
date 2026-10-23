import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { MQTTConnectionManager } from './mqtt-connection-manager';
import { RecordingStore } from './recording-store';
import { HistoryService } from './history-service';
import { MessageDelivery } from './message-delivery';
import type { IncomingPublish } from '../shared/traffic';

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
const mqttManager = new MQTTConnectionManager();
const messageDelivery = new MessageDelivery((batch) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mqtt-message-batch', batch);
  } else messageDelivery.reset();
});
const recordingStore = new RecordingStore(join(app.getPath('userData'), 'recordings.json'));
// One main process owns the library; renderer revisions prevent stale snapshots within it.
const primaryInstance = app.requestSingleInstanceLock();
const historyService = primaryInstance
  ? new HistoryService(join(app.getPath('userData'), 'history'))
  : null;
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
  mainWindow.webContents.on('render-process-gone', () => {
    messageDelivery.reset();
    void mqttManager.disconnectAll();
  });
  mainWindow.webContents.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => {
    if (isMainFrame && !inPlace) messageDelivery.reset();
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
    messageDelivery.reset();
    mqttManager.disconnectAll();
    mainWindow = null;
  });
}

// Control events bypass message batches so disconnect never waits for delivery.
function setupMQTTEventForwarding() {
  const events = [
    'connected',
    'disconnected',
    'error',
    'reconnecting',
    'subscribed',
    'unsubscribed',
  ];
  mqttManager.on('message', (message: IncomingPublish) => {
    historyService?.append(message);
    messageDelivery.enqueue(message);
  });
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

handleIPC('mqtt-ack-batch', (_event, batchId) => {
  if (Number.isSafeInteger(batchId)) messageDelivery.acknowledge(batchId);
  return { success: true };
});
handleIPC('mqtt-traffic-status', () => ({ success: true, data: messageDelivery.status() }));

const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256;
const validTopic = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 65535;
for (const [channel, handler] of Object.entries({
  'history-status': () => historyService!.refreshStatus(),
  'history-page': (query: any) => {
    if (
      !query ||
      !validId(query.connectionId) ||
      !validTopic(query.topic) ||
      ['before', 'snapshot', 'generation'].some(
        (key) => query[key] !== undefined && (!Number.isSafeInteger(query[key]) || query[key] < 0),
      )
    )
      throw new Error('Invalid history query');
    return historyService!.request({ action: 'page', query });
  },
  'history-series': (query: any) => {
    if (
      !query ||
      !validId(query.connectionId) ||
      !validTopic(query.topic) ||
      !Number.isSafeInteger(query.from) ||
      !Number.isSafeInteger(query.to) ||
      query.from < 0 ||
      query.to < query.from ||
      query.to - query.from > 86400000 ||
      !Number.isSafeInteger(query.maxPoints) ||
      query.maxPoints < 16 ||
      query.maxPoints > 1024 ||
      !Array.isArray(query.paths) ||
      query.paths.length < 1 ||
      query.paths.length > 4 ||
      query.paths.some(
        (path: unknown) =>
          !Array.isArray(path) ||
          path.length > 16 ||
          path.some((segment) => typeof segment !== 'string' || segment.length > 1024),
      )
    )
      throw new Error('Invalid numeric history query');
    return historyService!.request({ action: 'series', query });
  },
  'history-topics': (connectionId: unknown, search: unknown) => {
    if (!validId(connectionId) || !validTopic(search)) throw new Error('Invalid topic search');
    return historyService!.request({ action: 'topics', connectionId, search });
  },
  'history-clear': (connectionId: unknown, topic?: unknown) => {
    if (!validId(connectionId) || (topic !== undefined && !validTopic(topic)))
      throw new Error('Invalid history scope');
    return historyService!.clear(connectionId, topic as string | undefined);
  },
  'history-persist': (enabled: unknown) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid persistence setting');
    return historyService!.request({ action: 'persist', enabled });
  },
  'history-resume': () => historyService!.resume(),
})) {
  handleIPC(channel, async (_event, ...args) => {
    try {
      return { success: true, data: await (handler as (...args: any[]) => unknown)(...args) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
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
let shutdownStarted = false;
app.on('before-quit', (event) => {
  if (finishingQuit || !primaryInstance) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  void Promise.allSettled([
    mqttManager.disconnectAll(),
    recordingStore.flush(),
    historyService?.close(),
  ]).then(() => {
    finishingQuit = true;
    app.quit();
  });
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
