const assert = require('node:assert/strict');
const fs = require('node:fs');
const { version } = require('../package.json');

module.exports = async ({ evaluate, waitFor, menu, saveTo }) => {
  menu('about');
  await waitFor(
    () => evaluate("!!document.querySelector('.about-dialog .about-runtime')"),
    'about',
  );
  const text = await evaluate("document.querySelector('.about-dialog').textContent");
  assert.ok(text.includes(`Version ${version}`), text);
  assert.ok(text.includes('MIT License'), text);

  // Diagnostics describe the setup without broker addresses or topics.
  const file = saveTo('diagnostics.json');
  await evaluate(
    "[...document.querySelectorAll('.about-dialog button')].find(b => b.textContent.includes('Save diagnostics')).click()",
  );
  await waitFor(() => fs.existsSync(file), 'diagnostics file');
  const saved = fs.readFileSync(file, 'utf8');
  const report = JSON.parse(saved);
  assert.equal(report.versions.app, version);
  assert.ok(report.window.connections.length > 0);
  assert.equal(report.window.connections[0].transport, 'mqtt');
  assert.ok(Array.isArray(report.recentLog));
  assert.ok(!saved.includes('127.0.0.1'), 'no broker address');
  assert.ok(!saved.includes('Smoke broker'), 'no connection name');

  await evaluate('document.querySelector(\'[aria-label="Close about"]\').click()');
  await waitFor(() => evaluate("!document.querySelector('.about-dialog')"), 'about closed');
};
