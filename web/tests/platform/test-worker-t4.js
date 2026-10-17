/**
 * test-worker-t4.js — Worker de teste para T4.
 * 
 * Laço infinito que o terminate() deve conseguir matar.
 */
self.onmessage = function(e) {
  if (e.data === 'start') {
    // Laço infinito
    for (;;) {
      // empty — nunca chama pix_present(), nunca termina
    }
  }
};