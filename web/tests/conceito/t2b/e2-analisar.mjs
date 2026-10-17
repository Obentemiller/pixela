/**
 * tests/conceito/t2b/e2-analisar.mjs — classificação de antes × depois,
 * usando a mesma função de classe dos quadrantes do T2.
 *
 * Antes = reports/conceito/t2-e2-bruto.json (repo ast.js, já medido).
 * Depois = reports/conceito/t2b-e2-depois.json (patch aplicado na cópia /tmp/t2b).
 * Mesmo corpus, mesmo semente — a única diferença é o `;` em ClassDecl/TemplateDecl.
 *
 * Regra 4: soma por categoria tem de dar o total em ambos.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { ROTULOS, classifica } from '/home/vtbentemiller/Documentos/pixela-main/web/tests/conceito/t2/e3-classificar.mjs';

const RAIZ = '/home/vtbentemiller/Documentos/pixela-main/web';

function classificarCasos(casos) {
  const conta = new Map();
  const porPop = new Map();
  const comBug = [];
  const nomes = new Set();
  for (const c of casos) {
    if (nomes.has(c.nome)) throw new Error(`nome duplicado: ${c.nome}`);
    nomes.add(c.nome);
    const q = classifica(c);
    conta.set(q, (conta.get(q) ?? 0) + 1);
    if (!porPop.has(c.pop)) porPop.set(c.pop, new Map());
    const m = porPop.get(c.pop);
    m.set(q, (m.get(q) ?? 0) + 1);
    if (ROTULOS[q]?.bug) comBug.push({ ...c, q });
  }
  const soma = [...conta.values()].reduce((a, b) => a + b, 0);
  const total = casos.length;
  if (soma !== total) throw new Error(`REGRA 4: soma ${soma} != total ${total}`);
  return { soma, total, contagem: Object.fromEntries([...conta].sort((a,b) => b[1]-a[1])), comBug, porPop };
}

function rotulo(c) { return c.q; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const antes = JSON.parse(readFileSync(`${RAIZ}/reports/conceito/t2-e2-bruto.json`, 'utf8'));
  const depois = JSON.parse(readFileSync(`${RAIZ}/reports/conceito/t2b-e2-depois.json`, 'utf8'));
  const A = classificarCasos(antes.casos);
  const D = classificarCasos(depois.casos);

  // índice por nome para comparar caso a caso
  const idx = (arr) => { const m = new Map(); for (const c of arr) m.set(c.nome, c); return m; };
  const IA = idx(antes.casos), ID = idx(depois.casos);

  const passouQuebrava = [];   // antes UNPARSE-QUEBRA, depois round-trip-inteiro -> corrigidos pelo `;`
  const novas = [];            // depois UNPARSE-QUEBRA mas antes NÃO era -> novas primeiras-falhas
  const mudaram = [];
  for (const [nome, cA] of IA) {
    const cD = ID.get(nome);
    if (!cD) continue;
    const qA = classifica(cA), qD = classifica(cD);
    if (qA !== qD) mudaram.push({ nome, antes: qA, depois: qD, pop: cA.pop });
    if (qA === 'UNPARSE-QUEBRA' && qD === 'round-trip-inteiro') passouQuebrava.push(cA);
    if (qA !== 'UNPARSE-QUEBRA' && qD === 'UNPARSE-QUEBRA') novas.push(cD);
  }

  const corrigidosJson = {
    totalDependentes: passouQuebrava.length,
    antesTotal: antes.casos.length,
    depoisTotal: depois.casos.length,
    casos: passouQuebrava.map(c => ({ nome: c.nome, pop: c.pop, antes: 'UNPARSE-QUEBRA', depois: 'round-trip-inteiro', erro: c.unparseErro1 })),
  };
  const novasJson = {
    totalNovas: novas.length,
    casos: novas.map(c => ({ nome: c.nome, pop: c.pop, antes: classifica(idx(antes.casos).get(c.nome)), depois: 'UNPARSE-QUEBRA', erro: c.unparseErro1, msg: c.unparseMsg })),
  };

  const antesSaida = { ...antes.cabecalho, quadrantes: A.contagem, soma: A.soma, total: A.total, bugs: A.comBug.length };
  const depoisSaida = { ...depois.cabecalho, quadrantes: D.contagem, soma: D.soma, total: D.total, bugs: D.comBug.length };
  writeFileSync(`${RAIZ}/reports/conceito/t2b-e2-antes.json`, `${JSON.stringify(antesSaida, null, 1)}\n`);
  writeFileSync(`${RAIZ}/reports/conceito/t2b-e2-depois.json`, `${JSON.stringify(depoisSaida, null, 1)}\n`);
  writeFileSync(`${RAIZ}/reports/conceito/t2b-e2-corrigidos.json`, `${JSON.stringify(corrigidosJson, null, 1)}\n`);
  writeFileSync(`${RAIZ}/reports/conceito/t2b-e2-novas.json`, `${JSON.stringify(novasJson, null, 1)}\n`);

  console.log('=== T2b E2: antes × depois ===');
  console.log(`antes  total=${A.total}  soma=${A.soma}  bugs=${A.comBug.length}`);
  console.log(`depois total=${D.total}  soma=${D.soma}  bugs=${D.comBug.length}`);
  console.log('');
  console.log('quadrantes:');
  const chaves = new Set([...Object.keys(A.contagem), ...Object.keys(D.contagem)]);
  for (const k of [...chaves].sort((a,b) => (D.contagem[b]||0) - (D.contagem[a]||0))) {
    console.log(`  ${k.padEnd(28)} antes=${String(A.contagem[k]||0).padStart(4)} depois=${String(D.contagem[k]||0).padStart(4)}  delta=${String((D.contagem[k]||0)-(A.contagem[k]||0)).padStart(4)}`);
  }
  console.log('');
  console.log(`corrigidos pelo \`;\`: ${passouQuebrava.length} casos (antes UNPARSE-QUEBRA, depois round-trip-inteiro)`);
  console.log(`novas primeiras-falhas depois do patch: ${novas.length}`);
  for (const c of mudaram.filter(m => m.antes !== 'UNPARSE-QUEBRA' && m.depois === 'UNPARSE-QUEBRA').slice(0,10)) {
    console.log(`    ${c.nome} (${c.pop}): ${c.antes} -> ${c.depois}`);
  }
  console.log('');
  console.log('gravado: t2b-e2-antes.json, t2b-e2-depois.json, t2b-e2-corrigidos.json, t2b-e2-novas.json');
}
