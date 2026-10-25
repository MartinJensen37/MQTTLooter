const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
// Isolated user data; a full run writes hundreds of MiB of recordings and history.
const userData = path.join(__dirname, '..', '.tmp', `load-${process.pid}`);
const env = { ...process.env, LOAD_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [path.join(__dirname, 'load', 'electron-load.cjs')], {
  env,
  stdio: 'inherit',
  windowsHide: true,
});
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
const timeout = setTimeout(
  () => {
    console.error('Electron load test timed out');
    child.kill();
  },
  (process.env.LOAD_PROFILE === 'full' ? 20 : 5) * 60_000,
);
child.on('exit', (code) => {
  clearTimeout(timeout);
  process.exitCode = code ?? 1;
  if (process.env.LOAD_KEEP !== '1') fs.rmSync(userData, { recursive: true, force: true });
});
