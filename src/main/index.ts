import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage } from 'electron';
import { join } from 'path';
import { MQTTConnectionManager } from './mqtt-connection-manager';
import { RecordingService } from './recording-service';
import { CredentialStore } from './credential-store';
import { DecoderService } from './decoder-service';
import { DECODER_LIMITS } from '../shared/decoders';
import { mergeSecrets, validateSecrets } from '../shared/credentials';
import { HistoryService } from './history-service';
import { validateSearch, type HistorySearchQuery } from '../shared/history-search';
import { MessageDelivery } from './message-delivery';
import { DELIVERY_COALESCE, DELIVERY_LIMITS, type IncomingPublish } from '../shared/traffic';
import { RECORDING_LIMITS, type RecordingPageQuery } from '../shared/recording';

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
const mqttManager = new MQTTConnectionManager();
const messageDelivery = new MessageDelivery(
  (batch) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mqtt-message-batch', batch);
    } else messageDelivery.reset();
  },
  DELIVERY_LIMITS,
  DELIVERY_COALESCE,
);
messageDelivery.pause();
// One main process owns each user-data directory and its storage workers.
const primaryInstance = app.requestSingleInstanceLock();
const historyService = primaryInstance
  ? new HistoryService(join(app.getPath('userData'), 'history'))
  : null;
const recordingService = primaryInstance ? new RecordingService(app.getPath('userData')) : null;
const decoderService = primaryInstance
  ? new DecoderService(join(app.getPath('userData'), 'decoders.json'), undefined, (decoders) => {
      void historyService?.request({ action: 'decoders', decoders }).catch(() => {});
    })
  : null;
