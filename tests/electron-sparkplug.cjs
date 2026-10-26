const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const protobuf = require('protobufjs');

// The schema the app builds in, read from its source so both sides always agree.
const source = fs.readFileSync(path.join(__dirname, '../src/main/sparkplug.ts'), 'utf8');
const start = source.indexOf('`') + 1;
const Payload = protobuf
  .parse(source.slice(start, source.indexOf('`', start)), { keepCase: true })
  .root.lookupType('org.eclipse.tahu.protobuf.Payload');
const encode = (value) => Buffer.from(Payload.encode(Payload.fromObject(value)).finish());

module.exports = async ({ evaluate, waitFor, field, send, published, menu }) => {
  const enable = async (on) => {
    menu('settings');
    await waitFor(() => evaluate("!!document.querySelector('.settings-dialog')"), 'settings');
    await evaluate(`(() => {
      const input = [...document.querySelectorAll('.settings-dialog label')]
        .find(label => label.textContent.trim() === 'Sparkplug B').querySelector('input');
      if (input.checked !== ${on}) input.click();
    })()`);
    await evaluate('document.querySelector(\'[aria-label="Close settings"]\').click()');
  };
  await enable(true);
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'F1', bubbles:true}))");

  // Data after the birth names its metric by alias only.
  send(
    'spBv1.0/Smoke/NBIRTH/Edge1',
    encode({
      timestamp: Date.now(),
      seq: 0,
      metrics: [
        { name: 'bdSeq', alias: 0, datatype: 8, long_value: 0 },
        { name: 'Temperature', alias: 7, datatype: 9, float_value: 20 },
      ],
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 200));
  for (let seq = 1; seq <= 3; seq++)
    send(
      'spBv1.0/Smoke/NDATA/Edge1',
      encode({ timestamp: Date.now(), seq, metrics: [{ alias: 7, float_value: 20 + seq / 2 }] }),
    );

  const topic = 'spBv1.0/Smoke/NDATA/Edge1';
  const node = `document.querySelector('.topic-tree-node[title="${topic}"]')`;
  await field('[aria-label="Search topics"]', topic);
  await waitFor(() => evaluate(`!!${node}`), 'Sparkplug topic in the tree');
  assert.equal(await evaluate(`!!${node}.querySelector('.spb-badge')`), true, 'tree badge');
  await evaluate(`${node}.click()`);
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.message-item .payload-preview')?.textContent.includes('\"Temperature\"')",
      ),
    'aliased metric decoded with its birth name',
  );
  assert.equal(await evaluate("!!document.querySelector('.message-item .spb-badge')"), true);

  // Plots decode stored history in the history worker, which saw the birth too.
  const series = await evaluate(`window.electronAPI.history.series({
    connectionId: 'smoke', topic: ${JSON.stringify(topic)}, paths: [['metrics', 'Temperature', 'value']],
    from: Date.now() - 60000, to: Date.now() + 1000, maxPoints: 64, decoderId: 'sparkplug-b' })`);
  assert.equal(series.success, true, series.error);
  assert.equal(series.data.series[0].valid, 3);
  assert.deepEqual(series.data.availablePaths[0], ['metrics', 'Temperature', 'value']);

  await evaluate("document.querySelector('.spb-details input').click()");
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.spb-details')?.textContent.includes('Online since') && document.querySelector('.spb-metrics')?.textContent.includes('21.5')",
      ),
    'edge node state and metrics',
  );
  const before = published.length;
  await evaluate(
    "[...document.querySelectorAll('.spb-details button')].find(button => button.textContent.includes('Request rebirth')).click()",
  );
  await waitFor(
    () => published.slice(before).some((packet) => packet.topic === 'spBv1.0/Smoke/NCMD/Edge1'),
    'rebirth command',
  );
  const command = published.slice(before).find((packet) => packet.topic.endsWith('NCMD/Edge1'));
  const metric = Payload.toObject(Payload.decode(command.payload)).metrics[0];
  assert.equal(metric.name, 'Node Control/Rebirth');
  assert.equal(metric.boolean_value, true);

  // Turned off, the tools and badges go away.
  await enable(false);
  await waitFor(
    () => evaluate("!document.querySelector('.spb-details, .spb-badge')"),
    'Sparkplug tools hidden',
  );
  await field('[aria-label="Search topics"]', '');
};
