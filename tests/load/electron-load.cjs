/*
 * Load harness. Run after `npm run build` through tests/run-electron-load.cjs.
 * LOAD_PROFILE=quick (default) or full. LOAD_STRICT=1 also fails on missed performance targets.
 * Uses isolated storage and a loopback broker in a separate process; never a public broker.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fork } = require('node:child_process');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const electron = require('electron');
const { app, BrowserWindow } = electron;

const PROFILES = {
  quick: { floods: [5000], stream: { rate: 2000, seconds: 10 } },
  full: { floods: [5000, 20000, 50000], stream: { rate: 5000, seconds: 60 } },
};
const profileName = process.env.LOAD_PROFILE || 'quick';
const profile = PROFILES[profileName];
if (!profile) throw new Error(`Unknown LOAD_PROFILE ${profileName}`);
const TARGETS = { inputP95Ms: 100, disconnectMs: 500 };

const workspace = path.resolve(__dirname, '../..');
const temporary = path.join(workspace, '.tmp', `load-${process.pid}`);
fs.mkdirSync(temporary, { recursive: true });
app.setPath('userData', temporary);
app.disableHardwareAcceleration();

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

const errors = [];
const windows = [];
app.on('browser-window-created', (_event, window) => windows.push(window));
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(details.message);
  });
});

// The broker runs as plain Node in its own process.
const broker = fork(path.join(__dirname, 'broker.cjs'), [], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
});
const brokerReply = (type) =>
  new Promise((resolve) => {
    const listener = (message) => {
      if (message.type !== type) return;
      broker.off('message', listener);
      resolve(message);
    };
    broker.on('message', listener);
  });
const ask = (message, reply = 'ok') => {
  const result = brokerReply(reply);
  broker.send(message);
  return result;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, label, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(100);
  }
  throw new Error(`Timed out: ${label}`);
}
const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const round = (value) => (value === null ? null : Math.round(value * 10) / 10);
const mib = (kib) => Math.round((kib / 1024) * 10) / 10;

/** Samples memory, queues and responsiveness until stopped. */
function sampler(evaluate) {
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  const samples = { memory: [], input: [], queues: [] };
  let running = true;
  let lastInput = 0;
  const done = (async () => {
    while (running) {
      const metrics = app.getAppMetrics();
      const byType = {};
      for (const metric of metrics)
        byType[metric.type] = (byType[metric.type] ?? 0) + metric.memory.workingSetSize;
      samples.memory.push({ at: Date.now(), ...byType });
      // Input round trip: the renderer must run a click handler and yield back.
      if (Date.now() - lastInput >= 250) {
        lastInput = Date.now();
        const started = performance.now();
        await evaluate(`(() => {
          document.querySelector('.topic-tree-node')?.click();
          return new Promise((resolve) => setTimeout(resolve, 0));
        })()`);
        samples.input.push(performance.now() - started);
      }
      const status = await evaluate(`Promise.all([
        window.electronAPI.mqtt.getTrafficStatus(),
        window.electronAPI.history.status(),
        window.electronAPI.recordings.status(),
      ]).then(([traffic, history, recordings]) => ({
        delivery: traffic.data.pendingMessages + traffic.data.inFlightMessages,
        history: history.data.delivery.pendingMessages + history.data.delivery.inFlightMessages,
        recordings: recordings.data.queuedMessages,
      }))`);
      samples.queues.push(status);
      await sleep(200);
    }
  })();
  return async () => {
    running = false;
    await done;
    loop.disable();
    const lag = await evaluate('window.__lag.splice(0)');
    const peak = (key) => mib(Math.max(0, ...samples.memory.map((sample) => sample[key] ?? 0)));
    const last = samples.memory.at(-1) ?? {};
    // Up to ten evenly spaced points show whether memory plateaus.
    const step = Math.max(1, Math.ceil(samples.memory.length / 10));
    const timeline = samples.memory
      .filter((_, index) => index % step === 0 || index === samples.memory.length - 1)
      .map((sample) => ({
        s: Math.round((sample.at - samples.memory[0].at) / 1000),
        main: mib(sample.Browser ?? 0),
        renderer: mib(sample.Tab ?? 0),
      }));
    return {
      memoryMiB: {
        mainPeak: peak('Browser'),
        rendererPeak: peak('Tab'),
        mainFinal: mib(last.Browser ?? 0),
        rendererFinal: mib(last.Tab ?? 0),
        timeline,
      },
      mainLoopDelayMs: {
        p95: round(loop.percentile(95) / 1e6),
        max: round(loop.max / 1e6),
      },
      rendererTimerLagMs: { p95: round(percentile(lag, 95)), max: round(Math.max(0, ...lag)) },
      inputRoundTripMs: {
        p50: round(percentile(samples.input, 50)),
        p95: round(percentile(samples.input, 95)),
        max: round(Math.max(0, ...samples.input)),
        samples: samples.input.length,
      },
      peakQueues: {
        delivery: Math.max(0, ...samples.queues.map((q) => q.delivery)),
        history: Math.max(0, ...samples.queues.map((q) => q.history)),
        recordings: Math.max(0, ...samples.queues.map((q) => q.recordings)),
      },
    };
  };
}

