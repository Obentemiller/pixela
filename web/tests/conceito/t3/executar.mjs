/**
 * tests/conceito/t3/executar.mjs — E2+E3 do T3: corre os mutantes e diz quais
 * sobrevivem.
 *
 * Regra 3: semente e versoes em todo o log; duas execucoes tem de dar a mesma
 * lista de sobreviventes.
 * Regra 4: DADO CRU primeiro (a contagem de falhas por mutante), classificacao
 * depois (morreu / sobreviveu / veredito ausente).
 *
 * A distincao entre "sobreviveu" e "veredito ausente" e essential: um mutante
 * que faz o runner dar timeout NAO esta a mostrar um buraco na suite. Esta a
 * mostrar que o harness do T3 precisa de um timeout maior, ou que o mutante
 * entrou em laco infinito.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import { gerarMutantes } from './mutar.mjs';
import {
  RAIZ, montaWorkspace, limpaWorkspace, aplicaMutante,
  PARSER_ORIGINAL, ficheirosDoParser, todosOsTestes, rodaTestes,
} from './harness.mjs';

const N = Number(process.argv[2] ?? 200);
const SEMENTE = Number(process.argv[3] ?? 20261016);
const CONC = Number(process.env.T3_CONC ?? 4);
const SAIDA = `${RAIZ}reports/conceito`;

const original = PARSER_ORIGINAL();
console.log('=== T3 — teste dos testes ===');
console.log(`node: ${process.version}  ${process.platform} ${process.arch}`);
console.log(`semente: ${SEMENTE}   pedido: ${N} mutantes`);
console.log(`parser.js: ${original.split('\n').length} linhas, ${original.length} bytes`);
console.log('');

const raiz = montaWorkspace('t3');
try {
  // ---------------------------------------------------------------- baseline
  // Se a copia NAO passa limpa, tudo o que vier a seguir e ilegitimo: um
  // mutante "morto" por uma falha que ja existia na baseline nao prova nada.
  console.log('--- baseline: a copia tem de passar limpa ---');
  const f1 = ficheirosDoParser(raiz);
  const f2 = todosOsTestes(raiz);
  const b1 = await rodaTestes(raiz, f1);
  console.log(`  fase 1 (parser, ${f1.length} ficheiros): ${b1.passou}/${b1.testes} pass, ${b1.falhou} fail  ${b1.ms}ms`);
  const b2 = await rodaTestes(raiz, f2);
  console.log(`  fase 2 (suite,   ${f2.length} ficheiros): ${b2.passou}/${b2.testes} pass, ${b2.falhou} fail  ${b2.ms}ms`);
  if (!b1.ok || !b2.ok) {
    console.error('');
    console.error('BASELINE VERMELHA na copia. Nada do que se segue seria prova.');
    if (b1.nomesFalha.length) console.error(`  fase 1: ${b1.nomesFalha.slice(0, 5).join(' | ')}`);
    if (b2.nomesFalha.length) console.error(`  fase 2: ${b2.nomesFalha.slice(0, 5).join(' | ')}`);
    process.exit(1);
  }
  console.log('  baseline verde nas duas fases.');
  console.log('');

  // ------------------------------------------------------------------ E2
  const mutantes = gerarMutantes(original, { n: N, semente: SEMENTE });
  const porOperador = new Map();
  for (const m of mutantes) porOperador.set(m.operador, (porOperador.get(m.operador) ?? 0) + 1);
  console.log(`--- E2: ${mutantes.length} mutantes gerados ---`);
  console.log([...porOperador].sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `  ${String(v).padStart(4)}  ${k}`).join('\n'));
  console.log('');

  // ------------------------------------------------------------------ E3
  console.log('--- E3: a correr ---');
  const t0 = Date.now();
  const bruto = new Array(mutantes.length);
  let prox = 0;
  const trab = async () => {
    for (;;) {
      const i = prox++;
      if (i >= mutantes.length) return;
      const m = mutantes[i];
      aplicaMutante(raiz, m.fonte);
      const f1 = await rodaTestes(raiz, ficheirosDoParser(raiz));
      let f2 = null;
      if (f1.ok) {
        // PASSOU a fase 1 -> SOBREVIVEU. E agora que a suite toda decide.
        // A primeira versao desta linha tinha `if (!f1.ok)`, invertida: a fase 2
        // corria para os mutantes que ja tinham MORRIDO na fase 1, e os que
        // sobreviveram ficavam sem veredito. Foi o que produziu 97
        // `indeterminado-sem-fase-2` — um estado que nao devia existir.
        f2 = await rodaTestes(raiz, todosOsTestes(raiz));
      }
      bruto[i] = {
        id: m.id, operador: m.operador, linha: m.linha, antes: m.antes, depois: m.depois,
        fase1: { testes: f1.testes, pass: f1.passou, fail: f1.falhou, semVeredito: f1.semVeredito, ms: f1.ms },
        fase1Falhas: f1.nomesFalha.slice(0, 6),
        fase2: f2 ? { testes: f2.testes, pass: f2.passou, fail: f2.falhou, semVeredito: f2.semVeredito, ms: f2.ms } : null,
        fase2Falhas: f2 ? f2.nomesFalha.slice(0, 8) : [],
      };
      if ((i + 1) % 25 === 0) {
        const feitos = bruto.filter(Boolean).length;
        const viv = bruto.filter((x) => x && x.fase2 && x.fase2.fail === 0 && !x.fase2.semVeredito).length;
        console.log(`  ${feitos}/${mutantes.length}  sobreviventes ate aqui: ${viv}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONC, mutantes.length) }, trab));
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  // ------------------------------------------------------- classificacao (E3)
  for (const b of bruto) {
    if (b.fase1.semVeredito) b.q = 'indeterminado-sem-veredito';
    else if (b.fase1.fail > 0) b.q = 'morreu-fase-1';
    else if (!b.fase2) b.q = 'indeterminado-sem-fase-2';
    else if (b.fase2.semVeredito) b.q = 'indeterminado-sem-veredito';
    else if (b.fase2.fail > 0) b.q = 'morreu-fase-2';
    else b.q = 'SOBREVIVEU';
  }

  const conta = new Map();
  for (const b of bruto) conta.set(b.q, (conta.get(b.q) ?? 0) + 1);
  const soma = [...conta.values()].reduce((a, b2) => a + b2, 0);
  if (soma !== mutantes.length) {
    console.error(`REGRA 4 VIOLADA: soma ${soma} != ${mutantes.length}. PARANDO.`);
    process.exit(1);
  }

  const ordem = ['SOBREVIVEU', 'morreu-fase-2', 'morreu-fase-1', 'indeterminado-sem-veredito', 'indeterminado-sem-fase-2'];
  console.log('');
  console.log('=== resultado ===');
  console.log(`${mutantes.length} mutantes em ${dt}s`);
  for (const q of ordem) {
    if (!conta.has(q)) continue;
    const n = conta.get(q);
    const pct = (100 * n / mutantes.length).toFixed(1);
    console.log(`  ${q.padEnd(28)} ${String(n).padStart(4)}  (${pct}%)`);
  }
  const sobrev = conta.get('SOBREVIVEU') ?? 0;
  const mortos = (conta.get('morreu-fase-1') ?? 0) + (conta.get('morreu-fase-2') ?? 0);
  const inde = (conta.get('indeterminado-sem-veredito') ?? 0) + (conta.get('indeterminado-sem-fase-2') ?? 0);
  console.log('');
  console.log(`  taxa de morte global: ${mortos}/${mutantes.length} (${(100 * mortos / mutantes.length).toFixed(1)}%)`);
  console.log(`  SOBREVIVENTES: ${sobrev} (${(100 * sobrev / mutantes.length).toFixed(1)}%)  <- cada um e um teste que falta`);
  console.log(`  sem veredito: ${inde}  <- nao e buraco da suite; e limite do harness`);

  console.log('');
  console.log('sobreviventes por operador:');
  const sobPorOp = new Map();
  for (const b of bruto.filter((x) => x.q === 'SOBREVIVEU')) sobPorOp.set(b.operador, (sobPorOp.get(b.operador) ?? 0) + 1);
  const gerPorOp = new Map();
  for (const b of bruto) gerPorOp.set(b.operador, (gerPorOp.get(b.operador) ?? 0) + 1);
  for (const [op, ger] of [...gerPorOp].sort((a, b2) => sobPorOp.get(b2[0]) - sobPorOp.get(a[0]))) {
    const s = sobPorOp.get(op) ?? 0;
    console.log(`  ${op.padEnd(22)} ${s}/${ger} sobreviveram  ${'#'.repeat(Math.min(s, 40))}`);
  }

  const hash = createHash('sha256').update(JSON.stringify(bruto.map((b) => [b.id, b.q, b.fase1.fail, b.fase2?.fail ?? null]))).digest('hex');
  console.log('');
  console.log(`sha256 do resultado: ${hash}`);

  const saida = {
    cabecalho: {
      node: process.version, plataforma: `${process.platform} ${process.arch}`,
      semente: SEMENTE, pedido: N, gerados: mutantes.length,
      linhasParser: original.split('\n').length,
      baselineFase1: { testes: b1.testes, pass: b1.passou, fail: b1.falhou },
      baselineFase2: { testes: b2.testes, pass: b2.passou, fail: b2.falhou },
      segundos: Number(dt), sha256: hash,
    },
    contagem: Object.fromEntries(ordem.filter((q) => conta.has(q)).map((q) => [q, conta.get(q)])),
    soma, total: mutantes.length,
    taxaMorte: mortos / mutantes.length,
    sobreviventes: sobrev / mutantes.length,
    semVeredito: inde / mutantes.length,
    mutantes: bruto,
  };
  writeFileSync(`${SAIDA}/t3-mutantes.json`, `${JSON.stringify(saida, null, 1)}\n`);
  writeFileSync('/tmp/opencode/t3-mutantes.json', `${JSON.stringify(saida, null, 1)}\n`);
  console.log('gravado: reports/conceito/t3-mutantes.json');
} finally {
  limpaWorkspace(raiz);
}
