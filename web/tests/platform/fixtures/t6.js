// T6: Worker envia ArrayBuffer transferível a ~60 msg/s; mede msgs/s e latência.
const out = document.getElementById('out');
function emit(s) { out.textContent = s; }

const COLS = 200, ROWS = 50, CELLS = COLS * ROWS;
const TARGET_HZ = 60, DURACAO_S = 5;
const rep = { cols: COLS, rows: ROWS, cellsPerFrame: CELLS, bytesPerFrame: CELLS * 4, targetHz: TARGET_HZ, duracaoS: DURACAO_S };

const workerUrl = new URL('./w6.js', location.href);
const w = new Worker(workerUrl.href, { type: 'module' });

w.onerror = (ev) => {
  rep.erro = ev.message;
  window.__report = rep; window.__done = true;
  emit('RESULT: erro no worker: ' + ev.message);
};

// calibração: espera o worker mandar o primeiro quadro para começar a contar
const latencias = [];
let recebido = 0;
let t0 = 0;
let timer = null;

w.onmessage = (ev) => {
  const now = performance.now();
  if (!t0) {
    t0 = now;
    timer = setInterval(() => w.postMessage('frame'), Math.round(1000 / TARGET_HZ));
    return;
  }
  recebido++;
  const f64 = new Float64Array(ev.data.buffer);
  if (f64.length !== CELLS) rep.cellsErrados = f64.length;
  latencias.push(now - ev.data.tSend);
  if (now - t0 >= DURACAO_S * 1000) {
    clearInterval(timer);
    const elapsed = now - t0;
    latencias.sort((a, b) => a - b);
    const soma = latencias.reduce((a, b) => a + b, 0);
    rep.msgs = recebido;
    rep.msgsPorSegundo = +(recebido / (elapsed / 1000)).toFixed(2);
    rep.latenciaMediaMs = +(soma / latencias.length).toFixed(3);
    rep.latenciaP95Ms = +latencias[Math.min(latencias.length - 1, Math.floor(latencias.length * 0.95))].toFixed(3);
    rep.latenciaMinMs = +latencias[0].toFixed(3);
    rep.latenciaMaxMs = +latencias[latencias.length - 1].toFixed(3);
    w.terminate();
    window.__report = rep; window.__done = true;
    emit('RESULT: ' + JSON.stringify(rep));
  }
};

w.postMessage('start');
setTimeout(() => {
  if (!window.__done) {
    rep.erro = 'TIMEOUT: nenhum quadro recebido';
    window.__report = rep; window.__done = true;
    emit('RESULT: ' + JSON.stringify(rep));
  }
}, 10000);