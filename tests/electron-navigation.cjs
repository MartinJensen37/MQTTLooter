const assert = require('node:assert/strict');

module.exports = async function checkNavigation({ evaluate, waitFor, field, send }) {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 250));
  const topicCount = () =>
    evaluate("parseInt(document.querySelector('.topic-tree-stats .stat-item').textContent, 10)");
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'F1', bubbles:true}))");
  await evaluate('document.querySelector(\'[title="Collapse all topics"]\').click()');
  await field('[aria-label="Search topics"]', 'a//b');
  await waitFor(
    () => evaluate('!!document.querySelector(\'.topic-tree-node[title="a//b"]\')'),
    'search collapsed exact paths',
  );
  await field('[aria-label="Search topics"]', 'no-such-topic');
  assert.ok(
    await evaluate(
      "document.querySelector('.topic-tree-empty').textContent.includes('No topics match')",
    ),
  );
  await evaluate('document.querySelector(\'[aria-label="Clear topic search"]\').click()');
  assert.equal(
    await evaluate('!!document.querySelector(\'.topic-tree-node[title="a//b"]\')'),
    false,
  );

  const initial = await topicCount();
  send('before/initial', 'first');
  for (let i = 0; i < 2000; i++) send(`load/${String(i).padStart(4, '0')}`, 'value');
  await waitFor(async () => (await topicCount()) === initial + 2001, 'two thousand topics');
  await evaluate('document.querySelector(\'[title="Expand all topics"]\').click()');
  await settle();
  await evaluate("document.querySelector('.topic-tree-content').scrollTop = 38005");
  await settle();
  const anchor = await evaluate(`(() => {
    const list = document.querySelector('.topic-tree-content');
    const top = list.getBoundingClientRect().top;
    const row = [...list.querySelectorAll('[data-scroll-key]')].find(row => row.getBoundingClientRect().bottom > top + 1);
    return {key:row.dataset.scrollKey, offset:row.getBoundingClientRect().top - top};
  })()`);
  for (let i = 0; i < 50; i++) send(`before/new-${i}`, 'insert before viewport');
  await waitFor(async () => (await topicCount()) === initial + 2051, 'earlier branch growth');
  await settle();
  const position = await evaluate(`(() => {
    const list = document.querySelector('.topic-tree-content');
    const row = [...list.querySelectorAll('[data-scroll-key]')].find(row => row.dataset.scrollKey === ${JSON.stringify(anchor.key)});
    return row ? row.getBoundingClientRect().top - list.getBoundingClientRect().top : null;
  })()`);
  assert.notEqual(position, null, 'topic anchor still rendered');
  assert.ok(Math.abs(position - anchor.offset) < 2, `Topic moved: ${anchor.offset} to ${position}`);
  await evaluate(
    `[...document.querySelectorAll('.topic-tree-content [data-scroll-key]')].find(row => row.dataset.scrollKey === ${JSON.stringify(anchor.key)}).querySelector('.topic-tree-node').click()`,
  );
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('.filter-indicator').textContent.includes(${JSON.stringify(anchor.key)})`,
      ),
    'stable topic selection',
  );

  // Exercise variable-height rows and the 300-message rolling history in the actual browser.
  for (let i = 0; i < 300; i++)
    send(anchor.key, i % 2 ? `sample-${i}` : `sample-${i}: ${'long text '.repeat(12)}`);
  await waitFor(
    () => evaluate("document.querySelectorAll('.message-item').length === 300"),
    'full message history',
  );
  await settle();
  assert.equal(await evaluate("document.querySelector('.message-list').scrollTop"), 0);
  await evaluate("document.querySelector('.message-list').scrollTop = 1300");
  await waitFor(
    () =>
      evaluate("document.querySelector('.topic-actions-section').textContent.includes('Pinned')"),
    'automatic pin',
  );
  const capture = () =>
    evaluate(`(() => {
    const list = document.querySelector('.message-list'); const top = list.getBoundingClientRect().top;
    const row = [...list.querySelectorAll('.message-item')].find(row => row.getBoundingClientRect().bottom > top + 1);
    return {key:row.dataset.scrollKey, offset:row.getBoundingClientRect().top - top};
  })()`);
  const assertAnchor = async (saved) => {
    const offset = await evaluate(`(() => {
      const list = document.querySelector('.message-list');
      const row = [...list.querySelectorAll('.message-item')].find(row => row.dataset.scrollKey === ${JSON.stringify(saved.key)});
      return row ? row.getBoundingClientRect().top - list.getBoundingClientRect().top : null;
    })()`);
    assert.notEqual(offset, null, 'message anchor remains in history');
    assert.ok(Math.abs(offset - saved.offset) < 2, `Message moved: ${saved.offset} to ${offset}`);
  };
  const descending = await capture();
  for (let i = 0; i < 10; i++) send(anchor.key, `newest-${i}`);
  await waitFor(
    () => evaluate("document.querySelector('.message-item').textContent.includes('newest-9')"),
    'newest messages',
  );
  await settle();
  await assertAnchor(descending);
  await evaluate("document.querySelector('.message-list').scrollTop = 0");
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.topic-actions-section').textContent.includes('Following')",
      ),
    'resume following at top',
  );
  send(anchor.key, 'follow-newest');
  await waitFor(
    () => evaluate("document.querySelector('.message-item').textContent.includes('follow-newest')"),
    'follow newest',
  );
  assert.equal(await evaluate("document.querySelector('.message-list').scrollTop"), 0);

  await field('.message-filters select', 'asc');
  await settle();
  assert.equal(await evaluate("document.querySelector('.message-list').scrollTop"), 0);
  await evaluate("document.querySelector('.message-list').scrollTop = 1800");
  await settle();
  const ascending = await capture();
  for (let i = 0; i < 5; i++) send(anchor.key, `ascending-new-${i}`);
  await waitFor(
    () =>
      evaluate(
        "[...document.querySelectorAll('.message-item')].at(-1).textContent.includes('ascending-new-4')",
      ),
    'ascending appends',
  );
  await settle();
  await assertAnchor(ascending);
  await evaluate("document.querySelector('.message-list').scrollTop = 0");
  await settle();
  send(anchor.key, 'follow-oldest');
  await waitFor(
    () =>
      evaluate(
        "[...document.querySelectorAll('.message-item')].at(-1).textContent.includes('follow-oldest')",
      ),
    'oldest-first history update',
  );
  assert.equal(await evaluate("document.querySelector('.message-list').scrollTop"), 0);
};
