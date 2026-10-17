#!/usr/bin/env node
/**
 * tests/conceito/tools/verificar-criterio.mjs — o Judge generico.
 *
 * Le `criterio.json` (o que foi prometido) e `resultado.json` (o que foi
 * medido), e diz PASS/FAIL criterio a criterio. Sai com codigo diferente de 0
 * se houver QUALQUER falha.
 *
 * ---------------------------------------------------------- porque um script
 *
 * "Resolvido" nao pode ser opiniao. Se o agente avalia a propria entrega, o
 * resultado e o que o agente queria que fosse. Um script que le dois ficheiros
 * e compara e a unica forma de a palavra "DONE" ter conteudo mecanico.
 *
 * Cada criterio traz um `verificador`: uma EXPRESSAO sobre `resultado`, que
 * tem de devolver `true`. A expressao e avaliada com `new Function`, o que
 * significa que o criterio e lido e executado — nao e texto.
 *
 * ------------------------------------------------------------ uso
 *
 *   node tests/conceito/tools/verificar-criterio.mjs \
 *        --criterio reports/conceito/t2b/criterio.json \
 *        --resultado reports/conceito/t2b/resultado.json
 *
 * Sai 0 se tudo passar, 1 se alguma coisa falhar, 2 se nao conseguir ler.
 */
import { readFileSync, existsSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };

const CRIT = arg('--criterio', 'reports/conceito/criterio.json');
const RES = arg('--resultado', CRIT.replace(/criterio\.json$/, 'resultado.json'));

function die(msg, codigo = 2) {
  console.error(`verificar-criterio: ${msg}`);
  process.exit(codigo);
}

if (!existsSync(CRIT)) die(`criterio nao existe: ${CRIT}`);
if (!existsSync(RES)) die(`resultado nao existe: ${RES}`);

let criterio, resultado;
try { criterio = JSON.parse(readFileSync(CRIT, 'utf8')); } catch (e) { die(`criterio.json nao parseia: ${e.message}`); }
try { resultado = JSON.parse(readFileSync(RES, 'utf8')); } catch (e) { die(`resultado.json nao parseia: ${e.message}`); }

console.log('=== verificar-criterio ===');
console.log(`criterio : ${CRIT}`);
console.log(`resultado: ${RES}`);
console.log(`ordem    : ${criterio.ordem ?? '?'} (classe ${criterio.classe ?? '?'})`);
console.log('');

let passou = 0, falhou = 0;
const linhas = [];

for (const c of criterio.criterios ?? []) {
  let ok = false, erro = null, obtido = null;
  try {
    // mede o valor para o log, e depois avalia o verificador
    const medir = new Function('r', `try { return (${c.verificador}); } catch (e) { return e.message; }`);
    obtido = medir(resultado);
    ok = obtido === true;
    if (ok === false && typeof obtido === 'string') erro = obtido;
  } catch (e) {
    erro = e.message;
  }
  if (ok) passou++; else { falhou++; }
  linhas.push({
    id: c.id, etapa: c.etapa ?? '-', metrica: c.metrica ?? '-',
    denominador: typeof c.denominador === 'number' ? c.denominador : (c.denominadorDescricao ?? 'declarado no criterio'),
    alvo: typeof c.alvo === 'object' ? JSON.stringify(c.alvo) : String(c.alvo ?? '-'),
    ok, obtido, erro,
  });
}

const larg = Math.max(...linhas.map((l) => l.id.length));
for (const l of linhas) {
  const marca = l.ok ? 'PASS' : 'FAIL';
  console.log(`  [${marca}] ${l.id.padEnd(larg)}  ${l.metrica}`);
  if (!l.ok) {
    console.log(`         esperado: ${l.alvo}`);
    console.log(`         obtido  : ${l.erro ? `ERRO ${l.erro}` : JSON.stringify(l.obtido)}`);
    if (typeof l.denominador === 'number') console.log(`         denoms  : ${l.denominador}`);
  }
}

console.log('');
console.log(`${passou} passaram, ${falhou} falharam, de ${linhas.length} criterios.`);

// ------------------------------------------------------- auditoria de higiene
// Um criterio que passa mas whose resultado foi colado a mao nao prova nada.
// O verificador regista o sha256 do resultado para que a auditoria possa
// confirmar que o numero veio de uma execucao.
if (resultado._execucao) {
  console.log('');
  console.log('execucoes registadas no resultado:');
  for (const e of resultado._execucao) console.log(`  ${e.rotulo.padEnd(22)} sha256=${e.sha256}`);
} else {
  console.log('');
  console.log('AVISO: `resultado.json` nao tem `_execucao`. A proveniencia dos numeros nao e rastreavel.');
}

process.exit(falhou > 0 ? 1 : 0);
