import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { version } from './package.json';

// Unified build for all three Electron processes. externalizeDepsPlugin keeps
// node_modules (e.g. mqtt) as runtime requires instead of bundling them.
// Tests build into their own folder (MQTTLOOTER_OUT_DIR=out-test), leaving a running app's out/ alone.
const outDir = resolve(__dirname, process.env.MQTTLOOTER_OUT_DIR || 'out');

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // The release version, fixed at build time rather than read from whichever package.json
    // Electron was started with.
    define: { __APP_VERSION__: JSON.stringify(version) },
    build: {
      outDir: resolve(outDir, 'main'),
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'history-worker': resolve(__dirname, 'src/main/history-worker.ts'),
          'recording-worker': resolve(__dirname, 'src/main/recording-worker.ts'),
          'decoder-worker': resolve(__dirname, 'src/main/decoder-worker.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve(outDir, 'preload'),
      lib: { entry: resolve(__dirname, 'src/preload/preload.ts') },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      outDir: resolve(outDir, 'renderer'),
      // Smaller files load faster; the main process stays readable for stack traces.
      minify: true,
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
    plugins: [react()],
  },
});
