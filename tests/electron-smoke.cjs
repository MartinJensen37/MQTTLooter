/* Run after npm run build. Uses isolated storage and a loopback-only test broker. */
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const electron = require('electron');
// Use the packet codec belonging to the installed MQTT client.
const codec = createRequire(require.resolve('mqtt'))('mqtt-packet');
const { app, BrowserWindow } = electron;
const workspace = path.resolve(__dirname, '..');
const temporary = path.join(workspace, '.tmp', `smoke-${process.pid}`);
fs.mkdirSync(temporary, { recursive: true });
app.setPath('userData', temporary);
app.disableHardwareAcceleration();

// Run the real app entry point while keeping its windows hidden during automation.
class HiddenWindow extends BrowserWindow {
  constructor(options) {
    super({
      ...options,
      show: false,
      webPreferences: { ...options.webPreferences, offscreen: true },
    });
    this.show = () => {};
    this.focus = () => {};
  }
}
// Save dialogs return a path chosen by the test instead of opening.
const saveDialog = { path: null };
const Module = require('node:module');
const load = Module._load;
Module._load = function (request, ...args) {
  if (request === 'electron')
    return {
      ...electron,
      BrowserWindow: HiddenWindow,
      dialog: {
        ...electron.dialog,
        showSaveDialog: async () => ({ canceled: !saveDialog.path, filePath: saveDialog.path }),
        showOpenDialog: async () => ({
          canceled: !saveDialog.path,
          filePaths: saveDialog.path ? [saveDialog.path] : [],
        }),
      },
    };
  return load.call(this, request, ...args);
};

const sockets = new Set();
const binaryPayload = Buffer.from([0, 255, 128, 13, 10]);
const published = [];
const connectPasswords = [];
let aliasedPublishes = 0;
const broker = net.createServer((socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  socket.on('error', () => {});
  const parser = codec.parser();
  const subscriptions = new Set();
  // Like a real broker, resolve this connection's topic aliases before handling a publish.
  const aliases = new Map();
  let protocolVersion = 4;
  const send = (packet) => socket.write(codec.generate(packet, { protocolVersion }));
  parser.on('packet', (packet) => {
    if (packet.cmd === 'connect') {
      connectPasswords.push(packet.password?.toString());
      protocolVersion = packet.protocolVersion;
      send({
        cmd: 'connack',
        sessionPresent: false,
        returnCode: 0,
        reasonCode: 0,
        ...(protocolVersion === 5 && { properties: { topicAliasMaximum: 4 } }),
      });
    } else if (packet.cmd === 'subscribe') {
      packet.subscriptions.forEach(({ topic }) => subscriptions.add(topic));
      send({
        cmd: 'suback',
        messageId: packet.messageId,
        granted: packet.subscriptions.map(() => 0),
      });
      for (const topic of ['a/b', 'a//b', '/a/b']) {
        send({ cmd: 'publish', topic, payload: `sample:${topic}`, qos: 0, retain: true });
      }
      send({
        cmd: 'publish',
        topic: 'binary',
        payload: binaryPayload,
        qos: 0,
        retain: true,
        properties: {
          correlationData: binaryPayload,
          responseTopic: 'reply//binary',
          contentType: 'application/octet-stream',
          messageExpiryInterval: 0,
          payloadFormatIndicator: false,
          userProperties: { repeated: ['first', 'second'] },
          subscriptionIdentifier: [1, 3],
        },
      });
    } else if (packet.cmd === 'publish') {
      const alias = packet.properties?.topicAlias;
      if (alias && packet.topic) aliases.set(alias, packet.topic);
      else if (alias) {
        packet.topic = aliases.get(alias);
        aliasedPublishes++;
      }
      published.push(packet);
      if (subscriptions.has('#') && packet.topic.startsWith('smoke/')) {
        send({
          cmd: 'publish',
          topic: packet.topic,
          payload: packet.payload,
          qos: 0,
          retain: false,
        });
      }
      if (packet.qos === 1) send({ cmd: 'puback', messageId: packet.messageId });
      if (packet.qos === 2) send({ cmd: 'pubrec', messageId: packet.messageId });
    } else if (packet.cmd === 'pubrel') {
      send({ cmd: 'pubcomp', messageId: packet.messageId });
    } else if (packet.cmd === 'pingreq') send({ cmd: 'pingresp' });
  });
  parser.on('error', (error) => socket.destroy(error));
  socket.on('data', (data) => parser.parse(data));
});

const errors = [];
const windows = [];
app.on('browser-window-created', (_event, window) => windows.push(window));
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(details.message);
  });
});

