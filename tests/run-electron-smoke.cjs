const path = require('node:path');
const runElectron = require('./electron-runner.cjs');

runElectron(path.join(__dirname, 'electron-smoke.cjs'), {
  name: 'Electron smoke test',
  timeoutMs: Number(process.env.SMOKE_TIMEOUT_MS) || 45000,
});
