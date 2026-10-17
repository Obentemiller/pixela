/**
 * test-worker-t1.js — Worker de teste para T1.
 * 
 * Escutando mensagens e respondendo com sucesso ou erro.
 */
self.onmessage = function(e) {
  if (e.data === 'start') {
    try {
      // Testa new Function dentro do worker
      const result = new Function('return 1+1')();
      self.postMessage({ success: true, message: 'Worker + new Function ok, result=' + result });
    } catch (e) {
      self.postMessage({ success: false, message: 'Erro no new Function: ' + e.message });
    }
  } else if (e.data === 'start infinite loop') {
    // Laço infinito — não deve jamais sair
    for (;;) {
      // empty
    }
  }
};