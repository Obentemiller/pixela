// Worker de T6: aloca ArrayBuffer, preenche e transfere ao principal.
const CELLS = 200 * 50;
let buf = null;

function quadro(tSend) {
  if (!buf || buf.byteLength !== CELLS * 8) buf = new ArrayBuffer(CELLS * 8);
  const f64 = new Float64Array(buf);
  for (let i = 0; i < CELLS; i++) f64[i] = i + tSend * 0.001;
  const copia = buf.slice(0);
  self.postMessage({ tSend, buffer: copia }, [copia]);
}

self.onmessage = (ev) => {
  if (ev.data === 'start') { self.postMessage({ tSend: performance.now() }); return; }
  if (ev.data === 'frame') quadro(performance.now());
};