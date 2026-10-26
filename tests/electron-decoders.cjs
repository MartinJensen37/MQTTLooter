const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const protobuf = require('protobufjs');

const units = `syntax = "proto3";
package units;
enum Unit { NONE = 0; KPA = 1; }`;
const proto = `syntax = "proto3";
package smoke;
import "units.proto";
message Reading { string id = 1; double value = 2; int64 count = 3; units.Unit unit = 4; }`;

module.exports = async ({ evaluate, waitFor, field, send, userData, capture, menu }) => {
  const root = new protobuf.Root();
  protobuf.parse(units, root);
  protobuf.parse(proto, root);
  const type = root.lookupType('smoke.Reading');
  const payload = Buffer.from(
    type
      .encode(type.fromObject({ id: 'pump', value: 2.5, count: '9007199254740993', unit: 'KPA' }))
      .finish(),
  );
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(button => button.textContent.trim().startsWith(${JSON.stringify(text)}))`;

  // Add the decoder through the real dialog and a real file input, with an imported file.
  // Decoders are an advanced option: turn them on in Tools > Advanced settings first.
  menu('settings');
  await waitFor(() => evaluate("!!document.querySelector('.settings-dialog')"), 'settings');
  await evaluate(
    "[...document.querySelectorAll('.settings-dialog label')].find(label => label.textContent.trim() === 'Protobuf decoders').querySelector('input').click()",
  );
  await evaluate('document.querySelector(\'[aria-label="Close settings"]\').click()');
  await waitFor(() => evaluate(`!!${button('Decoders')}`), 'decoders button');
  await evaluate(`${button('Decoders')}.click()`);
  await waitFor(() => evaluate("!!document.querySelector('.decoder-dialog')"), 'decoder dialog');
  await evaluate(`(() => {
    const input = document.querySelector('[aria-label="Protobuf schema file"]');
    const transfer = new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(proto)}], 'smoke.proto', { type: 'text/plain' }));
    transfer.items.add(new File([${JSON.stringify(units)}], 'units.proto', { type: 'text/plain' }));
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
  const [stored] = JSON.parse(
    fs.readFileSync(path.join(userData, 'decoders.json'), 'utf8'),
  ).decoders;
  assert.equal(stored.messageType, 'smoke.Reading');
  assert.deepEqual(stored.imports, [{ name: 'units.proto', source: units }]);

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
  const page = await evaluate(
    "window.electronAPI.history.page({connectionId:'smoke',topic:'proto/pump/reading'})",
  );
  const [message] = page.data.messages;
  assert.deepEqual(
    Buffer.from(message.message, message.encoding === 'base64' ? 'base64' : 'utf8'),
    payload,
  );
  // The enum comes from the imported file; the card preview is too short to show it.
  const decoded = await evaluate(
    `window.electronAPI.decoders.decode(${JSON.stringify(stored.id)}, ${JSON.stringify(message.message)}, ${JSON.stringify(message.encoding)})`,
  );
  assert.equal(JSON.parse(decoded.data).unit, 'KPA');
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

  // Content search can match decoded fields that never appear as text in the stored bytes.
  await field('[aria-label="Message source"]', 'stored');
  await evaluate(
    "[...document.querySelectorAll('.message-history-toolbar button')].find(button => button.textContent === 'Search message contents').click()",
  );
  await field('[aria-label="Content search mode"]', 'decoded');
  await field('[aria-label="Search message contents"]', '"9007199254740993"');
  await evaluate("document.querySelector('.history-search form').requestSubmit()");
  await waitFor(
    () =>
      evaluate(
        "document.querySelectorAll('.history-search .message-item').length === 1 && document.querySelector('.history-search .message-item').textContent.includes('proto/pump/reading')",
      ),
    'decoded content search',
  );
  await evaluate(
    "[...document.querySelectorAll('.message-history-toolbar button')].find(button => button.textContent === 'Close content search').click()",
  );
  await field('[aria-label="Message source"]', 'live');
  await field('[aria-label="Search topics"]', '');
};
