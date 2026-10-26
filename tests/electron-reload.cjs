const assert = require('node:assert/strict');

module.exports = async function checkReload({ window, evaluate, waitFor, send }) {
  const connections = await evaluate('window.electronAPI.mqtt.getConnections()');
  assert.equal(connections.data.smoke.isConnected, true, 'reload needs an active broker');
  // A busy broker keeps publishing while the renderer reloads. Delay script startup
  // to reproduce a batch arriving before the renderer installs its IPC listeners.
  let delayedRequests = 0;
  const webRequest = window.webContents.session.webRequest;
  webRequest.onBeforeRequest({ urls: ['file:///*'] }, (details, callback) => {
    if (details.url.endsWith('.js')) {
      delayedRequests++;
      setTimeout(() => callback({}), 500);
    } else callback({});
  });
  let sequence = 0;
  const timer = setInterval(() => send('reload/live', String(++sequence)), 10);
  // Captures run in main, so a renderer reload must not stop or thin out a recording.
  const started = await evaluate(
    "window.electronAPI.recordings.start('smoke', 'Smoke broker', 'Across reload')",
  );
  assert.equal(started.success, true, started.error);
  try {
    window.webContents.reload();
    await waitFor(() => !window.webContents.isLoading(), 'reload with incoming traffic');
    await waitFor(
      () => evaluate("!!document.querySelector('.connection-card')"),
      'reloaded profile',
    );
    await evaluate("document.querySelector('.connection-card').click()");
    await waitFor(
      () =>
        evaluate("document.querySelector('.topic-tree-stats')?.textContent.includes('1 topics')"),
      'topics after live reload',
    );
    await evaluate('document.querySelector(\'[title="Expand all topics"]\').click()');
    await waitFor(
      () => evaluate('!!document.querySelector(\'.topic-tree-node[title="reload/live"]\')'),
      'reloaded topic row',
    );
    await evaluate('document.querySelector(\'.topic-tree-node[title="reload/live"]\').click()');
    assert.ok(delayedRequests > 0, 'renderer script loading was delayed');
    const checkpoint = sequence;
    await waitFor(
      () =>
        evaluate(`Number(document.querySelector('.payload-preview')?.textContent) > ${checkpoint}`),
      'live messages continue after reload',
    );
    // The window blocks page navigation, so the same page keeps running and must keep receiving.
    await evaluate(
      "window.sameDocument = true; setTimeout(() => { location.href = 'https://example.invalid/'; }); true",
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(await evaluate('window.sameDocument'), true, 'navigation was blocked');
    const blocked = sequence;
    await waitFor(
      () =>
        evaluate(`Number(document.querySelector('.payload-preview')?.textContent) > ${blocked}`),
      'live messages continue after a blocked navigation',
    );
    const status = await evaluate('window.electronAPI.mqtt.getTrafficStatus()');
    assert.ok(status.data.connections.smoke.processed > 0);
    const recording = await evaluate('window.electronAPI.recordings.status()');
    assert.deepEqual(
      recording.data.active.map((capture) => capture.recordingId),
      [started.data.id],
    );
    const stopped = await evaluate("window.electronAPI.recordings.stop('smoke')");
    assert.equal(stopped.data.state, 'complete');
    assert.equal(stopped.data.dropped, 0);
    const values = [];
    for (let after = 0; ; ) {
      const page = await evaluate(
        `window.electronAPI.recordings.page({ recordingId: ${started.data.id}, after: ${after}, limit: 512 })`,
      );
      values.push(...page.data.messages.map((message) => Number(message.message)));
      if (page.data.cursor === null) break;
      after = page.data.cursor;
    }
    assert.ok(values.length > 20, `captured ${values.length} messages across reload`);
    values.forEach((value, index) => index && assert.equal(value, values[index - 1] + 1));
  } finally {
    clearInterval(timer);
    webRequest.onBeforeRequest(null);
  }
};
