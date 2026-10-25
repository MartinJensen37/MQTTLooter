const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const protobuf = require('protobufjs');

const proto = `syntax = "proto3";
package smoke;
message Reading { string id = 1; double value = 2; int64 count = 3; }`;

module.exports = async ({ evaluate, waitFor, field, send, userData, capture }) => {
  const type = protobuf.parse(proto).root.lookupType('smoke.Reading');
  const payload = Buffer.from(
    type.encode(type.fromObject({ id: 'pump', value: 2.5, count: '9007199254740993' })).finish(),
  );
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(button => button.textContent.trim().startsWith(${JSON.stringify(text)}))`;

  // Add the decoder through the real dialog and a real file input.
  await evaluate(`${button('Decoders')}.click()`);
  await waitFor(() => evaluate("!!document.querySelector('.decoder-dialog')"), 'decoder dialog');
  await evaluate(`(() => {
    const input = document.querySelector('[aria-label="Protobuf schema file"]');
    const transfer = new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(proto)}], 'smoke.proto', { type: 'text/plain' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('[aria-label=\"Message type\"]')?.value === 'smoke.Reading'",
      ),
    'message types from .proto',
  );
  await field('[aria-label="Decoder topic filter"]', 'proto/+/reading');
  await evaluate(`${button('Add decoder')}.click()`);
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('[aria-label=\"Saved decoders\"]')?.textContent.includes('smoke.Reading')",
      ),
    'saved decoder',
  );
  await capture();
  await evaluate(`${button('Close')}.click()`);
  assert.ok(
    fs.readFileSync(path.join(userData, 'decoders.json'), 'utf8').includes('smoke.Reading'),
  );

  send('proto/pump/reading', payload);
  await field('[aria-label="Search topics"]', 'proto/pump/reading');
  await waitFor(
    () => evaluate('!!document.querySelector(\'.topic-tree-node[title="proto/pump/reading"]\')'),
    'protobuf topic',
  );
  await evaluate(
    'document.querySelector(\'.topic-tree-node[title="proto/pump/reading"]\').click()',
  );
  // Decoded in main: 64-bit integers stay exact, and the original bytes are untouched.
  await waitFor(
    () =>
      evaluate(
        'document.querySelector(\'.message-item .payload-preview\')?.textContent.includes(\'"count": "9007199254740993"\')',
      ),
    'decoded protobuf payload',
  );
  const stored = await evaluate(
    "window.electronAPI.history.page({connectionId:'smoke',topic:'proto/pump/reading'})",
  );
  const [message] = stored.data.messages;
  assert.deepEqual(
    Buffer.from(message.message, message.encoding === 'base64' ? 'base64' : 'utf8'),
    payload,
  );
  // The history worker decodes stored payloads for plots, so decoded fields plot like JSON.
  for (const value of [1.5, 3.5])
    send(
      'proto/pump/reading',
      Buffer.from(type.encode(type.fromObject({ id: 'pump', value, count: 1 })).finish()),
    );
  await field('[aria-label="Message display"]', 'plot');
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.incoming-plot-decoder')?.textContent === 'Decoded with Reading'",
      ),
    'decoded plot',
  );
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.incoming-plot-readout')?.textContent.includes('/value: 3.5')",
      ),
    'decoded field plotted',
  );
  await field('[aria-label="Message display"]', 'cards');
  await field('[aria-label="Search topics"]', '');
};