// Linux without a keyring falls back to a fixed key; treat that as unavailable.
const credentialStore = new CredentialStore(join(app.getPath('userData'), 'credentials.json'), {
  available: async () =>
    (await safeStorage.isAsyncEncryptionAvailable()) &&
    !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'),
  encrypt: (text) => safeStorage.encryptStringAsync(text),
  decrypt: (data) => safeStorage.decryptStringAsync(data),
});
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
    messageDelivery.pause();
    void mqttManager.disconnectAll();
  });
  mainWindow.webContents.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => {
    if (isMainFrame && !inPlace) messageDelivery.pause();
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
    messageDelivery.pause();
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
    recordingService?.capture(message);
    historyService?.append(message);
    messageDelivery.enqueue(message);
  });
  mqttManager.on('disconnected', ({ id }: { id: string }) => recordingService?.connectionLost(id));
  mqttManager.on('connected', ({ id }: { id: string }) => recordingService?.connectionRestored(id));
  mqttManager.on('closed', ({ id }: { id: string }) => {
    void recordingService?.stop(id).catch(() => {});
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

handleIPC('mqtt-renderer-ready', () => {
  messageDelivery.resume();
  return { success: true };
});
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
  'history-search': (query: HistorySearchQuery) => {
    validateSearch(query);
    return historyService!.request({ action: 'search', query });
  },
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
      [...query.paths, ...(query.timePath === undefined ? [] : [query.timePath])].some(
        (path: unknown) =>
          !Array.isArray(path) ||
          path.length > 16 ||
          path.some((segment) => typeof segment !== 'string' || segment.length > 1024),
      ) ||
      (query.timeUnit !== undefined && !['ms', 's', 'iso'].includes(query.timeUnit)) ||
      (query.decoderId !== undefined &&
        (typeof query.decoderId !== 'string' || query.decoderId.length > 128))
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
  'history-export-search': async (query: HistorySearchQuery, format: unknown, name: unknown) => {
    validateSearch(query);
    if ((format !== 'json' && format !== 'csv') || typeof name !== 'string' || name.length > 256)
      throw new Error('Invalid search export');
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: `mqtt-search-${new Date().toISOString().slice(0, 10)}.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (result.canceled || !result.filePath) return { saved: false };
    const exported = await historyService!.exportSearch(query, format, result.filePath, name);
    return { saved: true, path: result.filePath, ...exported };
  },
  'history-export': async (
    connectionId: unknown,
    topic: unknown,
    format: unknown,
    connectionName: unknown,
  ) => {
    if (
      !validId(connectionId) ||
      !validTopic(topic) ||
      (format !== 'json' && format !== 'csv') ||
      typeof connectionName !== 'string' ||
      connectionName.length > 256
    )
      throw new Error('Invalid history export');
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: `mqtt-topic-${topic.replace(/[/\\:*?"<>|]/g, '_')}-${new Date().toISOString().slice(0, 10)}.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (result.canceled || !result.filePath) return { saved: false };
    const count = await historyService!.exportTo(
      connectionId,
      topic,
      format,
      result.filePath,
      connectionName,
    );
    return { saved: true, path: result.filePath, count };
  },
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
    if (!validId(connectionId) || !config || typeof config !== 'object')
      throw new Error('Invalid connection request');
    console.log(`IPC: Connecting ${connectionId} with protocol version ${config.protocolVersion}`);
    // Secrets stay in main: the renderer's config omits them once they are stored.
    const secrets = await credentialStore.get(connectionId);
    const result = await mqttManager.connect(connectionId, mergeSecrets(config, secrets));
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

/** The standard menus plus Tools, which opens settings that are rarely changed. */
function createMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      {
        label: 'Tools',
        submenu: [
          {
            id: 'advanced-settings',
            label: 'Advanced settings…',
            accelerator: 'CmdOrCtrl+,',
            click: () => mainWindow?.webContents.send('app-open-advanced-settings'),
          },
        ],
      },
      { role: 'windowMenu' },
    ]),
  );
}

app.on('ready', () => {
  if (!primaryInstance) return;
  createMenu();
  // Splash first, then the main window once it has had a moment to paint.
  createSplashWindow();
  setTimeout(createWindow, 100);
});

for (const [channel, handler] of Object.entries({
  'credentials-status': () => credentialStore.status(),
  'credentials-get': (connectionId: unknown) => {
    if (!validId(connectionId)) throw new Error('Invalid connection');
    return credentialStore.get(connectionId);
  },
  'credentials-set': (connectionId: unknown, secrets: unknown) => {
    if (!validId(connectionId)) throw new Error('Invalid connection');
    return credentialStore.set(connectionId, secrets === null ? null : validateSecrets(secrets));
  },
})) {
  handleIPC(channel, async (_event, ...args) => {
    try {
      return { success: true, data: await (handler as (...args: any[]) => unknown)(...args) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });
}

for (const [channel, handler] of Object.entries({
  'decoders-list': () => decoderService!.list(),
  'decoders-save': (decoders: unknown) => decoderService!.save(decoders),
  'decoders-types': (sources: unknown) => {
    if (
      !Array.isArray(sources) ||
      !sources.length ||
      sources.length > DECODER_LIMITS.maxProtoFiles ||
      sources.some((source) => typeof source !== 'string') ||
      sources.reduce((sum, source) => sum + source.length, 0) > DECODER_LIMITS.maxTotalProtoChars
    )
      throw new Error('Invalid .proto sources');
    return decoderService!.types(sources);
  },
  'decoders-decode': (decoderId: unknown, message: unknown, encoding: unknown) => {
    if (
      typeof decoderId !== 'string' ||
      decoderId.length > 128 ||
      typeof message !== 'string' ||
      message.length > DECODER_LIMITS.maxPayloadBytes * 2 ||
      (encoding !== 'utf8' && encoding !== 'base64')
    )
      throw new Error('Invalid decode request');
    return decoderService!.decode(decoderId, message, encoding);
  },
})) {
  handleIPC(channel, async (_event, ...args) => {
    try {
      return { success: true, data: await (handler as (...args: any[]) => unknown)(...args) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });
}

const validRecordingId = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;
const validTopics = (value: unknown): value is string[] | undefined =>
  value === undefined ||
  (Array.isArray(value) &&
    value.length <= RECORDING_LIMITS.maxFilterTopics &&
    value.every(validTopic));
const validName = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= RECORDING_LIMITS.maxNameLength;
const recording = (id: unknown) => {
  if (!validRecordingId(id)) throw new Error('Invalid recording');
  return id;
};
for (const [channel, handler] of Object.entries({
  'recordings-status': () => recordingService!.refresh(),
  'recordings-start': (connectionId: unknown, connectionName: unknown, name: unknown) => {
    if (!validId(connectionId) || !validName(connectionName) || !validName(name))
      throw new Error('Invalid recording request');
    if (!mqttManager.getConnection(connectionId)?.isConnected)
      throw new Error('Connect to the broker before recording');
    return recordingService!.start(connectionId, connectionName, name);
  },
  'recordings-stop': (connectionId: unknown) => {
    if (!validId(connectionId)) throw new Error('Invalid recording request');
    return recordingService!.stop(connectionId);
  },
  'recordings-list': () => recordingService!.request({ action: 'list' }),
  'recordings-topics': (id: unknown) =>
    recordingService!.request({ action: 'topics', recordingId: recording(id) }),
  'recordings-gaps': (id: unknown) =>
    recordingService!.request({ action: 'gaps', recordingId: recording(id) }),
  'recordings-count': (id: unknown, topics: unknown) => {
    if (!validTopics(topics)) throw new Error('Invalid topic filter');
    return recordingService!.request({ action: 'count', recordingId: recording(id), topics });
  },
  'recordings-page': (query: RecordingPageQuery) => {
    const bound = (value: unknown) =>
      value === undefined || (Number.isSafeInteger(value) && (value as number) >= 0);
    if (
      !query ||
      !validRecordingId(query.recordingId) ||
      !bound(query.after) ||
      !bound(query.before) ||
      (query.after !== undefined && query.before !== undefined) ||
      !Number.isSafeInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > RECORDING_LIMITS.maxPageMessages ||
      !validTopics(query.topics)
    )
      throw new Error('Invalid recording page');
    const { recordingId, after, before, limit, topics } = query;
    return recordingService!.request({
      action: 'page',
      query: { recordingId, after, before, limit, topics },
    });
  },
  'recordings-rename': (id: unknown, name: unknown) => {
    if (!validName(name)) throw new Error('Invalid recording name');
    return recordingService!.request({ action: 'rename', recordingId: recording(id), name });
  },
  'recordings-delete': (id: unknown) =>
    recordingService!.request({ action: 'delete', recordingId: recording(id) }),
  'recordings-import': async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [{ name: 'Recordings', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return recordingService!.importFile(result.filePaths[0]);
  },
  'recordings-migrate': (recordings: unknown) => {
    if (!Array.isArray(recordings)) throw new Error('Invalid legacy recording library');
    return recordingService!.request({ action: 'import-legacy', recordings });
  },
  'recordings-export': async (id: unknown) => {
    const recordingId = recording(id);
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: `mqtt-recording-${recordingId}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { saved: false };
    await recordingService!.exportTo(recordingId, result.filePath);
    return { saved: true, path: result.filePath };
  },
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
    mqttManager.disconnectAll().then(() => recordingService?.close()),
    historyService?.close(),
    decoderService?.close(),
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
