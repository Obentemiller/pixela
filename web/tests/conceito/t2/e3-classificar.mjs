/**
 * tests/conceito/t2/e3-classificar.mjs — quadrantes do round-trip.
 *
 * Um caso e um par: a FONTE e o que o `unparse` devolveu dela. O g++ diz se
 * cada um dos dois e C++ valido. Sao tres perguntas, e cada uma tem quadrante
 * seu:
 *
 *   FIDELIDADE    original aceita, unparse nao  ->  o unparse QUEBROU algo bom
 *   IDEMPOTENCIA  unparse(unparse) != unparse   ->  nao ha "forma final"
 *   PERDA         tokens perdidos                ->  o unparse perdeu informacao
 *
 * A distinguish as tres e o que da utilidade: uma perda de tokens sem quebra
 * de sintaxe e um bug de FIDELIDADE de outra especie — silencioso, e o pior.
 *
 * Regra 4: a soma por categoria tem de dar o total. Se nao der, PARA.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const RAIZ = new URL('../../../', import.meta.url).pathname;

export const ROTULOS = {
  'round-trip-inteiro': { titulo: 'Round-trip inteiro: unparse e aceite e idempotente', bug: false },
  'unparse-perde-tokens': { titulo: 'Unparse aceite, mas PERDEU tokens', bug: true },
  'unparse-nao-idempotente': { titulo: 'Unparse aceite, mas NAO e idempotente', bug: true },
  'UNPARSE-QUEBRA': { titulo: 'UNPARSE QUEBROU: original aceite, saida rejeitada', bug: true },
  'original-invalido': { titulo: 'A original ja era invalida (fora do escopo do T2)', bug: false },
  'parse-rejeitou': { titulo: 'O nosso parser nao aceitou a original', bug: false },
  'indeterminado-timeout': { titulo: 'Indeterminado: timeout do g++', bug: false },
  'indeterminado-sem-texto': { titulo: 'Indeterminado: nao ha texto desparseado', bug: false },
};

export function classifica(c) {
  if (c.timeouts > 0) return 'indeterminado-timeout';
  if (c.texto === null) return 'indeterminado-sem-texto';
  if (!c.origOk) return 'original-invalido';
  if (c.parseErros > 0) return 'parse-rejeitou';
  // aqui a original e aceite pelo g++ E pelo nosso parser: o unparse tem de
  // devolver C++ aceite, senao quebrou algo bom.
  if (c.unparseOk === false) return 'UNPARSE-QUEBRA';
  if (c.tokensSai !== null && c.tokensSai < c.tokensOrig) return 'unparse-perde-tokens';
  if (c.idempotente === false) return 'unparse-nao-idempotente';
  return 'round-trip-inteiro';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const bruto = JSON.parse(readFileSync(`${RAIZ}reports/conceito/t2-e2-bruto.json`, 'utf8'));
  const conta = new Map();
  const porPop = new Map();
  const comBug = [];
  const nomes = new Set();

  for (const c of bruto.casos) {
    if (nomes.has(c.nome)) throw new Error(`nome duplicado no corpus: ${c.nome} — dois casos escreveriam no mesmo ficheiro temporario`);
    nomes.add(c.nome);
    const q = classifica(c);
    conta.set(q, (conta.get(q) ?? 0) + 1);
    if (!porPop.has(c.pop)) porPop.set(c.pop, new Map());
    const m = porPop.get(c.pop);
    m.set(q, (m.get(q) ?? 0) + 1);
    if (ROTULOS[q]?.bug) comBug.push({ ...c, q });
  }

  const soma = [...conta.values()].reduce((a, b) => a + b, 0);
  const total = bruto.casos.length;
  if (soma !== total) {
    console.error(`REGRA 4 VIOLADA: soma ${soma} != total ${total}. PARANDO.`);
    process.exit(1);
  }

  const ordem = [...conta].sort((a, b) => {
    const ba = ROTULOS[a[0]]?.bug ? 0 : 1, bb = ROTULOS[b[0]]?.bug ? 0 : 1;
    return ba - bb || b[1] - a[1];
  });

  console.log('=== T2 E3 — quadrantes do round-trip ===');
  console.log(`total: ${total}   (soma por categoria = ${soma})`);
  console.log('');
  for (const [q, n] of ordem) {
    const r = ROTULOS[q] ?? { titulo: q, bug: false };
    console.log(`  ${r.titulo.padEnd(58)} ${String(n).padStart(5)}   ${r.bug ? 'BUG' : '-'}`);
  }
  const bugs = ordem.filter(([q]) => ROTULOS[q]?.bug).reduce((a, [, n]) => a + n, 0);
  console.log('');
  console.log(`divergencias com bug: ${bugs}  (${(100 * bugs / total).toFixed(2)}%)`);

  console.log('');
  console.log('por populacao:');
  for (const [pop, m] of porPop) {
    const n = [...m.values()].reduce((a, b) => a + b, 0);
    const b = [...m].filter(([q]) => ROTULOS[q]?.bug).reduce((a, [, k]) => a + k, 0);
    console.log(`  ${pop.padEnd(10)} total=${String(n).padStart(5)}  com bug=${String(b).padStart(5)}  (${(100 * b / n).toFixed(1)}%)`);
  }

  // os 15 piores: onde o unparse maisOften falha
  const porMsg = new Map();
  for (const c of comBug) {
    const k = (c.unparseMsg ?? '(idempotencia)').replace(/‘[^’]*’/g, 'X').replace(/\b\d+\b/g, 'N');
    if (!porMsg.has(k)) porMsg.set(k, { n: 0, exemplo: c });
    porMsg.get(k).n++;
  }
  console.log('');
  console.log(`mensagens que quebram o unparse (${porMsg.size} distintas):`);
  for (const [msg, v] of [...porMsg].sort((a, b) => b[1].n - a[1].n).slice(0, 15)) {
    console.log(`  ${String(v.n).padStart(5)}  ${msg.slice(0, 64)}`);
  }

  writeFileSync(`${RAIZ}reports/conceito/t2-e3-quadrantes.json`,
    `${JSON.stringify({
      cabeçalho: bruto.cabecalho, contagem: Object.fromEntries(ordem),
      soma, total, bugs, comBug: comBug.map((c) => ({ nome: c.nome, pop: c.pop, q: c.q, unparseMsg: c.unparseMsg, texto: c.texto, tokensOrig: c.tokensOrig, tokensSai: c.tokensSai })),
    }, null, 1)}\n`);
  writeFileSync('/tmp/opencode/t2-e3-quadrantes.json',
    readFileSync(`${RAIZ}reports/conceito/t2-e3-quadrantes.json`, 'utf8'));
  console.log('');
  console.log(`gravado: reports/conceito/t2-e3-quadrantes.json (${comBug.length} com bug)`);
}
