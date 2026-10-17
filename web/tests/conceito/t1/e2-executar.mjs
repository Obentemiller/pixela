/**
 * tests/conceito/t1/e2-executar.mjs — executa os dois corpora e grava o DADO CRUD.
 *
 * Regra 3 (reprodutivel): o log leva a semente, a versao do g++ e a do node,
 * e o sha256 da saida. Rodar duas vezes tem de dar o mesmo hash.
 *
 * Regra 4 (dado antes da classificacao): este passo NAO classifica nada.
 * Grava `{nome, nosso:{ok,nErros,erro1}, gpp:{ok,exit,erro1}}` por caso, e
 * um "indeterminado" para o que deu timeout. E3 le isto e classifica.
 *
 * Regra 2: nada e regenerado aqui — nem goldens, nem baselines, nem o
 * oraculo. A saida vai para reports/conceito/ e para /tmp.
 *
 * Uso:  node tests/conceito/t1/e2-executar.mjs [n_mutacao] [n_gramatica]
 */
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { gerarMutacoes } from './corpus-mutacao.mjs';
import { gerarGramatica } from './corpus-gramatica.mjs';
import { roda, versoes, limpaTmp } from './runner.mjs';

const RAIZ = new URL('../../../', import.meta.url).pathname;
const SAIDA = `${RAIZ}reports/conceito`;
const SEMENTE_GRAMATICA = 20261016;

const N_MUTACAO = Number(process.argv[2] ?? 0);   // 0 = todos
const N_GRAMATICA = Number(process.argv[3] ?? 3000);
const CONC = Number(process.env.T1_CONC ?? 8);

mkdirSync(SAIDA, { recursive: true });

const mutacao = gerarMutacoes(N_MUTACAO ? { limite: N_MUTACAO } : {});
const gramatica = gerarGramatica(N_GRAMATICA, SEMENTE_GRAMATICA);
const casos = [...mutacao, ...gramatica];
const v = versoes();

console.log('=== T1 E2 — execucao dos corpora ===');
console.log(`semente (gramatica): ${SEMENTE_GRAMATICA}`);
console.log(`g++:  ${v.gpp}`);
console.log(`node: ${v.node}`);
console.log(`plataforma: ${v.plataforma}`);
console.log(`corpus: mutacao=${mutacao.length}  gramatica=${gramatica.length}  TOTAL=${casos.length}`);
console.log(`paralelismo: ${CONC}`);
console.log('');

const t0 = Date.now();
const res = await roda(casos, { conc: CONC });
const dt = (Date.now() - t0) / 1000;
console.log(`${casos.length} casos em ${dt.toFixed(1)}s  (${(casos.length / dt).toFixed(1)}/s)`);

// ---------------------------------------------------------------- dado CRUD
const bruto = res.map((r) => ({
  nome: r.nome,
  op: casos.find((c) => c.nome === r.nome)?.op ?? '?',
  // o g++ decides: timeout = nao diz nada sobre a sintaxe
  gTimeout: r.gpp.timeout,
  gOk: r.gpp.ok,
  gExit: r.gpp.exit,
  gErro1: r.gpp.erro1,
  // a MENSAGEM sem posicao: e o que a tabela de padroes de E3 classifica
  gMsg: r.gpp.msg ?? null,
  nOk: r.nosso.ok,
  nErros: r.nosso.nErros,
  nErro1: r.nosso.erro1,
  nLancou: r.nosso.lancou === true,
}));

// O SHA256 e sobre o dado CRUD ordenado pelo nome: duas execucoes tem de dar
// o mesmo, e so a ordem por nome garante isso independente do paralelismo.
const brutoOrdenado = [...bruto].sort((a, b) => (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0));
const json = JSON.stringify(brutoOrdenado, null, 1);
const hash = createHash('sha256').update(json).digest('hex');

const timeouts = brutoOrdenado.filter((b) => b.gTimeout).length;
const lances = brutoOrdenado.filter((b) => b.nLancou).length;

const cabecalho = {
  ...v,
  sementeGramatica: SEMENTE_GRAMATICA,
  nMutacao: mutacao.length,
  nGramatica: gramatica.length,
  total: casos.length,
  segundos: Number(dt.toFixed(1)),
  timeoutsGpp: timeouts,
  nossoLancou: lances,
  sha256: hash,
};

writeFileSync(`${SAIDA}/t1-e2-bruto.json`, `${JSON.stringify({ cabecalho, casos: brutoOrdenado }, null, 1)}\n`);
writeFileSync('/tmp/opencode/t1-e2-bruto.json', `${JSON.stringify({ cabecalho, casos: brutoOrdenado }, null, 1)}\n`);

console.log('');
console.log(`timeouts do g++: ${timeouts}   (viram "indeterminado" em E3, nunca descartados)`);
console.log(`o NOSSO lancou excecao: ${lances}`);
console.log(`sha256 do dado CRUD: ${hash}`);
console.log(`gravado: reports/conceito/t1-e2-bruto.json e /tmp/opencode/t1-e2-bruto.json`);

limpaTmp();
