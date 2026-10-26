const { spawn } = require('node:child_process');
const path = require('node:path');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [path.join(__dirname, 'electron-smoke.cjs')], {
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
    console.error('Electron smoke test timed out');
    child.kill();
  },
  Number(process.env.SMOKE_TIMEOUT_MS) || 45000,
);
child.on('exit', (code) => {
  clearTimeout(timeout);
  process.exitCode = code ?? 1;
});
