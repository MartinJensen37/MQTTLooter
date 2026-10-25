const assert = require('node:assert/strict');

module.exports = async ({ evaluate, waitFor, published, capture }) => {
  const field = (selector, value) =>
    evaluate(`(() => {
    const element=document.querySelector(${JSON.stringify(selector)});
    const prototype=element.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,'value').set.call(element,${JSON.stringify(value)});
    element.dispatchEvent(new Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}));
  })()`);
  const check = (text) =>
    evaluate(
      `[...document.querySelectorAll('.publish-properties label')].find(label=>label.textContent.trim()===${JSON.stringify(text)}).querySelector('input').click()`,
    );
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'F2',bubbles:true}))");
  // The window was reloaded, so Publishing loads again on first use.
  await waitFor(
    () => evaluate("!!document.querySelector('.publish-properties details')"),
    'publishing panel',
  );
  await evaluate("document.querySelector('.publish-properties details').open=true");
  await field('#topic', 'smoke/properties');
  await check('Include MQTT 5 properties');
  await field('[aria-label="Publish response topic"]', 'reply//bytes');
  await field('[aria-label="Publish content type"]', 'application/octet-stream');
  await field('[aria-label="Publish expiry"]', '0');
  await field('[aria-label="Publish payload format"]', 'bytes');
  await check('Include correlation data');
  await field('[aria-label="Publish correlation data"]', '00 ff 80');
  for (let i = 1; i <= 2; i++) {
    await evaluate(
      "[...document.querySelectorAll('.publish-user-properties button')].find(button=>button.textContent==='Add user property').click()",
    );
    await field(`[aria-label="User property ${i} name"]`, 'repeated');
    await field(`[aria-label="User property ${i} value"]`, i === 1 ? 'first' : 'second');
  }
  await capture();
  await evaluate("document.querySelector('.publish-form-publish-btn').click()");
  await waitFor(
    () => published.some((packet) => packet.topic === 'smoke/properties'),
    'publish properties through real form',
  );
  const packet = published.find((packet) => packet.topic === 'smoke/properties');
  assert.deepEqual(packet.properties.correlationData, Buffer.from([0, 255, 128]));
  assert.equal(packet.properties.responseTopic, 'reply//bytes');
  assert.equal(packet.properties.contentType, 'application/octet-stream');
  assert.equal(packet.properties.messageExpiryInterval, 0);
  assert.equal(packet.properties.payloadFormatIndicator, false);
  assert.deepEqual(packet.properties.userProperties.repeated, ['first', 'second']);
  await waitFor(
    () =>
      evaluate(
        "JSON.parse(localStorage.getItem('publish-history-smoke'))?.[0]?.topic === 'smoke/properties'",
      ),
    'publish history saved after acknowledgement',
  );
  const saved = await evaluate("JSON.parse(localStorage.getItem('publish-history-smoke'))[0]");
  assert.deepEqual(saved.properties.correlationData, { encoding: 'base64', data: 'AP+A' });
  const rejected = await evaluate(
    "window.electronAPI.mqtt.publish('smoke','valid/topic','',{properties:{topicAlias:1}})",
  );
  assert.equal(rejected.success, false);
  assert.match(rejected.error, /Unsupported publish property/);
  await check('Include MQTT 5 properties');
};