async function run() {
  // Load main before awaiting anything so it sees Electron's ready event.
  const brokerReady = brokerReply('ready');
  require(path.join(workspace, 'out/main/index.js'));
  const { port } = await brokerReady;
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
  const connections = [...profile.floods.map((count) => `flood-${count}`), 'stream'].map((id) => ({
    id,
    config: {
      name: `Load ${id}`,
      brokerUrl: `mqtt://127.0.0.1:${port}`,
      protocolVersion: 5,
      reconnectPeriod: 0,
      subscriptions: [{ topic: '#', qos: 0 }],
    },
  }));
  await evaluate(
    `localStorage.setItem('mqtt-connections', ${JSON.stringify(JSON.stringify(connections))})`,
  );
  window.webContents.reload();
  await waitFor(() => !window.webContents.isLoading(), 'reload');
  await waitFor(
    () =>
      evaluate(`document.querySelectorAll('.connection-card').length === ${connections.length}`),
    'saved profiles',
  );
  // Renderer timer lag: how late a 50 ms timer fires.
  await evaluate(`window.__lag = [];
    (function tick(last) {
      setTimeout(() => { const now = performance.now(); window.__lag.push(now - last - 50); tick(now); }, 50);
    })(performance.now()); void 0;`);
  const card = (id) =>
    `[...document.querySelectorAll('.connection-card')].find(card => card.textContent.includes('Load ${id}'))`;
  const traffic = async (id) =>
    (await evaluate('window.electronAPI.mqtt.getTrafficStatus()')).data.connections[id] ?? {
      received: 0,
      processed: 0,
      dropped: 0,
    };
  const connect = async (id) => {
    await evaluate(`${card(id)}.click()`);
    await evaluate(`${card(id)}.querySelector('.toggle-btn').click()`);
    await waitFor(
      async () =>
        (await evaluate('window.electronAPI.mqtt.getConnections()')).data[id]?.isConnected,
      `connect ${id}`,
      30_000,
    );
  };
  const disconnect = async (id) => {
    const started = performance.now();
    const result = await evaluate(`window.electronAPI.mqtt.disconnect('${id}')`);
    assert.equal(result.success, true, result.error);
    return performance.now() - started;
  };

  const report = {
    profile: profileName,
    when: new Date().toISOString(),
    machine: {
      cpu: os.cpus()[0]?.model,
      cores: os.cpus().length,
      memoryGiB: Math.round(os.totalmem() / 1024 ** 3),
      platform: `${process.platform} ${os.release()}`,
      electron: process.versions.electron,
    },
    floods: [],
    stream: null,
    targets: TARGETS,
  };

  for (const count of profile.floods) {
    const id = `flood-${count}`;
    await ask({ type: 'retained', count, payloadBytes: 64 });
    const stop = sampler(evaluate);
    const started = Date.now();
    const sent = brokerReply('retainedSent');
    await connect(id);
    await sent;
    await waitFor(async () => (await traffic(id)).received >= count, `${id} received`);
    const receivedMs = Date.now() - started;
    await waitFor(async () => {
      const counts = await traffic(id);
      return counts.processed + counts.dropped >= count;
    }, `${id} processed`);
    const processedMs = Date.now() - started;
    await sleep(500); // Tree statistics refresh on a short throttle.
    const topicsShown = await evaluate(
      "document.querySelector('.topic-tree-stats')?.textContent.match(/([\\d,]+) topics/)?.[1] ?? null",
    );
    const disconnectMs = await disconnect(id);
    const counts = await traffic(id);
    report.floods.push({
      topics: count,
      receivedMs,
      processedMs,
      topicsShown,
      disconnectMs: round(disconnectMs),
      ...counts,
      ...(await stop()),
    });
    assert.equal(counts.received, count);
    assert.equal(counts.processed + counts.dropped, count);
  }

  // Sustained traffic with disk history and a recording; disconnect while it is still arriving.
  const { rate, seconds } = profile.stream;
  await ask({ type: 'retained', count: 0 });
  await connect('stream');
  const recording = await evaluate(
    "window.electronAPI.recordings.start('stream', 'Load stream', 'Load recording')",
  );
  assert.equal(recording.success, true, recording.error);
  const stop = sampler(evaluate);
  const historyBefore = (await evaluate('window.electronAPI.history.status()')).data.store;
  const streaming = ask(
    { type: 'stream', rate, seconds, topics: 500, sizes: [16, 16, 16, 256, 4096] },
    'streamDone',
  );
  await sleep(Math.max(1000, seconds * 1000 - 2000));
  const disconnectMs = await disconnect('stream');
  const sent = await streaming;
  const counts = await traffic('stream');
  const historyAfter = (await evaluate('window.electronAPI.history.status()')).data;
  const recorded = (await evaluate('window.electronAPI.recordings.list()')).data.find(
    (item) => item.id === recording.data.id,
  );
  report.stream = {
    requestedRate: rate,
    seconds,
    brokerSent: sent.sent,
    brokerRate: Math.round(sent.achievedRate),
    brokerMaxBacklog: sent.maxBacklog,
    disconnectMs: round(disconnectMs),
    ...counts,
    historyStored:
      (historyAfter.store?.retainedMessages ?? 0) - (historyBefore?.retainedMessages ?? 0),
    historyError: historyAfter.error ?? null,
    recording: {
      state: recorded.state,
      messages: recorded.messageCount,
      dropped: recorded.dropped,
      bytes: recorded.payloadBytes,
    },
    ...(await stop()),
  };
  assert.equal(recorded.state, 'complete');
  // Everything main received is accounted for: delivered, or counted as dropped.
  assert.ok(counts.processed + counts.dropped <= counts.received);
  assert.ok(recorded.messageCount + recorded.dropped <= counts.received);
  assert.deepEqual(errors, []);

  const misses = [];
  const check = (label, value, limit) => {
    if (value !== null && value > limit) misses.push(`${label}: ${value} > ${limit}`);
  };
  for (const flood of report.floods) {
    check(`flood ${flood.topics} input p95 ms`, flood.inputRoundTripMs.p95, TARGETS.inputP95Ms);
    check(`flood ${flood.topics} disconnect ms`, flood.disconnectMs, TARGETS.disconnectMs);
  }
  check('stream input p95 ms', report.stream.inputRoundTripMs.p95, TARGETS.inputP95Ms);
  check('stream disconnect ms', report.stream.disconnectMs, TARGETS.disconnectMs);
  report.targetMisses = misses;
  const file = path.join(workspace, '.tmp', `load-report-${profileName}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`Load report written to ${file}`);
  if (misses.length) console.log(`Target misses:\n  ${misses.join('\n  ')}`);
  if (misses.length && process.env.LOAD_STRICT === '1')
    throw new Error('Performance targets missed');
}

run().then(
  () => finish(0),
  (error) => {
    console.error(error);
    console.error('Renderer errors:', errors);
    finish(1);
  },
);
function finish(code) {
  broker.send({ type: 'stop' });
  setTimeout(() => broker.kill(), 1000).unref();
  app.once('will-quit', () => app.exit(code));
  app.quit();
}
