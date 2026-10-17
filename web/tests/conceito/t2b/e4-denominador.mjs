/**
 * tests/conceito/t2b/e4-denominador.mjs — E4 do T2b.
 *
 * Taxa de quebra do round-trip SOBRE (original valida E aceita pelo nosso
 * parser), por populacao (fixtures, src/, gramatical).
 *
 *   denominador  = casos onde g++ aceita a original E nosso parser aceita
 *   numerador    = denominador cujo unparse o g++ REJEITA (quebra)
 *   taxa         = numerador / denominador
 *
 * "Original ja invalida" fica de fora: o T2 nao mede o unparse de codigo que
 * o proprio g++ ja rejeita.
 *
 * Calculado tanto para o estado ANTES (parser.js original) quanto DEPOIS
 * (patch do `;` aplicado na copia /tmp/t2b), para medir o efeito da
 * correcao.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const RAIZ = '/home/vtbentemiller/Documentos/pixela-main/web';

function analisar(bruto) {
  const porPop = new Map();
  for (const c of bruto.casos) {
    if (!c.origOk || c.parseErros > 0) continue; // fora do denominador
    let d = porPop.get(c.pop);
    if (!d) { d = { denom: 0, breaks: 0 }; porPop.set(c.pop, d); }
    d.denom++;
    if (c.unparseOk === false) d.breaks++;
  }
  const saida = {};
  for (const [pop, d] of porPop) {
    saida[pop] = {
      denominador: d.denom,
      quebras: d.breaks,
      taxa: d.denom ? d.breaks / d.denom : 0,
    };
  }
  return saida;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const antes = JSON.parse(readFileSync(`${RAIZ}/reports/conceito/t2-e2-bruto.json`, 'utf8'));
  const depois = JSON.parse(readFileSync(`${RAIZ}/reports/conceito/t2b-e2-depois-bruto.json`, 'utf8'));
  const A = analisar(antes);
  const D = analisar(depois);

  const saida = {
    antes: A,
    depois: D,
    nota:
      "denominador = casos onde g++ aceita a original (origOk) E nosso parser aceita (parseErros===0). " +
      "numerador = denominador cujo unparse o g++ rejeita (unparseOk===false). " +
      "'Original ja invalida' fica de fora.",
  };
  writeFileSync(`${RAIZ}/reports/conceito/t2b-e4-denominador.json`, `${JSON.stringify(saida, null, 1)}\n`);

  console.log('=== T2b E4: taxa de quebra sobre (original valida && aceita) ===');
  console.log('');
  for (const fase of ['antes', 'depois']) {
    const s = saida[fase];
    console.log(`--- ${fase.toUpperCase()} ---`);
    for (const [pop, d] of Object.entries(s)) {
      console.log(
        `  ${pop.padEnd(12)} denom=${String(d.denominador).padStart(4)}  quebras=${String(d.quebras).padStart(4)}  taxa=${(100*d.taxa).toFixed(1)}%`,
      );
    }
    const totalD = Object.values(s).reduce((a, b) => a + b.denominador, 0);
    const totalQ = Object.values(s).reduce((a, b) => a + b.quebras, 0);
    console.log(`  TOTAL        denom=${String(totalD).padStart(4)}  quebras=${String(totalQ).padStart(4)}  taxa=${(100*totalQ/totalD).toFixed(1)}%`);
    console.log('');
  }
}