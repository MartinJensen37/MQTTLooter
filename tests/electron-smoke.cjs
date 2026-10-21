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
const Module = require('node:module');
const load = Module._load;
Module._load = function (request, ...args) {
  if (request === 'electron') return { ...electron, BrowserWindow: HiddenWindow };
  return load.call(this, request, ...args);
};

const sockets = new Set();
const binaryPayload = Buffer.from([0, 255, 128, 13, 10]);
const published = [];
const broker = net.createServer((socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  socket.on('error', () => {});
  const parser = codec.parser();
  let protocolVersion = 4;
  const send = (packet) => socket.write(codec.generate(packet, { protocolVersion }));
  parser.on('packet', (packet) => {
    if (packet.cmd === 'connect') {
      protocolVersion = packet.protocolVersion;
      send({ cmd: 'connack', sessionPresent: false, returnCode: 0, reasonCode: 0 });
    } else if (packet.cmd === 'subscribe') {
      send({
        cmd: 'suback',
        messageId: packet.messageId,
        granted: packet.subscriptions.map(() => 0),
      });
      for (const topic of ['a/b', 'a//b', '/a/b']) {
        send({ cmd: 'publish', topic, payload: `sample:${topic}`, qos: 0, retain: true });
      }
      send({ cmd: 'publish', topic: 'binary', payload: binaryPayload, qos: 0, retain: true });
    } else if (packet.cmd === 'publish') {
      published.push(packet);
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
  };
  await evaluate(
    `localStorage.setItem('mqtt-connections', JSON.stringify([{id:'smoke',config:${JSON.stringify(config)}}]))`,
  );
  window.webContents.reload();
  await waitFor(() => !window.webContents.isLoading(), 'reload');
  await waitFor(
    () => evaluate("document.querySelector('.connection-card') !== null"),
    'saved profile',
  );
  await evaluate("document.querySelector('.connection-card .toggle-btn').click()");
  await waitFor(
    () => evaluate("document.querySelector('.topic-tree-stats')?.textContent.includes('4 topics')"),
    'MQTT 5 topics',
  );
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
  assert.ok(exports[1].includes('Payload,Encoding,QoS'));
  assert.ok(exports[1].includes(`"${binaryPayload.toString('base64')}",base64,0,true`));

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
    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true }))",
  );
  await evaluate("document.querySelector('.connection-card .toggle-btn').click()");
  await waitFor(
    () =>
      evaluate("document.querySelector('.connection-status-text')?.textContent === 'disconnected'"),
    'disconnect',
  );
  assert.equal(await evaluate("document.querySelectorAll('.message-item').length"), 1);
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
  console.log(
    'Electron smoke passed: MQTT 5, exact topic paths, binary display/export/publish, disconnect history, sandbox and local icons.',
  );
}

run().then(
  () => finish(0),
  (error) => {
    console.error(error);
    finish(1);
  },
);
function finish(code) {
  sockets.forEach((socket) => socket.destroy());
  broker.close();
  app.exit(code);
}
