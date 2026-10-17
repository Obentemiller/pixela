// Worker de controle para T4: NÃO entra em laço infinito, responde ping.
self.onmessage = (ev) => {
  if (ev.data === 'ping') self.postMessage({ pong: true, t: performance.now() });
};