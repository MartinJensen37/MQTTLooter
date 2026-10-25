const assert = require('node:assert/strict');
module.exports = async ({ evaluate, waitFor, field }) => {
  await evaluate("document.querySelector('.connection-card .edit-btn').click()");
  await waitFor(() => evaluate("!!document.querySelector('#password')"), 'connection editor');
  // Stored secrets load from main only while editing.
  await waitFor(
    () => evaluate("document.querySelector('#password').value === 'smoke-secret'"),
    'stored password in editor',
  );
  await field('#password', 'test-only-secret');
  assert.equal(await evaluate("document.querySelector('#password').type"), 'password');
  await evaluate('document.querySelector(\'[aria-label="Show password"]\').click()');
  assert.equal(await evaluate("document.querySelector('#password').type"), 'text');
  assert.equal(await evaluate("document.querySelector('#password').value"), 'test-only-secret');
  await evaluate('document.querySelector(\'[aria-label="Hide password"]\').click()');
  assert.equal(await evaluate("document.querySelector('#password').type"), 'password');
  await evaluate(
    "[...document.querySelectorAll('.mqtt-connection-modal-checkbox-label')].find(label=>label.textContent.includes('Enable TLS/SSL')).querySelector('input').click()",
  );
  await evaluate(`(() => {
    const input=document.querySelector('#private-key-upload');
    const transfer=new DataTransfer();
    transfer.items.add(new File(['-----BEGIN PRIVATE KEY-----\\nTEST ONLY\\n-----END PRIVATE KEY-----'], 'test-key.pem', {type:'text/plain'}));
    input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await waitFor(() => evaluate("!!document.querySelector('#key-passphrase')"), 'key passphrase');
  await field('#key-passphrase', 'test-only-passphrase');
  await evaluate('document.querySelector(\'[aria-label="Show key passphrase"]\').click()');
  assert.equal(await evaluate("document.querySelector('#key-passphrase').type"), 'text');
  await evaluate("document.querySelector('.mqtt-cancel-btn').click()");
  await evaluate("document.querySelector('.connection-card .edit-btn').click()");
  await waitFor(
    () => evaluate("document.querySelector('#password')?.type==='password'"),
    'password remasked',
  );
  await evaluate("document.querySelector('.mqtt-cancel-btn').click()");
};
