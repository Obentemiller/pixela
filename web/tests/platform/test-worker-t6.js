/**
 * test-worker-t6.js — Worker de teste para T6.
 * 
 * testa postMessage com ArrayBuffer transferível.
 */
self.onmessage = function(e) {
  if (e.data === 'start') {
    // Recebe ArrayBuffer transferível
    const buffer = e.data; // o transferido já foi consumido pelo postMessage
    self.postMessage({ success: true, transferred: buffer.byteLength });
  }
};