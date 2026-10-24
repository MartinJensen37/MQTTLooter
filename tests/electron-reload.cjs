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
    const status = await evaluate('window.electronAPI.mqtt.getTrafficStatus()');
    assert.ok(status.data.connections.smoke.processed > 0);
  } finally {
    clearInterval(timer);
    webRequest.onBeforeRequest(null);
  }
};
