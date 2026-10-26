const assert = require('node:assert/strict');
const fs = require('node:fs');

module.exports = async ({ evaluate, waitFor, field, send, captureSearch, saveTo }) => {
  for (let i = 0; i < 650; i++) send('archive/series', String(i));
  await waitFor(async () => {
    const result = await evaluate(
      "window.electronAPI.history.page({connectionId:'smoke',topic:'archive/series'})",
    );
    return result.success && result.data.messages[0]?.message === '649';
  }, 'disk history commit');
  const first = await evaluate(
    "window.electronAPI.history.page({connectionId:'smoke',topic:'archive/series'})",
  );
  assert.equal(first.data.messages.length, 300);
  const second = await evaluate(
    `window.electronAPI.history.page({connectionId:'smoke',topic:'archive/series',before:${first.data.nextBefore},snapshot:${first.data.snapshot},generation:${first.data.generation}})`,
  );
  assert.equal(second.data.messages[0].message, '349');
  assert.equal(second.data.messages.at(-1).message, '50');
  assert.equal(
    (
      await evaluate(
        "window.electronAPI.history.page({connectionId:'smoke',topic:'archive/series',before:-1})",
      )
    ).success,
    false,
  );

  // Selecting a topic shows the live cache at once and loads the rest of disk history.
  await field('[aria-label="Search topics"]', 'archive/series');
  await waitFor(
    () => evaluate('!!document.querySelector(\'.topic-tree-node[title="archive/series"]\')'),
    'stored topic in tree',
  );
  await evaluate('document.querySelector(\'.topic-tree-node[title="archive/series"]\').click()');
  await field('[aria-label="Message order"]', 'desc');
  const heading = "document.querySelector('.message-panel h2')?.textContent";
  await waitFor(async () => (await evaluate(heading))?.includes('Messages (650)'), 'all stored');
  assert.ok(
    (await evaluate("document.querySelector('.message-item').textContent")).includes('649'),
  );
  // Cards render in steps as the list scrolls.
  assert.equal(await evaluate("document.querySelectorAll('.message-item').length"), 200);
  await field('[aria-label="Messages shown"]', '300');
  await waitFor(async () => (await evaluate(heading))?.includes('Messages (300)'), 'newest 300');
  await field('[aria-label="Messages shown"]', 'all');
  await waitFor(async () => (await evaluate(heading))?.includes('Messages (650)'), 'all again');
  // Export every stored message through main's streamed export.
  const exportFile = saveTo('archive-export.json');
  await evaluate(`document.querySelector('[title="Export topic data"]').click()`);
  await evaluate(
    "[...document.querySelectorAll('.message-export-wrapper .dropdown-option')].find(button => button.textContent.includes('Full disk history as JSON')).click()",
  );
  await waitFor(() => fs.existsSync(exportFile), 'whole-topic export file');
  const exported = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
  assert.equal(exported.topic, 'archive/series');
  assert.equal(exported.messageCount, 650);
  assert.deepEqual([exported.messages[0].payload, exported.messages.at(-1).payload], ['0', '649']);

  const status = await evaluate('window.electronAPI.history.status()');
  // Content search covers the topic's whole stored history.
  await field('[aria-label="Search message contents"]', '123');
  await waitFor(async () => (await evaluate(heading))?.includes('Matches (1)'), 'content match');
  assert.ok(
    (await evaluate("document.querySelector('.message-item').textContent")).includes('123'),
  );
  await captureSearch?.();
  // Every match, streamed from main.
  const searchExport = saveTo('search-export.csv');
  await evaluate(`document.querySelector('[title="Export topic data"]').click()`);
  await evaluate(
    "[...document.querySelectorAll('.message-export-wrapper .dropdown-option')].find(button => button.textContent.includes('All matches as CSV')).click()",
  );
  await waitFor(() => fs.existsSync(searchExport), 'search export file');
  const rows = fs.readFileSync(searchExport, 'utf8').split('\n');
  assert.equal(rows.length, 2);
  assert.ok(rows[1].includes('"123"'), rows[1]);
  assert.equal(
    (
      await evaluate(
        "window.electronAPI.history.search({connectionId:'smoke',topic:'archive/series',mode:'hex',term:'x',from:Date.now()-1000,to:Date.now()})",
      )
    ).success,
    false,
  );
  await field('[aria-label="Search message contents"]', '');
  assert.equal(status.success, true);
  assert.equal(status.data.error, undefined);
  assert.equal(status.data.delivery.connections.smoke.dropped, 0);
  const cleared = await evaluate("window.electronAPI.history.clear('smoke','archive/series')");
  assert.equal(cleared.success, true);
  assert.deepEqual(
    (
      await evaluate(
        "window.electronAPI.history.page({connectionId:'smoke',topic:'archive/series'})",
      )
    ).data.messages,
    [],
  );
  assert.equal(
    (
      await evaluate(
        `window.electronAPI.history.page({connectionId:'smoke',topic:'archive/series',generation:${first.data.generation}})`,
      )
    ).success,
    false,
  );
  send('archive/json', '{"count":9007199254740993,"values":[1,2]}');
  await field('[aria-label="Search topics"]', 'archive/json');
  await waitFor(
    () => evaluate('!!document.querySelector(\'.topic-tree-node[title="archive/json"]\')'),
    'JSON topic',
  );
  await evaluate('document.querySelector(\'.topic-tree-node[title="archive/json"]\').click()');
  await waitFor(
    () => evaluate('!!document.querySelector(\'[aria-label="Payload view"]\')'),
    'payload selector',
  );
  // Auto view indents JSON while keeping exact numbers.
  assert.equal(
    await evaluate('document.querySelector(\'[aria-label="Payload view"]\').value'),
    'auto',
  );
  await evaluate("document.querySelector('.payload-full input').click()");
  await waitFor(
    () =>
      evaluate("document.querySelector('.payload-code')?.textContent.includes('9007199254740993')"),
    'pretty JSON precision',
  );
  assert.equal(
    await evaluate("getComputedStyle(document.querySelector('.payload-code')).resize"),
    'vertical',
  );
  await field('[aria-label="Message display"]', 'plain');
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.message-plain-entry')?.textContent.includes('9007199254740993')",
      ),
    'plain log',
  );
  await field('[aria-label="Message display"]', 'cards');
};
