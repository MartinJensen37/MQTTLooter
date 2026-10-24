const assert = require('node:assert/strict');

module.exports = async ({ evaluate, waitFor, field, send }) => {
  const click = (text) =>
    evaluate(
      `[...document.querySelectorAll('button')].find(button => (button.getAttribute('aria-label') || button.textContent.trim()) === ${JSON.stringify(text)}).click()`,
    );
  for (let i = 0; i < 100; i++)
    send('plots/temperature', JSON.stringify({ temperature: Math.sin(i / 10), pressure: i }));
  await field('[aria-label="Search topics"]', 'plots/temperature');
  await waitFor(
    () => evaluate('!!document.querySelector(\'.topic-tree-node[title="plots/temperature"]\')'),
    'plot topic',
  );
  await evaluate('document.querySelector(\'.topic-tree-node[title="plots/temperature"]\').click()');
  await field('[aria-label="Message display"]', 'plot');
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.incoming-plot-field')?.textContent.includes('/temperature')",
      ),
    'automatic JSON field',
  );
  assert.equal(
    await evaluate("document.querySelectorAll('.message-workspace .message-item').length"),
    0,
  );
  assert.equal(
    await evaluate("document.querySelector('.message-workspace .message-list') === null"),
    true,
  );
  assert.equal(await evaluate("!!document.querySelector('.message-panel > .incoming-plot')"), true);
  assert.equal(
    await evaluate(
      "document.querySelector('.topic-details-box').getBoundingClientRect().bottom <= document.querySelector('.incoming-plot').getBoundingClientRect().top",
    ),
    true,
  );
  await field('[aria-label="Numeric field path"]', '/pressure');
  await click('Add field');
  await waitFor(
    () =>
      evaluate(
        "document.querySelectorAll('.incoming-plot-field').length === 2 && document.querySelector('.incoming-plot-readout')?.textContent.includes('99 at')",
      ),
    'second numeric series',
  );
  await click('Pause plot');
  await waitFor(
    () =>
      evaluate(
        "[...document.querySelectorAll('.incoming-plot button')].some(button => button.textContent === 'Resume live plot')",
      ),
    'paused plot',
  );
  send('plots/temperature', '{"temperature":42,"pressure":12345}');
  await waitFor(
    async () =>
      (
        await evaluate(
          "window.electronAPI.history.page({connectionId:'smoke',topic:'plots/temperature'})",
        )
      ).data.messages[0].message.includes('12345'),
    'paused plot still captures',
  );
  assert.equal(
    await evaluate(
      "document.querySelector('.incoming-plot-readout').textContent.includes('12345')",
    ),
    false,
  );
  await click('Resume live plot');
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.incoming-plot-readout')?.textContent.includes('12345 at')",
      ),
    'resumed plot',
  );
  await click('Zoom in plot');
  await waitFor(
    () => evaluate("document.querySelector('[aria-label=\"Plot window\"]').value === '30000'"),
    'plot zoom',
  );
  assert.equal(
    await evaluate(
      "[...document.querySelectorAll('.incoming-plot path')].every(path => !/NaN|Infinity/.test(path.getAttribute('d')))",
    ),
    true,
  );
  await evaluate(`(() => {
    const svg = document.querySelector('.incoming-plot svg');
    const rect = svg.getBoundingClientRect();
    svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: rect.left, clientY: rect.top + 30 }));
  })()`);
  await waitFor(
    () => evaluate("document.querySelector('[aria-label=\"Plot time cursor\"]').value === '0'"),
    'hover sample cursor',
  );
  await field('[aria-label="Plot time cursor"]', '1');
  assert.equal(
    (
      await evaluate(
        "window.electronAPI.history.series({connectionId:'smoke',topic:'plots/temperature',from:0,to:Date.now(),paths:[[]],maxPoints:100000})",
      )
    ).success,
    false,
  );
};