async function waitFor(check, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${label}`);
}

async function run() {
  // A pre-SQLite JSON library is imported once and kept as a recovery copy.
  fs.writeFileSync(
    path.join(temporary, 'recordings.json'),
    JSON.stringify({
      version: 1,
      revision: 3,
      legacyMigrated: false,
      legacyMigrations: [],
      recordings: [
        {
          id: 7,
          name: 'File library capture',
          startTime: 1000,
          endTime: 2000,
          connectionName: 'Old',
          messages: [{ topic: 'file/a', message: 'from file', timestamp: 1500 }],
        },
      ],
    }),
  );
  require(path.join(workspace, 'out/main/index.js'));
  await new Promise((resolve) => broker.listen(0, '127.0.0.1', resolve));
  await app.whenReady();
  let window;
  await waitFor(() => {
    window = windows.find(
      (win) => !win.isDestroyed() && win.webContents.getURL().startsWith('file:'),
    );
    return window && !window.webContents.isLoading();
  }, 'renderer load');
  const evaluate = (source) => window.webContents.executeJavaScript(source, true);
  await waitFor(() => evaluate("document.querySelector('.app') !== null"), 'React mount');
  const config = {
    name: 'Smoke broker',
    brokerUrl: `mqtt://127.0.0.1:${broker.address().port}`,
    protocolVersion: 5,
    reconnectPeriod: 0,
    subscriptions: [{ topic: '#', qos: 0 }],
    username: 'smoke-user',
    password: 'smoke-secret',
    autoAssignTopicAlias: true,
  };
  await evaluate(
    `localStorage.setItem('mqtt-connections', JSON.stringify([{id:'smoke',config:${JSON.stringify(config)}}]))`,
  );
  await evaluate(`localStorage.setItem('mqtt-recordings', JSON.stringify([{
    id: 1, name: 'Legacy binary capture', startTime: 0, endTime: 1,
    messages: [{ topic: 'binary', message: '${binaryPayload.toString('base64')}', encoding: 'base64', timestamp: 1 }]
  }]))`);
  window.webContents.reload();
  await waitFor(() => !window.webContents.isLoading(), 'reload');
  await waitFor(
    () => evaluate("document.querySelector('.connection-card') !== null"),
    'saved profile',
  );
  await evaluate("document.querySelector('.connection-card').click()");
  const recordingNames = () =>
    evaluate(
      "[...document.querySelectorAll('.recording-name-text')].map(node => node.textContent)",
    );
  await waitFor(
    async () => (await recordingNames()).includes('Legacy binary capture'),
    'recording migration',
  );
  assert.ok((await recordingNames()).includes('File library capture'));
  assert.equal(await evaluate("localStorage.getItem('mqtt-recordings')"), null);
  assert.ok(!fs.existsSync(path.join(temporary, 'recordings.json')));
  assert.ok(fs.existsSync(path.join(temporary, 'recordings.json.migrated')));
  assert.ok(fs.existsSync(path.join(temporary, 'recordings.sqlite')));
  // The saved password moves to main's encrypted store and still reaches the broker.
  await waitFor(
    async () =>
      !(await evaluate("localStorage.getItem('mqtt-connections')")).includes('smoke-secret'),
    'credential migration',
  );
  assert.ok(
    !fs.readFileSync(path.join(temporary, 'credentials.json'), 'utf8').includes('smoke-secret'),
  );
  await evaluate("document.querySelector('.connection-card .toggle-btn').click()");
  await waitFor(
    () => evaluate("document.querySelector('.topic-tree-stats')?.textContent.includes('4 topics')"),
    'MQTT 5 topics',
  );
  assert.equal(connectPasswords.at(-1), 'smoke-secret');
  await evaluate('document.querySelector(\'[title="Expand all topics"]\').click()');
  await waitFor(
    () => evaluate("document.querySelectorAll('.topic-tree-node.has-messages').length === 4"),
    'distinct topics',
  );
  await evaluate(
    "[...document.querySelectorAll('.topic-tree-node')].find(n => n.textContent.includes('sample:a//b')).click()",
  );
  await waitFor(
    () => evaluate("document.querySelector('.message-item')?.textContent.includes('sample:a//b')"),
    'message details',
  );
  await evaluate('document.querySelector(\'.topic-tree-node[title="binary"]\').click()');
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.payload-preview')?.textContent.includes('00 ff 80 0d 0a')",
      ),
    'binary hex display',
  );
  await evaluate("document.querySelector('.message-properties').open = true");
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.message-properties-body')?.textContent.includes('reply//binary')",
      ),
    'live MQTT 5 properties',
  );
  assert.equal(
    await evaluate("document.querySelector('.message-correlation pre')?.textContent"),
    '00 ff 80 0d 0a',
  );
  assert.equal(
    await evaluate(
      "[...document.querySelectorAll('.message-properties dt')].filter(node=>node.textContent==='User: repeated').length",
    ),
    2,
  );
  fs.writeFileSync(
    path.join(workspace, '.tmp', 'electron-properties.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  await evaluate("document.querySelector('.message-properties').open = false");
  // Capture real export blobs without opening a download dialog.
  await evaluate(`
    window.smokeExports = [];
    URL.createObjectURL = blob => {
      blob.text().then(text => window.smokeExports.push(text));
      return 'blob:smoke';
    };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = () => {};
    void 0;
  `);
  for (const format of ['JSON', 'CSV']) {
    await evaluate('document.querySelector(\'[title="Export topic data"]\').click()');
    await waitFor(
      () => evaluate("document.querySelector('.message-export-wrapper .dropdown-option') !== null"),
      'export menu',
    );
    await evaluate(
      `[...document.querySelectorAll('.message-export-wrapper .dropdown-option')].find(button => button.textContent.includes('${format}')).click()`,
    );
  }
  await waitFor(() => evaluate('window.smokeExports.length === 2'), 'payload exports');
  const exports = await evaluate('window.smokeExports');
  const exported = JSON.parse(exports[0]).messages[0];
  assert.equal(exported.encoding, 'base64');
  assert.deepEqual(Buffer.from(exported.payload, 'base64'), binaryPayload);
  assert.equal(exported.qos, 0);
  assert.equal(exported.protocolVersion, 5);
  assert.deepEqual(exported.properties.correlationData, {
    encoding: 'base64',
    data: binaryPayload.toString('base64'),
  });
  assert.deepEqual(exported.properties.userProperties.repeated, ['first', 'second']);
  assert.equal(exported.properties.messageExpiryInterval, 0);
  assert.equal(exported.properties.payloadFormatIndicator, false);
  assert.ok(exports[1].includes('Payload,Encoding,QoS'));
  assert.ok(exports[1].includes(`"${binaryPayload.toString('base64')}",base64,0,true`));

  await evaluate(
    `(() => { const select=document.querySelector('[aria-label="Message source"]'); select.value='stored'; select.dispatchEvent(new Event('change', {bubbles:true})); })()`,
  );
  await waitFor(
    () => evaluate("document.querySelector('.message-item .message-properties') !== null"),
    'stored property card',
  );
  await evaluate("document.querySelector('.message-properties').open = true");
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.message-correlation pre')?.textContent === '00 ff 80 0d 0a'",
      ),
    'stored correlation bytes',
  );
  await evaluate(
    `(() => { const select=document.querySelector('[aria-label="Message source"]'); select.value='live'; select.dispatchEvent(new Event('change', {bubbles:true})); })()`,
  );
  await evaluate(
    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }))",
  );
  await evaluate("document.querySelector('.publish-form-load-topic-btn').click()");
  await waitFor(
    () => evaluate("document.querySelector('#publish-encoding').value === 'base64'"),
    'load binary draft',
  );
  assert.equal(
    await evaluate("document.querySelector('#payload').value"),
    binaryPayload.toString('base64'),
  );
  await evaluate("document.querySelector('.publish-form-publish-btn').click()");
  await waitFor(() => published.length === 1, 'binary publish');
  assert.deepEqual(published[0].payload, binaryPayload);
  assert.equal(published[0].qos, 0);
  assert.equal(published[0].retain, true);
  await evaluate(
    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3', bubbles: true }))",
  );
  await evaluate("document.querySelector('.recording-action-buttons button').click()");
  await evaluate("window.electronAPI.mqtt.subscribe('smoke', 'capture/#', 0)");
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.recording-live-info')?.textContent.includes('Messages: 4')",
      ),
    'live capture',
  );
  await evaluate("document.querySelector('.recording-action-buttons button').click()");
  await waitFor(
    async () => (await evaluate('window.electronAPI.recordings.list()')).data.length === 3,
    'capture disk save',
  );
  const [savedCapture] = (await evaluate('window.electronAPI.recordings.list()')).data;
  assert.equal(savedCapture.state, 'complete');
  assert.equal(savedCapture.messageCount, 4);
  const savedPage = await evaluate(
    `window.electronAPI.recordings.page({ recordingId: ${savedCapture.id}, limit: 10 })`,
  );
  const savedBinary = savedPage.data.messages.find((message) => message.topic === 'binary');
  assert.equal(savedBinary.encoding, 'base64');
  assert.deepEqual(Buffer.from(savedBinary.message, 'base64'), binaryPayload);
  assert.equal(savedBinary.properties.responseTopic, 'reply//binary');
  await evaluate("document.querySelector('.recording-item-header').click()");
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.recording-filter-summary, .recording-playback-section') !== null",
      ),
    'paged playback controls',
  );
  window.setSize(800, 600);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const recordingLayout = await evaluate(`(() => {
    const panel = document.querySelector('.recording-main-panel');
    return { scroll: panel.scrollWidth, client: panel.clientWidth };
  })()`);
  assert.ok(recordingLayout.scroll <= recordingLayout.client + 1, JSON.stringify(recordingLayout));
  fs.writeFileSync(
    path.join(workspace, '.tmp', 'electron-recordings.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  window.setSize(1400, 900);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  fs.writeFileSync(
    path.join(workspace, '.tmp', 'electron-recordings-wide.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  await evaluate("document.querySelector('.recording-item-header').click()");
  // Export the newest capture through main, then import that file back in bounded steps.
  saveDialog.path = path.join(temporary, 'recording-export.json');
  await evaluate(`document.querySelector('[title="Save recording to file"]').click()`);
  await waitFor(() => fs.existsSync(saveDialog.path), 'recording export file');
  await evaluate(
    "[...document.querySelectorAll('button')].find(button => button.textContent.includes('Load Recording')).click()",
  );
  await waitFor(
    async () =>
      (await evaluate('window.electronAPI.recordings.list()')).data.some(
        (item) => item.name.endsWith('(Imported)') && item.messageCount === 4,
      ),
    'recording round trip',
  );
  saveDialog.path = null;
  await evaluate(
    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true }))",
  );
  await evaluate("document.querySelector('.connection-card .toggle-btn').click()");
  await waitFor(
    () =>
      evaluate("document.querySelector('.connection-status-text')?.textContent === 'disconnected'"),
    'disconnect',
  );
  await waitFor(
    () => evaluate("document.querySelectorAll('.message-item').length === 2"),
    'captured messages remain visible after disconnect',
  );
  assert.equal(await evaluate('typeof window.require'), 'undefined');
  assert.equal(await evaluate('document.fonts.check(\'900 16px "Font Awesome 6 Free"\')'), true);
  assert.deepEqual(errors, []);
  const bounds =
    await evaluate(`['.topic-tree-panel', '.message-panel', '.message-item'].map(selector => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    return { selector, width: rect.width, height: rect.height };
  })`);
  bounds.forEach((rect) => assert.ok(rect.width > 100 && rect.height > 20, JSON.stringify(rect)));
  await new Promise((resolve) => setTimeout(resolve, 250));
  const screenshot = await window.webContents.capturePage();
  fs.writeFileSync(path.join(workspace, '.tmp', 'electron-smoke.png'), screenshot.toPNG());
  window.webContents.reload();
  await waitFor(() => !window.webContents.isLoading(), 'recording reload');
  await waitFor(
    () => evaluate("document.querySelector('.connection-card') !== null"),
    'reloaded profile',
  );
  await evaluate("document.querySelector('.connection-card').click()");
  await waitFor(
    () => evaluate("document.querySelectorAll('.recording-saved-item').length === 4"),
    'saved recording recovery',
  );
  assert.equal(await evaluate("localStorage.getItem('mqtt-recordings')"), null);
  assert.deepEqual(errors, []);
  // Exercise the real simulator editor and MQTT acknowledgements.
  await evaluate("document.querySelector('.connection-card .toggle-btn').click()");
  await waitFor(
    () =>
      evaluate("document.querySelector('.connection-status-text')?.textContent === 'connected'"),
    'simulator connection',
  );
  await require('./electron-publish-properties.cjs')({
    evaluate,
    waitFor,
    published,
    capture: async () => {
      window.setSize(800, 600);
      await new Promise((resolve) => setTimeout(resolve, 250));
      await evaluate(
        "document.querySelector('.publish-properties').scrollIntoView({block:'start'})",
      );
      const layout = await evaluate(`(() => {
        const editor=document.querySelector('.publish-properties');
        const rect=editor.getBoundingClientRect();
        return {right:rect.right,width:rect.width,scroll:editor.scrollWidth,client:editor.clientWidth};
      })()`);
      assert.ok(
        layout.right <= 801 && layout.width >= 250 && layout.scroll <= layout.client + 1,
        JSON.stringify(layout),
      );
      fs.writeFileSync(
        path.join(workspace, '.tmp', 'electron-publish-properties.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      window.setSize(1400, 900);
      await new Promise((resolve) => setTimeout(resolve, 250));
    },
  });

  await require('./electron-templates.cjs')({
    evaluate,
    waitFor,
    published,
    capture: async () => {
      window.setSize(800, 600);
      await new Promise((resolve) => setTimeout(resolve, 250));
      await evaluate(
        "document.querySelector('.publish-template-variables').scrollIntoView({block:'center'})",
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      const layout = await evaluate(`(() => {
        const editor = document.querySelector('.publish-template-variables');
        return {width:editor.clientWidth, scroll:editor.scrollWidth, right:editor.getBoundingClientRect().right};
      })()`);
      assert.ok(
        layout.width >= 250 && layout.scroll <= layout.width + 1 && layout.right <= 801,
        JSON.stringify(layout),
      );
      fs.writeFileSync(
        path.join(workspace, '.tmp', 'electron-template-variables.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      window.setSize(1400, 900);
    },
  });
  await evaluate(
    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F4', bubbles: true }))",
  );
  await evaluate('document.querySelector(\'[title="Add Simulated Device"]\').click()');
  const field = async (selector, value) =>
    evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  })()`);
  const clickButton = async (scope, label) =>
    evaluate(
      `[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find(button => button.textContent.trim() === ${JSON.stringify(label)}).click()`,
    );
  await field('[aria-labelledby="add-device-title"] select', 'machine');
  await field('#sim-device-name', 'Smoke machine');
  await field('#sim-device-topic', 'smoke/device');
  await field('[aria-labelledby="add-device-title"] input[type="number"]', '100');
  await clickButton('[aria-labelledby="add-device-title"]', 'Create Device');
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.simulation-panel .outputs-section')?.textContent.includes('Signals (3)')",
      ),
    'machine signals',
  );
  const simulationPackets = () =>
    published.filter((packet) => packet.topic === 'smoke/device/cycles');
  await field('.device-settings select[aria-label="QoS"]', '1');
  await clickButton('.simulation-panel', 'Publish Once');
  await waitFor(() => simulationPackets().length === 1, 'simulator QoS 1 publish');
  assert.equal(simulationPackets()[0].qos, 1);
  assert.equal(JSON.parse(simulationPackets()[0].payload.toString()).value, 0);
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.simulation-panel .device-config-header [role=status]')?.textContent === 'Stopped'",
      ),
    'publish completion',
  );
  await field('.device-settings select[aria-label="QoS"]', '2');
  await clickButton('.simulation-panel', 'Publish Once');
  await waitFor(() => simulationPackets().length === 2, 'simulator QoS 2 publish');
  assert.equal(simulationPackets()[1].qos, 2);
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.simulation-panel .device-config-header [role=status]')?.textContent === 'Stopped'",
      ),
    'QoS 2 completion',
  );
  await clickButton('.simulation-panel', 'Start Loop');
  await waitFor(() => simulationPackets().length >= 4, 'simulator loop');
  await evaluate(
    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true }))",
  );
  const beforeTabSwitch = simulationPackets().length;
  await waitFor(() => simulationPackets().length > beforeTabSwitch, 'loop survives tab switch');
  await field('[aria-label="Search topics"]', 'smoke/device/cycles');
  await waitFor(
    () => evaluate('!!document.querySelector(\'.topic-tree-node[title="smoke/device/cycles"]\')'),
    'simulator messages return through topic tree',
  );
  await evaluate(
    'document.querySelector(\'.topic-tree-node[title="smoke/device/cycles"]\').click()',
  );
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.message-item')?.textContent.includes('smoke/device/cycles')",
      ),
    'simulator topic can be selected',
  );
  await field('[aria-label="Search topics"]', '');
  await evaluate(
    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F4', bubbles: true }))",
  );
  await clickButton('.simulation-panel', 'Stop Loop');
  const stoppedCount = simulationPackets().length;
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(simulationPackets().length, stoppedCount);
  assert.equal(JSON.parse(simulationPackets()[2].payload.toString()).value, 0);
  await new Promise((resolve) => setTimeout(resolve, 250));
  fs.writeFileSync(
    path.join(workspace, '.tmp', 'electron-simulator.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  window.setSize(800, 600);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const layout = await evaluate(`(() => {
    const panel = document.querySelector('.simulation-panel');
    return { width: panel.clientWidth, scroll: panel.scrollWidth, editor: document.querySelector('.device-config-panel').getBoundingClientRect().width };
  })()`);
  assert.ok(layout.scroll <= layout.width + 2 && layout.editor > 450, JSON.stringify(layout));
  const signalRows = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.signal-overview-row')];
    return rows.map(row => {
      const rect = row.getBoundingClientRect();
      const pattern = row.querySelector('.signal-row-pattern').getBoundingClientRect();
      return { height: rect.height, width: row.clientWidth, scroll: row.scrollWidth,
        patternHeight: pattern.height, patternRight: pattern.right, right: rect.right };
    });
  })()`);
  assert.equal(signalRows.length, 3);
  for (const row of signalRows) {
    assert.ok(row.height <= 40 && row.patternHeight <= 24, JSON.stringify(row));
    assert.ok(row.scroll <= row.width + 1 && row.patternRight <= row.right, JSON.stringify(row));
  }
  assert.equal(await evaluate("document.querySelector('.device-config pre') === null"), true);
  await evaluate("document.querySelector('.outputs-section').scrollIntoView({block: 'center'})");
  fs.writeFileSync(
    path.join(workspace, '.tmp', 'electron-simulator-small.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  // Configure an individual topic and random schedule through the real editor.
  window.setSize(1400, 900);
  await evaluate('document.querySelector(\'[aria-label="Edit speed"]\').click()');
  await field('.signal-dialog .signal-topic-field input', 'smoke/custom-speed');
  await field('.signal-dialog .signal-delivery select', 'random');
  await field('.signal-dialog .signal-delivery .interval-field input[type="number"]', '200');
  assert.ok(
    await evaluate(
      "document.querySelector('.signal-dialog svg').getAttribute('aria-label').includes('three cycles')",
    ),
  );
  await evaluate(
    "document.querySelector('.signal-dialog .signal-waveform').scrollIntoView({block:'center'})",
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  fs.writeFileSync(
    path.join(workspace, '.tmp', 'electron-signal-editor.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  await clickButton('.signal-dialog', 'Save Signal');
  await clickButton('.publish-timeline', 'Publish timeline');
  await waitFor(
    () =>
      evaluate(
        "document.querySelectorAll('.publish-timeline-row').length === 3 && !!document.querySelector('.publish-timeline-lane rect')",
      ),
    'timeline worker and random bands',
  );
  await field('[aria-label="Timeline horizon"]', '60000');
  await waitFor(
    () =>
      evaluate("document.querySelector('.publish-timeline-axis')?.textContent.includes('60 s')"),
    'timeline horizon',
  );
  assert.equal(
    await evaluate("document.querySelectorAll('.publish-timeline [role=alert]').length"),
    0,
  );
  window.setSize(800, 600);
  await new Promise((resolve) => setTimeout(resolve, 250));
  await evaluate("document.querySelector('.publish-timeline').scrollIntoView({block:'start'})");
  await new Promise((resolve) => setTimeout(resolve, 200));
  const timelineLayout = await evaluate(
    "(() => { const element = document.querySelector('.publish-timeline'); return {width:element.clientWidth,scroll:element.scrollWidth}; })()",
  );
  assert.ok(timelineLayout.scroll <= timelineLayout.width + 2, JSON.stringify(timelineLayout));
  const timelineAlignment = await evaluate(
    "(() => { const lane=document.querySelector('.publish-timeline-lane svg').getBoundingClientRect(); const total=document.querySelector('.publish-timeline-total svg').getBoundingClientRect(); return Math.abs(lane.right-total.right)+Math.abs(lane.left-total.left); })()",
  );
  assert.ok(timelineAlignment < 2, `Timeline axis alignment: ${timelineAlignment}`);
  fs.writeFileSync(
    path.join(workspace, '.tmp', 'electron-timeline-small.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  await clickButton('.publish-timeline', 'Publish timeline');
  window.setSize(1400, 900);
  const settings = await evaluate(
    "JSON.parse(localStorage.getItem('mqtt-simulation-devices-smoke'))",
  );
  assert.equal(settings[0].outputs[0].topic, 'smoke/custom-speed');
  assert.equal(settings[0].outputs[0].timing.mode, 'random');
  assert.equal(settings[0].outputs[0].timing.intervalMs, 200);
  await clickButton('.simulation-panel', 'Publish Once');
  await waitFor(
    () => published.some((packet) => packet.topic === 'smoke/custom-speed'),
    'individual signal topic',
  );
  assert.ok(published.some((packet) => packet.topic === 'smoke/device/state'));
  await evaluate('document.querySelector(\'[aria-label="Edit speed"]\').click()');
  await field('.signal-dialog select', 'string');
  await field('[aria-label="Signal payload format"]', 'raw');
  const rawPayload = '  caf\u00e9 \ud83c\udf21\ufe0f\nnext';
  await field('.signal-dialog textarea', rawPayload);
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('.preview-section pre')?.textContent === ${JSON.stringify(rawPayload)}`,
      ),
    'raw scalar preview',
  );
  window.setSize(800, 600);
  await new Promise((resolve) => setTimeout(resolve, 250));
  await evaluate("document.querySelector('.preview-section').scrollIntoView({block:'center'})");
  const rawLayout = await evaluate(
    "(() => { const element=document.querySelector('.simulation-payload-preview'); return {width:element.clientWidth,scroll:element.scrollWidth}; })()",
  );
  assert.ok(
    rawLayout.width > 250 && rawLayout.scroll <= rawLayout.width + 1,
    JSON.stringify(rawLayout),
  );
  fs.writeFileSync(
    path.join(workspace, '.tmp', 'electron-raw-preview.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  await clickButton('.signal-dialog', 'Save Signal');
  window.setSize(1400, 900);
  const rawStart = published.length;
  await clickButton('.simulation-panel', 'Publish Once');
  await waitFor(
    () => published.slice(rawStart).some((packet) => packet.topic === 'smoke/custom-speed'),
    'raw scalar publish',
  );
  const rawPacket = published
    .slice(rawStart)
    .find((packet) => packet.topic === 'smoke/custom-speed');
  assert.deepEqual(rawPacket.payload, Buffer.from(rawPayload, 'utf8'));
  const rawSaved = await evaluate(
    "JSON.parse(localStorage.getItem('mqtt-simulation-devices-smoke'))[0]",
  );
  assert.equal(rawSaved.schemaVersion, 1);
  assert.equal(rawSaved.outputs[0].payloadMode, 'raw');
  await evaluate('document.querySelector(\'[aria-label="Edit speed"]\').click()');
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('.last-published pre')?.textContent === ${JSON.stringify(rawPayload)}`,
      ),
    'raw last publication',
  );
  await clickButton('.signal-dialog', 'Cancel');

  await require('./electron-transitions.cjs')({
    evaluate,
    waitFor,
    field,
    clickButton,
    published,
    capture: async () => {
      window.setSize(800, 600);
      await new Promise((resolve) => setTimeout(resolve, 250));
      await evaluate("document.querySelector('.signal-waveform').scrollIntoView({block:'center'})");
      await waitFor(
        () =>
          evaluate(`(() => {
          const plot = document.querySelector('.signal-waveform').getBoundingClientRect();
          return plot.top >= 90 && plot.bottom <= innerHeight - 30;
        })()`),
        'transition preview fits the narrow editor',
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(
        await evaluate(`(() => {
          const badge = document.querySelector('.connection-card .connection-status').getBoundingClientRect();
          return !!document.elementFromPoint(badge.x + badge.width / 2, badge.y + badge.height / 2)?.closest('.modal-overlay');
        })()`),
        true,
        'connection badge stays behind the signal editor',
      );
      fs.writeFileSync(
        path.join(workspace, '.tmp', 'electron-response-small.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      window.setSize(1400, 900);
    },
  });
  await require('./electron-payload-templates.cjs')({
    evaluate,
    waitFor,
    clickButton,
    published,
    capture: async () => {
      window.setSize(800, 600);
      await new Promise((resolve) => setTimeout(resolve, 250));
      await evaluate(
        `document.querySelector('[aria-label="Payload template"]').scrollIntoView({block:'center'})`,
      );
      const layout = await evaluate(`(() => {
        const editor = document.querySelector('[aria-label="Payload template"]').getBoundingClientRect();
        const panel = document.querySelector('.device-config');
        return { right: editor.right, width: editor.width, scroll: panel.scrollWidth, client: panel.clientWidth };
      })()`);
      assert.ok(
        layout.right <= 801 && layout.width >= 250 && layout.scroll <= layout.client + 1,
        JSON.stringify(layout),
      );
      fs.writeFileSync(
        path.join(workspace, '.tmp', 'electron-payload-template.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      window.setSize(1400, 900);
    },
  });
  await require('./electron-navigation.cjs')({
    evaluate,
    waitFor,
    field,
    send: (topic, payload) => {
      for (const socket of sockets)
        socket.write(
          codec.generate(
            { cmd: 'publish', topic, payload, qos: 0, retain: false },
            { protocolVersion: 5 },
          ),
        );
    },
  });
  await require('./electron-history.cjs')({
    captureSearch: async () => {
      window.setSize(800, 600);
      await new Promise((resolve) => setTimeout(resolve, 250));
      const layout = await evaluate(
        "(() => { const panel=document.querySelector('.history-search').getBoundingClientRect(); const list=document.querySelector('.history-search .message-list').getBoundingClientRect(); return {width:panel.width,right:panel.right,height:list.height}; })()",
      );
      assert.ok(
        layout.width >= 350 && layout.right <= 801 && layout.height >= 50,
        JSON.stringify(layout),
      );
      fs.writeFileSync(
        path.join(workspace, '.tmp', 'electron-search-small.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      window.setSize(1400, 900);
      await new Promise((resolve) => setTimeout(resolve, 250));
    },
    evaluate,
    waitFor,
    field,
    saveTo: (file) => {
      saveDialog.path = path.join(temporary, file);
      return saveDialog.path;
    },
    send: (topic, payload) => {
      for (const socket of sockets)
        socket.write(
          codec.generate(
            { cmd: 'publish', topic, payload, qos: 0, retain: false },
            { protocolVersion: 5 },
          ),
        );
    },
  });
  fs.writeFileSync(
    path.join(workspace, '.tmp', 'electron-inspector.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  await require('./electron-decoders.cjs')({
    evaluate,
    waitFor,
    field,
    userData: temporary,
    capture: async () => {
      window.setSize(800, 600);
      await new Promise((resolve) => setTimeout(resolve, 250));
      const layout = await evaluate(`(() => {
        const dialog = document.querySelector('.decoder-dialog').getBoundingClientRect();
        return { left: dialog.left, right: dialog.right, width: dialog.width };
      })()`);
      assert.ok(layout.left >= 0 && layout.right <= 801, JSON.stringify(layout));
      fs.writeFileSync(
        path.join(workspace, '.tmp', 'electron-decoders.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      window.setSize(1400, 900);
    },
    send: (topic, payload) => {
      for (const socket of sockets)
        socket.write(
          codec.generate(
            { cmd: 'publish', topic, payload, qos: 0, retain: false },
            { protocolVersion: 5 },
          ),
        );
    },
  });
  await require('./electron-credentials.cjs')({ evaluate, waitFor, field });
  await require('./electron-plots.cjs')({
    evaluate,
    waitFor,
    field,
    send: (topic, payload) => {
      for (const socket of sockets)
        socket.write(
          codec.generate(
            { cmd: 'publish', topic, payload, qos: 0, retain: false },
            { protocolVersion: 5 },
          ),
        );
    },
  });
  fs.writeFileSync(
    path.join(workspace, '.tmp', 'electron-plots.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  window.setSize(800, 600);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const plotLayout = await evaluate(`(() => {
    const plot = document.querySelector('.incoming-plot');
    return { height: plot.clientHeight, width: plot.clientWidth, scroll: plot.scrollWidth };
  })()`);
  assert.ok(
    plotLayout.height > 100 && plotLayout.scroll <= plotLayout.width + 2,
    JSON.stringify(plotLayout),
  );
  fs.writeFileSync(
    path.join(workspace, '.tmp', 'electron-plots-small.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  window.setSize(1400, 900);
  await field('[aria-label="Message display"]', 'cards');
  await waitFor(
    () =>
      evaluate(
        "document.querySelectorAll('.message-item').length > 0 && !document.querySelector('.incoming-plot')",
      ),
    'return from plot to messages',
  );
  await require('./electron-split.cjs')({
    evaluate,
    waitFor,
    field,
    capture: async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      fs.writeFileSync(
        path.join(workspace, '.tmp', 'electron-split.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      window.setSize(800, 600);
      await new Promise((resolve) => setTimeout(resolve, 250));
      // Too narrow for side-by-side panes: they stack, each at full width.
      const narrow = await evaluate(`(() => {
        const header = document.querySelector('.main-header');
        const split = document.querySelector('.split-controls').getBoundingClientRect();
        const active = document.querySelector('.tab-content.active').getBoundingClientRect();
        const secondary = document.querySelector('.tab-content.secondary').getBoundingClientRect();
        return { scroll: header.scrollWidth, client: header.clientWidth, right: split.right,
          stacked: !!document.querySelector('.tab-content-container.stacked'),
          activeBottom: active.bottom, secondaryTop: secondary.top,
          widths: [active.width, secondary.width] };
      })()`);
      assert.ok(
        narrow.scroll <= narrow.client + 1 &&
          narrow.right <= 801 &&
          narrow.stacked &&
          narrow.activeBottom <= narrow.secondaryTop + 1 &&
          narrow.widths.every((width) => width >= 300),
        JSON.stringify(narrow),
      );
      fs.writeFileSync(
        path.join(workspace, '.tmp', 'electron-split-small.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      window.setSize(1400, 900);
      await new Promise((resolve) => setTimeout(resolve, 250));
    },
  });
  await require('./electron-reload.cjs')({
    window,
    evaluate,
    waitFor,
    send: (topic, payload) => {
      for (const socket of sockets)
        socket.write(
          codec.generate(
            { cmd: 'publish', topic, payload, qos: 0, retain: false },
            { protocolVersion: 5 },
          ),
        );
    },
  });
  // Repeated simulator topics were sent as aliases within the broker's limit.
  assert.ok(aliasedPublishes > 0, 'topic aliases used');
  assert.deepEqual(errors, []);
  console.log(
    'Electron smoke passed: MQTT 5, binary payloads, recording recovery, simulator/QoS 1+2, topic search, anchored scrolling, responsive layout and sandbox.',
  );
}

run().then(
  () => finish(0),
  async (error) => {
    console.error(error);
    console.error('Renderer errors:', errors);
    const window = windows.find((window) => !window.isDestroyed());
    if (window) {
      try {
        fs.writeFileSync(
          path.join(workspace, '.tmp', 'electron-failure.png'),
          (await window.webContents.capturePage()).toPNG(),
        );
        fs.writeFileSync(
          path.join(workspace, '.tmp', 'electron-failure.html'),
          await window.webContents.executeJavaScript('document.body.innerHTML'),
        );
      } catch (captureError) {
        console.error(captureError);
      }
    }
    finish(1);
  },
);
function finish(code) {
  sockets.forEach((socket) => socket.destroy());
  broker.close();
  app.once('will-quit', () => app.exit(code));
  app.quit();
}
