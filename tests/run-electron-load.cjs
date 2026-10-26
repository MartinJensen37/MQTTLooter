const fs = require('node:fs');
const path = require('node:path');
const runElectron = require('./electron-runner.cjs');

// Isolated user data; a full run writes hundreds of MiB of recordings and history.
const userData = path.join(__dirname, '..', '.tmp', `load-${process.pid}`);
runElectron(path.join(__dirname, 'load', 'electron-load.cjs'), {
  name: 'Electron load test',
  timeoutMs: (process.env.LOAD_PROFILE === 'full' ? 20 : 5) * 60_000,
  env: { ...process.env, LOAD_USER_DATA: userData },
  done: () => {
    if (process.env.LOAD_KEEP !== '1') fs.rmSync(userData, { recursive: true, force: true });
  },
});
