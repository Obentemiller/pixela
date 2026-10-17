// T4: laço infinito no Worker; mede ticks do principal durante 2s; terminate(); prova que parou.
const out = document.getElementById('out');
const log = [];
function emit(s) { log.push(s); out.textContent = log.join('\n'); }

const rep = {
  janelaMs: 2000,
  intervalMs: 100,
  ticksDurante: 0,
  ticksDepois: 0,
  principalVivo: false,
  antesTerminate: null,
  aposTerminate: null,
};

const spinner = new Worker(new URL('./w4.js', location.href).href, { type: 'module' });

// Fase 1: o laço infinito está rodando. O principal DEVE continuar responsivo.
let ticks = 0;
const t0 = performance.now();
const timer1 = setInterval(() => { ticks++; }, rep.intervalMs);

setTimeout(() => {
  clearInterval(timer1);
  rep.ticksDurante = ticks;
  rep.elapsedMs = Math.round(performance.now() - t0);
  emit('fase-1 ticks=' + ticks + ' em ' + rep.elapsedMs + 'ms (esperado ~20)');
  rep.antesTerminate = { ticksDurante: ticks, principalRespondeu: true };

  // Fase 2: terminate() e mede se o principal continua responsivo.
  const t2 = performance.now();
  spinner.terminate();
  emit('fase-2 terminate() retornou em ' + (performance.now() - t2).toFixed(3) + 'ms');

  let ticks2 = 0;
  const timer2 = setInterval(() => { ticks2++; }, rep.intervalMs);

  setTimeout(() => {
    clearInterval(timer2);
    rep.ticksDepois = ticks2;
    rep.elapsedDepoisMs = Math.round(performance.now() - t2);
    emit('fase-2 ticks apos terminate=' + ticks2 + ' em ' + rep.elapsedDepoisMs + 'ms');

    // Fase 3: um Worker novo e responsivo responde a ping?
    const pinger = new Worker(new URL('./w4ping.js', location.href).href, { type: 'module' });
    let respondeu = false;
    const timeoutPing = setTimeout(() => {
      if (!respondeu) finalizar({ novoWorkerRespondeu: false, erro: 'TIMEOUT: pinger nao respondeu' });
    }, 5000);

    pinger.onmessage = (ev) => {
      respondeu = true;
      clearTimeout(timeoutPing);
      pinger.terminate();
      finalizar({ novoWorkerRespondeu: true, dados: ev.data, ticksPrincipaisDepois: ticks2 });
    };
    pinger.onerror = (ev) => {
      clearTimeout(timeoutPing);
      finalizar({ novoWorkerRespondeu: false, erro: 'onerror: ' + ev.message });
    };
    pinger.postMessage('ping');
  }, rep.janelaMs);
}, rep.janelaMs);

function finalizar(aposTerminate) {
  rep.aposTerminate = aposTerminate;
  rep.principalVivo = true; // só chega aqui se o principal respondeu
  window.__report = rep;
  window.__done = true;
  emit('RESULT: ' + JSON.stringify(rep));
}

setTimeout(() => {
  if (!window.__done) {
    rep.resultado = 'TIMEOUT: principal nao respondeu (travou)';
    window.__report = rep;
    window.__done = true;
    emit('RESULT: ' + JSON.stringify(rep));
  }
}, 20000);