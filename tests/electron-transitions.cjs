const assert = require('node:assert/strict');

module.exports = async ({ evaluate, waitFor, field, clickButton, published, capture }) => {
  await evaluate('document.querySelector(\'[aria-label="Edit speed"]\').click()');
  await field('.signal-dialog select', 'number');
  const setting = (label, value) =>
    evaluate(`(() => {
    const element = [...document.querySelectorAll('.signal-dialog label')]
      .find(label => label.textContent.trim().startsWith(${JSON.stringify(label)})).querySelector('input,select');
    const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true}));
  })()`);
  for (const generator of ['ramp', 'response', 'step']) {
    await setting('Generator', generator);
    await setting('Starting value', '10');
    await setting('Final value', '30');
    await setting('Transition delay', generator === 'step' ? '0' : '500');
    if (generator === 'ramp') {
      await setting('Ramp duration', '0');
      await waitFor(
        () => evaluate("!!document.querySelector('.signal-dialog [role=alert]')"),
        'invalid ramp duration',
      );
      await setting('Ramp duration', '2000');
    }
    if (generator === 'response') await setting('Time constant', '500');
    await waitFor(
      () =>
        evaluate(
          `document.querySelector('.signal-waveform svg')?.getAttribute('aria-label').startsWith('${generator} waveform')`,
        ),
      `${generator} preview`,
    );
    assert.equal(
      await evaluate(
        "[...document.querySelectorAll('.signal-waveform path')].every(path => !/NaN|Infinity/.test(path.getAttribute('d')))",
      ),
      true,
    );
    if (generator === 'response') await capture();
  }
  await clickButton('.signal-dialog', 'Save Signal');
  const start = published.length;
  await clickButton('.simulation-panel', 'Publish Once');
  await waitFor(
    () => published.slice(start).some((packet) => packet.topic === 'smoke/custom-speed'),
    'step publishes through MQTT',
  );
  assert.equal(
    published
      .slice(start)
      .find((packet) => packet.topic === 'smoke/custom-speed')
      .payload.toString(),
    '30',
  );
  const saved = await evaluate(
    "JSON.parse(localStorage.getItem('mqtt-simulation-devices-smoke'))[0].outputs[0]",
  );
  assert.equal(saved.generator, 'step');
  assert.equal(saved.config.delayMs, 0);
};
