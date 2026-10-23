/* Run with Node, Electron's Node runtime, or the packaged executable's Node runtime. */
const assert = require('node:assert/strict');
const { Worker } = require('node:worker_threads');
const { mkdtempSync, rmSync, existsSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const workerPath = process.argv[2] || resolve(__dirname, '../out/main/history-worker.js');
const directory = mkdtempSync(join(tmpdir(), 'mqtt-worker-test-'));
let active;
let nextId = 0;
function start() {
  const worker = new Worker(workerPath, { workerData: { directory } });
  active = worker;
  const pending = new Map();
  worker.on('message', ({ requestId, data, error }) => {
    const request = pending.get(requestId);
    if (!request) return;
    pending.delete(requestId);
    clearTimeout(request.timer);
    if (error) request.reject(new Error(error));
    else request.resolve(data);
  });
  worker.on('error', (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  });
  const request = (action) =>
    new Promise((resolve, reject) => {
      const requestId = ++nextId;
      const timer = setTimeout(() => reject(new Error('Worker request timed out')), 5000);
      pending.set(requestId, { resolve, reject, timer });
      worker.postMessage({ requestId, request: action });
    });
  return {
    request,
    close: async () => {
      await request({ action: 'close' });
      await worker.terminate();
    },
  };
}
async function run() {
  let client = start();
  const message = {
    id: 'broker',
    sessionId: 'session',
    sequence: 1,
    topic: 'a//b',
    message: 'AP8=',
    encoding: 'base64',
    byteLength: 2,
    timestamp: Date.now(),
    qos: 2,
    retain: true,
    protocolVersion: 5,
    properties: { correlationData: Buffer.from([0, 255]) },
  };
  await client.request({ action: 'append', messages: [message] });
  assert.equal(
    (await client.request({ action: 'page', query: { connectionId: 'broker', topic: 'a//b' } }))
      .messages[0].message,
    'AP8=',
  );
  await client.request({ action: 'persist', enabled: true });
  const series = await client.request({
    action: 'series',
    query: {
      connectionId: 'broker',
      topic: 'a//b',
      paths: [[]],
      from: message.timestamp - 1000,
      to: message.timestamp,
      maxPoints: 16,
    },
  });
  assert.equal(series.series[0].gaps, 1);
  assert.equal(series.series[0].points.length, 0);
  await client.close();
  assert.equal(existsSync(join(directory, 'history.sqlite')), true);
  client = start();
  assert.equal((await client.request({ action: 'status' })).retainedMessages, 1);
  const saved = await client.request({
    action: 'page',
    query: { connectionId: 'broker', topic: 'a//b' },
  });
  assert.deepEqual(saved.messages[0].properties.correlationData, {
    encoding: 'base64',
    data: 'AP8=',
  });
  await client.request({ action: 'persist', enabled: false });
  // Simulate a crash: session-only history must be removed at the next startup.
  await active.terminate();
  client = start();
  assert.equal((await client.request({ action: 'status' })).retainedMessages, 0);
  await client.close();
  assert.equal(existsSync(join(directory, 'history.sqlite')), false);
  // Persistent corrupt data must be reported, never silently replaced.
  writeFileSync(join(directory, 'settings.json'), JSON.stringify({ persistent: true }));
  writeFileSync(join(directory, 'history.sqlite'), 'broken database');
  client = start();
  await assert.rejects(client.request({ action: 'status' }));
  console.log(
    `Storage worker passed: ${process.versions.electron ? 'Electron ' + process.versions.electron : 'Node ' + process.versions.node}, binary/MQTT 5 round trip, restart recovery, session cleanup and corruption reporting.`,
  );
}
run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await active?.terminate();
    rmSync(directory, { recursive: true, force: true });
  });
