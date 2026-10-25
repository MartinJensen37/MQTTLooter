const assert = require('node:assert/strict');

module.exports = async ({ evaluate, waitFor, clickButton, published, capture }) => {
  const setting = (label, value) =>
    evaluate(`(() => {
    const element = [...document.querySelectorAll('.device-settings label')]
      .find(label => label.textContent.trim().startsWith(${JSON.stringify(label)})).querySelector('select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await setting('Publishing mode', 'combined');
  await setting('Payload structure', 'template');
  await waitFor(
    () => evaluate('!!document.querySelector(\'[aria-label="Payload template"]\')'),
    'template editor',
  );
  // The starting template names every signal and is valid as-is.
  const template = JSON.parse(
    await evaluate('document.querySelector(\'[aria-label="Payload template"]\').value'),
  );
  assert.equal(template.device, 'Smoke machine');
  assert.equal(Object.keys(template.values).length, 3);
  await capture();
  const start = published.length;
  await clickButton('.simulation-panel', 'Publish Once');
  await waitFor(
    () => published.slice(start).some((packet) => packet.topic === 'smoke/device'),
    'templated device payload',
  );
  const payload = JSON.parse(
    published
      .slice(start)
      .find((packet) => packet.topic === 'smoke/device')
      .payload.toString(),
  );
  assert.equal(payload.device, 'Smoke machine');
  assert.equal(new Date(payload.timestamp).toISOString(), payload.timestamp);
  assert.deepEqual(Object.keys(payload.values), Object.keys(template.values));
  // Whole-string placeholders become each signal's typed value.
  assert.equal(payload.values.speed, 30);
  assert.equal(typeof payload.values.cycles, 'number');
  assert.ok(['idle', 'running', 'cooling'].includes(payload.values.state));
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.simulation-panel .device-config-header [role=status]')?.textContent === 'Stopped'",
      ),
    'template publish completion',
  );
  await setting('Publishing mode', 'signals');
};
