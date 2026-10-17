import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, 'web');

// Server management - using a closure to keep state
let serverProcess = null;
let serverReady = false;

function startServer() {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const { resolve: resolvePath } = require('path');
    
    const server = spawn('python3', ['-m', 'http.server', '8080', '--bind', '127.0.0.1'], {
      cwd: resolve(__dirname, 'web'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    serverProcess = server;

    const timeout = setTimeout(() => {
      reject(new Error('Server startup timeout'));
    }, 10000);

    server.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Serving HTTP on') || output.includes('Serving on')) {
        clearTimeout(timeout);
        serverReady = true;
        resolve();
      }
    });

    server.stderr.on('data', (data) => {
      console.error(`[test-server] stderr: ${data}`);
    });

    server.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    server.on('exit', (code) => {
      if (!serverReady) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      serverProcess.on('exit', () => {
        serverProcess = null;
        serverReady = false;
        resolve();
      });
      setTimeout(() => {
        if (serverProcess) {
          serverProcess.kill('SIGKILL');
          serverProcess = null;
          serverReady = false;
          resolve();
        }
      }, 5000);
    } else {
      resolve();
    }
  });
}

export default defineConfig({
  testDir: 'tests',
  timeout: 60000,
  workers: 1,
  reporter: [['list']],
  globalSetup: './tests/global-setup.js',
  globalTeardown: './tests/global-teardown.js',
  use: {
    baseURL: 'http://127.0.0.1:8080',
    headless: true,
    launchOptions: {
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  },
});