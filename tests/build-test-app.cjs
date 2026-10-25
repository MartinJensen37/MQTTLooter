// Builds the app into out-test for the Electron smoke and load tests. Keeping it apart from
// out/ means a test run never changes the files of an app started with npm run dev or start.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

// The package's exports hide its bin folder, so locate the CLI next to its main entry.
const cli = path.join(path.dirname(require.resolve('electron-vite')), '../bin/electron-vite.js');

const result = spawnSync(process.execPath, [cli, 'build'], {
  stdio: 'inherit',
  env: { ...process.env, MQTTLOOTER_OUT_DIR: 'out-test' },
});
process.exit(result.status ?? 1);
