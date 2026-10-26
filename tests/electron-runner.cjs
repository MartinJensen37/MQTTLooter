/*
 * Runs an Electron test script with a time limit. On GitHub Actions a failure is also reported
 * as an annotation with the end of the output, since job logs need a sign-in to read.
 */
const { spawn } = require('node:child_process');

module.exports = function runElectron(script, { name, timeoutMs, env = process.env, done }) {
  const childEnv = { ...env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [script], {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
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
  const timeout = setTimeout(() => {
    console.error(`${name} timed out`);
    tail.push(`${name} timed out`);
    child.kill();
  }, timeoutMs);
  child.on('exit', (code) => {
    clearTimeout(timeout);
    process.exitCode = code ?? 1;
    done?.();
    if (process.exitCode && process.env.GITHUB_ACTIONS) {
      const message = tail
        .filter((line) => !line.startsWith('IPC:'))
        .join('\n')
        .replace(/%/g, '%25')
        .replace(/\r/g, '%0D')
        .replace(/\n/g, '%0A');
      console.log(`::error title=${name}::${message}`);
    }
  });
};
