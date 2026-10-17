/**
 * tests/conceito/t2/e2-executar.mjs — corpus do round-trip, dado CRUD.
 *
 * O corpus sao tres populacoes deorzamento diferente:
 *
 *   (a) as 120 fixtures `parse-valid` — C++ escrito a mao, aceito pelo g++
 *   (b) o corpus GRAMATICAL do T1, 3 000 casos semeados
 *   (c) os ficheiros REAIS do projeto (os 12 de `parse-project.mjs`)
 *
 * (a) e o que o g++ ja aprova por construcao; (b) e volume; (c) e o que o
 * utilizador vai de facto escrever. Um unparse que so funciona em (a) nao
 * funciona.
 *
 * Regra 2: nada e regenerado — nem goldens, nem baseline, nem o oraculo.
 * Regra 3: semente, versoes e sha256 em todo o log; duas execucoes tem de dar
 * o mesmo hash.
 * Regra 4: DADO CRU primeiro. A classificacao e o passo seguinte.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gerarGramatica } from '../t1/corpus-gramatica.mjs';
import { roda, versoes, limpaTmp } from './runner.mjs';

const RAIZ = new URL('../../../', import.meta.url).pathname;
const SAIDA = `${RAIZ}reports/conceito`;
const SEMENTE = 20261016;
const N_GRAMATICA = Number(process.argv[2] ?? 3000);
const CONC = Number(process.env.T2_CONC ?? 8);

/** (a) as 120 fixtures `parse-valid` */
function fixtures() {
  const dir = join(RAIZ, 'tests', 'fixtures', 'parse-valid');
  return readdirSync(dir).filter((f) => f.endsWith('.cpp')).sort().map((f) => ({
    nome: `fix__${f.replace(/\.cpp$/, '')}`, pop: 'fixture',
    fonte: readFileSync(join(dir, f), 'utf8'),
  }));
}

/** (c) os ficheiros reais do projeto — `src/` inteiro, nao so 3 exemplos */
function projeto() {
  const dir = join(RAIZ, 'src');
  const achei = [];
  const anda = (rel) => {
    const p = join(dir, rel);
    if (!existsSync(p)) return;
    if (rel.endsWith('.cpp')) {
      achei.push({
        nome: `proj__${rel.replace(/[/.]/g, '_')}`, pop: 'projeto',
        fonte: readFileSync(p, 'utf8'), noDisco: p,
      });
      return;
    }
    // `.hpp`/`.h` sao CABECALHOS, nao unidades de traducao: nao sao fonte a
    // medir por conta propria, sao include dos .cpp. `scandir` num ficheiro
    // solto lanca ENOTDIR.
    if (/\.h(pp)?$/.test(rel)) return;
    if (!readdirSync(p).length) return;
    for (const d of readdirSync(p).sort()) anda(rel ? `${rel}/${d}` : d);
  };
  for (const d of readdirSync(dir).sort()) anda(d);
  return achei;
}

const fix = fixtures();
const gra = gerarGramatica(N_GRAMATICA, SEMENTE).map((c) => ({ nome: c.nome, pop: 'gramatica', fonte: c.fonte }));
const pro = projeto();
const casos = [...fix, ...pro, ...gra];

const v = versoes();
console.log('=== T2 E2 — round-trip: parse -> unparse -> g++ ===');
console.log(`semente (gramatica): ${SEMENTE}`);
console.log(`g++:  ${v.gpp}`);
console.log(`node: ${v.node}`);
console.log(`plataforma: ${v.plataforma}`);
console.log(`corpus: fixture=${fix.length}  projeto=${pro.length}  gramatica=${gra.length}  TOTAL=${casos.length}`);
console.log(`paralelismo: ${CONC}`);
console.log('');

const t0 = Date.now();
const res = await roda(casos, { conc: CONC });
const dt = (Date.now() - t0) / 1000;
console.log(`${casos.length} casos em ${dt.toFixed(1)}s (${(casos.length / dt).toFixed(1)}/s)`);

// ------------------------------------------------------------------ dado CRUD
const bruto = res.map((r, i) => ({
  nome: casos[i].nome,
  pop: casos[i].pop,
  // o g++ na ORIGINAL
  origOk: r.original.ok,
  origErro1: r.original.erro1,
  origAnalisou: r.original.analisou,
  // o nosso parser na original
  parseErros: r.erroParser ? 1 : 0,
  parseErro1: r.erroParser,
  // o unparse
  texto: r.desparse?.texto ?? null,
  // o g++ no UNPARSE
  unparseOk: r.desparse?.gpp.ok ?? null,
  unparseErro1: r.desparse?.gpp.erro1 ?? null,
  unparseMsg: r.desparse?.gpp.msg ?? null,
  // idempotencia
  idempotente: r.idempotente,
  // perda de tokens
  tokensOrig: r.tokensOrig,
  tokensSai: r.tokensSai,
  timeouts: (r.original.timeout ? 1 : 0) + (r.desparse?.gpp.timeout ? 1 : 0),
}));

const ordenados = [...bruto].sort((a, b) => (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0));
const hash = createHash('sha256').update(JSON.stringify(ordenados, null, 1)).digest('hex');
const cabecalho = {
  ...v, sementeGramatica: SEMENTE,
  nFixture: fix.length, nProjeto: pro.length, nGramatica: gra.length, total: casos.length,
  segundos: Number(dt.toFixed(1)), sha256: hash,
};

writeFileSync(`${SAIDA}/t2-e2-bruto.json`, `${JSON.stringify({ cabecalho, casos: ordenados }, null, 1)}\n`);
writeFileSync('/tmp/opencode/t2-e2-bruto.json', `${JSON.stringify({ cabecalho, casos: ordenados }, null, 1)}\n`);

const to = ordenados.filter((c) => c.timeouts > 0).length;
console.log('');
console.log(`timeouts: ${to}`);
console.log(`sha256 do dado CRUD: ${hash}`);
console.log('gravado: reports/conceito/t2-e2-bruto.json e /tmp/opencode/t2-e2-bruto.json');
limpaTmp();
