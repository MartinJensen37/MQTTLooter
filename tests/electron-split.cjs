const assert = require('node:assert/strict');

module.exports = async ({ evaluate, waitFor, field, capture }) => {
  await evaluate(
    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true }))",
  );
  await evaluate(`document.querySelector('[title="Show a second tab beside this one"]').click()`);
  await waitFor(
    () => evaluate("!!document.querySelector('.tab-content.secondary')"),
    'second pane',
  );
  const panes = () =>
    evaluate(`(() => {
      const box = (selector) => document.querySelector(selector).getBoundingClientRect();
      const active = box('.tab-content.active');
      const secondary = box('.tab-content.secondary');
      return { activeRight: active.right, activeWidth: active.width,
        secondaryLeft: secondary.left, secondaryWidth: secondary.width,
        secondaryText: document.querySelector('.tab-content.secondary').textContent.slice(0, 200) };
    })()`);
  const layout = await panes();
  assert.ok(layout.activeWidth > 200 && layout.secondaryWidth > 200, JSON.stringify(layout));
  assert.ok(layout.activeRight <= layout.secondaryLeft + 1, JSON.stringify(layout));
  // Logging stays live beside Publishing; both panels are the single mounted instances.
  assert.ok(await evaluate("!!document.querySelector('.tab-content.active .message-workspace')"));
  assert.ok(await evaluate("!!document.querySelector('.tab-content.secondary .publishing-panel')"));

  await evaluate(`(() => {
    const divider = document.querySelector('[aria-label="Resize split view"]');
    divider.focus();
    divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  })()`);
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('[aria-label=\"Resize split view\"]').getAttribute('aria-valuenow') === '45'",
      ),
    'keyboard resize',
  );
  await field('[aria-label="Second pane"]', 'simulation');
  await waitFor(
    () => evaluate("!!document.querySelector('.tab-content.secondary .simulation-panel')"),
    'simulation in second pane',
  );
  await capture();
  const saved = await evaluate("JSON.parse(localStorage.getItem('mqtt-sidebar-state'))");
  assert.equal(saved.splitTab, 'simulation');
  assert.equal(saved.splitRatio, 0.45);
  await evaluate(`document.querySelector('[title="Close split view"]').click()`);
  await waitFor(
    () => evaluate("!document.querySelector('.tab-content.secondary')"),
    'split closed',
  );
};
