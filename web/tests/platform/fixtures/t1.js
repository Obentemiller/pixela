// T1: Worker de módulo executa new Function sob o CSP real do index.html.
const out = document.getElementById('out');
const log = [];
function emit(s) { log.push(s); out.textContent = log.join('\n'); }

emit('csp-meta: ' + (document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || 'AUSENTE'));
emit('worker-ctor: ' + String(typeof Worker));

const workerUrl = new URL('./w.js', location.href);
emit('worker-url: ' + workerUrl.href);

let worker;
try {
  worker = new Worker(workerUrl.href, { type: 'module' });
} catch (e) {
  emit('RESULT: ctor-throw ' + e.name + ': ' + e.message);
  window.__done = true;
}

worker.onerror = (ev) => {
  emit('worker.onerror: ' + ev.message);
  window.__report = { ok: false, stage: 'onerror', message: ev.message };
  window.__done = true;
};

worker.onmessage = (ev) => {
  const d = ev.data;
  emit('RESULT: ' + JSON.stringify(d));
  window.__report = d;
  window.__done = true;
};

setTimeout(() => {
  if (!window.__done) {
    emit('RESULT: TIMEOUT-5s');
    window.__report = { ok: false, stage: 'timeout', message: 'sem resposta em 5s' };
    window.__done = true;
  }
}, 5000);