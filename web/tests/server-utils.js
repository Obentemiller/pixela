import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, '..');

let serverProcess = null;
let serverReady = false;

export function startServer() {
  return new Promise((resolve, reject) => {
    const server = spawn('python3', ['-m', 'http.server', '8080', '--bind', '127.0.0.1'], {
      cwd: resolve(__dirname, '..'),
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

export function stopServer() {
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