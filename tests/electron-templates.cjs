const assert = require('node:assert/strict');

module.exports = async ({ evaluate, waitFor, published, capture }) => {
  const field = (selector, value) =>
    evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', {bubbles:true}));
  })()`);
  await evaluate("document.querySelector('.publish-form-clear-btn').click()");
  await evaluate("document.querySelector('.message-schemas input').click()");
  await evaluate("document.querySelector('.template-select-wrapper > button').click()");
  await evaluate("document.querySelector('.template-dropdown-item .dropdown-option').click()");
  await waitFor(
    () =>
      evaluate("document.querySelector('.schema-validation')?.textContent === 'Matches schema'"),
    'typed default template',
  );
  assert.equal(
    await evaluate("document.querySelector('#topic').value"),
    'sensors/sensor-01/reading',
  );
  await field('[aria-label="Schema variable sensorId"]', 'sensor"01');
  await evaluate("document.querySelector('.publish-template-variables button').click()");
  const payload = await evaluate("document.querySelector('#payload').value");
  const topic = await evaluate("document.querySelector('#topic').value");
  assert.equal(topic, 'sensors/sensor"01/reading');
  assert.equal(JSON.parse(payload).sensorId, 'sensor"01');
  assert.equal(typeof JSON.parse(payload).temperature, 'number');
  assert.ok(!Number.isNaN(Date.parse(JSON.parse(payload).time)));
  await capture();
  const start = published.length;
  await evaluate("document.querySelector('.publish-form-publish-btn').click()");
  await waitFor(
    () => published.slice(start).some((packet) => packet.topic === topic),
    'typed template MQTT packet',
  );
  assert.equal(
    published
      .slice(start)
      .find((packet) => packet.topic === topic)
      .payload.toString(),
    payload,
  );
  await waitFor(
    () =>
      evaluate(
        `JSON.parse(localStorage.getItem('publish-history-smoke'))?.[0]?.topic === ${JSON.stringify(topic)}`,
      ),
    'template acknowledgement',
  );
  await evaluate("document.querySelector('.message-schemas input').click()");
};
