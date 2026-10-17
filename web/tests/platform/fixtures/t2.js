// T2 (controle): o mesmo new Function na thread principal.
const out = document.getElementById('out');
const log = [];
function emit(s) { log.push(s); out.textContent = log.join('\n'); }

emit('csp-meta: ' + (document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || 'AUSENTE'));

try {
  const f = new Function('return 1+1');
  const v = f();
  emit('RESULT: nao-bloqueado value=' + v + ' type=' + typeof v);
  window.__report = { blocked: false, value: v, valueType: typeof v, name: null, message: null };
} catch (e) {
  emit('RESULT: bloqueado ' + e.name + ': ' + e.message);
  window.__report = { blocked: true, value: null, valueType: null, name: e.name, message: e.message };
}
window.__done = true;