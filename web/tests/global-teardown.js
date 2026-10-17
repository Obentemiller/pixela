import { stopServer } from './server-utils.js';

export default async function globalTeardown() {
  console.log('[global-teardown] Stopping HTTP server...');
  await stopServer();
  console.log('[global-teardown] HTTP server stopped');
}