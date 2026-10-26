const assert = require('node:assert/strict');
const { version } = require('../package.json');

module.exports = async ({ evaluate, waitFor, menu }) => {
  menu('about');
  await waitFor(
    () => evaluate("!!document.querySelector('.about-dialog .about-runtime')"),
    'about',
  );
  const text = await evaluate("document.querySelector('.about-dialog').textContent");
  assert.ok(text.includes(`Version ${version}`), text);
  assert.ok(text.includes('MIT License'), text);
  await evaluate('document.querySelector(\'[aria-label="Close about"]\').click()');
  await waitFor(() => evaluate("!document.querySelector('.about-dialog')"), 'about closed');
};
