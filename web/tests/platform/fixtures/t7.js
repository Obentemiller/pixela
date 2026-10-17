// T7: mede o que o ambiente realmente oferece (GitHub Pages: sem COOP/COEP).
const rep = {
  origin: location.origin,
  crossOriginIsolated: self.crossOriginIsolated,
  typeofSharedArrayBuffer: typeof SharedArrayBuffer,
  sabConstrutoivel: (() => {
    try { return new SharedArrayBuffer(8).byteLength; } catch (e) { return 'ERRO: ' + e.name + ': ' + e.message; }
  })(),
};
window.__report = rep;
window.__done = true;
document.getElementById('out').textContent = 'RESULT: ' + JSON.stringify(rep, null, 2);