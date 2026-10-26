const { spawn } = require('node:child_process');
const path = require('node:path');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [path.join(__dirname, 'electron-smoke.cjs')], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
// The end of the output, reported as an annotation when the test fails on GitHub Actions.
const tail = [];
for (const [source, target] of [
  [child.stdout, process.stdout],
  [child.stderr, process.stderr],
])
  source.on('data', (chunk) => {
    target.write(chunk);
    tail.push(...String(chunk).split(/\r?\n/).filter(Boolean));
    tail.splice(0, Math.max(0, tail.length - 40));
  });
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
const timeout = setTimeout(
  () => {
    console.error('Electron smoke test timed out');
    tail.push('Electron smoke test timed out');
    child.kill();
  },
  Number(process.env.SMOKE_TIMEOUT_MS) || 45000,
);
child.on('exit', (code) => {
  clearTimeout(timeout);
  process.exitCode = code ?? 1;
  if (process.exitCode && process.env.GITHUB_ACTIONS) {
    const message = tail
      .filter((line) => !line.startsWith('IPC:'))
      .join('\n')
      .replace(/%/g, '%25')
      .replace(/\r/g, '%0D')
      .replace(/\n/g, '%0A');
    console.log(`::error title=Electron smoke test::${message}`);
  }
});
