import { startServer } from './server-utils.js';

export default async function globalSetup() {
  console.log('[global-setup] Starting HTTP server...');
  await startServer();
  console.log('[global-setup] HTTP server started');
}