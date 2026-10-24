const assert = require('node:assert/strict');

module.exports = async ({ evaluate, waitFor, field, send, captureSearch }) => {
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

  await field('[aria-label="Message order"]', 'desc');
  await field('[aria-label="Message source"]', 'stored');
  await field('[aria-label="Search stored topics"]', 'archive/series');
  await waitFor(
    () =>
      evaluate(
        "[...document.querySelector('[aria-label=\"Stored topic\"]').options].some(option=>option.value==='archive/series')",
      ),
    'stored topic catalog',
  );
  await field('[aria-label="Stored topic"]', 'archive/series');
  await waitFor(
    () => evaluate("document.querySelector('.message-item')?.textContent.includes('649')"),
    'stored page UI',
  );
  await evaluate(
    "[...document.querySelectorAll('.message-history-toolbar button')].find(button=>button.textContent==='Older page').click()",
  );
  await waitFor(
    () => evaluate("document.querySelector('.message-item')?.textContent.includes('349')"),
    'older page UI',
  );
  assert.equal(await evaluate("document.querySelectorAll('.message-item').length"), 300);
  await evaluate(
    "[...document.querySelectorAll('.message-history-toolbar button')].find(button=>button.textContent==='Newer page').click()",
  );
  await waitFor(
    () => evaluate("document.querySelector('.message-item')?.textContent.includes('649')"),
    'newer page UI',
  );

  const status = await evaluate('window.electronAPI.history.status()');
  await evaluate(
    "[...document.querySelectorAll('.message-history-toolbar button')].find(button=>button.textContent==='Search message contents').click()",
  );
  await field('[aria-label="Search message contents"]', '123');
  await evaluate("document.querySelector('.history-search form').requestSubmit()");
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.history-search .message-item')?.textContent.includes('123')",
      ),
    'content match outside loaded page',
  );
  assert.equal(
    await evaluate("document.querySelectorAll('.history-search .message-item').length"),
    1,
  );
  await captureSearch?.();
  assert.equal(
    (
      await evaluate(
        "window.electronAPI.history.search({connectionId:'smoke',topic:'archive/series',mode:'hex',term:'x',from:Date.now()-1000,to:Date.now()})",
      )
    ).success,
    false,
  );
  await evaluate(
    "[...document.querySelectorAll('.message-history-toolbar button')].find(button=>button.textContent==='Close content search').click()",
  );
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
  await field('[aria-label="Message source"]', 'live');
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
  await field('[aria-label="Payload view"]', 'json');
  await evaluate("document.querySelector('.payload-full').open = true");
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
