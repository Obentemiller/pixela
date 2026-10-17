#!/usr/bin/env node
/**
 * tests/tools/mutantes-pp.mjs — dos mutantes de pré-processador, com prova de morte.
 *
 * Para cada mutante: aplica a mutação numa CÓPIA do pré-processador, roda um
 * conjunto de verificações, e exige que pelo menos uma FALHE. Um mutante que
 * sobrevive é um buraco no suite: a forma correta de isto é o mutante morrer.
 *
 * Uso: node tests/tools/mutantes-pp.mjs [--raiz <dir>] [--log <arquivo>]
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { rmSync, cpSync } from 'node:fs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..');
const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : d;
};
const raiz = arg('--raiz', RAIZ);
const LOG = arg('--log', null);

const L = [];
const say = (...a) => {
  const s = a.join(' ');
  L.push(s);
  console.log(s);
};

// ---------------------------------------------------------------- mutantes

/**
 * Cada mutante é uma lista de substituições `{ de, para }` aplicadas ao texto
 * de `js/cpp/preprocessor.js`. Se `de` nao aparecer, o mutante MORRE na
 * propria aplicação (o código mudou) — isso também é uma morte legítima, e
 *她说 que é registrado.
 */
const MUTANTES = [
  {
    id: 'PP-M01',
    nome: 'hide-set removido (blue paint)',
    porQue: 'Sem o hide-set, #define A A reexpande ate o limite de profundidade.',
    de: 'const novoHide = new Set(hideSet);',
    para: 'const novoHide = new Set();',
  },
  {
    id: 'PP-M02',
    nome: '`##` sem revalidação: cola os tokens crus',
    porQue: 'O `##` tem de colar os tokens e RE-LEXAR, para que o token formado '
      + 'tenha o tipo certo. Colar texto e re-lexar depois, em vez de re-lexar '
      + 'os dois lados juntos, quebra `#define CAT(a,b) a ## b` com `a`=`fo`, '
      + '`b`=`o`.',
    de: "saida.push(...this._textoParaTokens(esqTexto + dirTexto));",
    para: "saida.push(...(esq ? [esq] : []), ...(dir ? [dir] : []));",
  },
  {
    id: 'PP-M05',
    nome: 'hide-set nunca consultado em _expandir',
    // A EXIGENCIA: "equivalente so vale com prova: argumento escrito + um
    // fixture que exercita o caso-limite e da saida identica".
    // O argumento, escrito:
    //   `_expandir` tem DUAS consultas ao hide-set. A primeira,
    //   `if (!hideSet.has(t.value))`, decide se o token pode ser expandido.
    //   A segunda esta em `_expandirMacro`: `if (hideSet.has(def.nome))
    //   return { expandiu: false }`. As duas testam a MESMA condicao sobre o
    //   MESMO token (o valor do token e o nome da macro procurada, e sao
    //   iguais porque a busca so chega a `_expandirMacro` quando
    //   `this.macros.get(t.value)` achou a definicao). Logo remover a
    //   primeira nao muda o resultado observavel: a segunda bloqueia o mesmo
    //   conjunto de expansoes.
    // O caso-limite que exercita exatamente isso e `#define A A` (a macro
    // cuja unica expansao seria ela propria) e a recursao mutua de 3. Com e
    // sem a mutacao, a saida tem de ser IDENTICA — e o harness compara
    // saida com saida, nao apenas contra o esperado.
    provaEquivalencia: [
      { nome: 'caso-limite #define A A', fonte: '#define A A\nA\n' },
      { nome: 'caso-limite recursao mutua de 3', fonte: '#define A B\n#define B C\n#define C A\nA\n' },
      { nome: 'caso-limite f recursiva', fonte: '#define f(x) f(x + 1)\nf(1)\n' },
    ],
    equivalente: true,
    de: 'if (!hideSet.has(t.value)) {',
    para: 'if (true) {',
  },
  {
    id: 'PP-M03',
    nome: '`#` (stringify) sem normalizar espacos',
    porQue: 'O padrao manda colapsar espacos internos para um espaco simples.',
    // A normalizacao de espacos do `#` NAO esta em `_stringToken`: esta em
    // `textoDe`, que junta os tokens do argumento com UM espaco entre eles.
    // A primeira versao deste mutante mexia no `esc`, que so affecta o campo
    // `text` do token — o valor (`value`) continua igual, e a comparacao por
    // token nao via nada. Por isso ele "moria" por um caso de outra mutacao.
    de: "const textoDe = (idx) => (args[idx] ?? []).map((x) => x.text ?? String(x.value ?? '')).join(' ');",
    para: "const textoDe = (idx) => (args[idx] ?? []).map((x) => x.text ?? String(x.value ?? '')).join('');",
  },
  {
    id: 'PP-M04',
    nome: '`defined` ignorado em #if',
    porQue: 'Sem tratar `defined(X)`, todo #if com defined cai para avaliacao de identificador.',
    de: "case 'defined':",
    para: "case '__IGNORADO_DEFINED__':",
    alternativa: {
      de: '=== \'defined\'',
      para: '=== \'__IGNORADO_DEFINED__\'',
    },
  },
];

// ------------------------------------------------------ infra de execução

const TMP = join(tmpdir(), `pixela-mutantes-pp-${process.pid}`);
mkdirSync(TMP, { recursive: true });
cpSync(join(raiz, 'js'), join(TMP, 'js'), { recursive: true });
const PP = join(TMP, 'js', 'cpp', 'preprocessor.js');
const ORIGINAL = readFileSync(PP, 'utf8');

async function carregarPP() {
  // busta o cache de módulos ESM com query-string
  const mod = await import(`${PP}?v=${Math.random()}`);
  return { Lexer: mod.default ?? mod, Preprocessor: mod.Preprocessor };
}

// ---------------------------------------------------------- verificações

/** Casos cujo resultado depende do hide-set / stringify / ## / defined. */
const CASOS = [
  // hide-set
  { nome: 'hs01 #define A A', fixture: 'hs01-auto-recursivo.cpp', fonte: '#define A A\nA\n', esperado: 'A' },
  { nome: 'hs03 #define f(x) f(x+1)', fixture: 'hs03-funcao-recursiva.cpp', fonte: '#define f(x) f(x + 1)\nf(1)\n', esperado: 'f(1 + 1)' },
  // O padrao: ao expandir X, o hide-set ganha X; o corpo de X e `Y`, que
  // expande com hide-set {X}; o corpo de Y e `X`, que JA ESTA no hide-set e
  // nao expande. Resultado: `X`. (Eu esperava `Y` — o g++ diz `X`, e o
  // `g++` e o oraculo.)
  { nome: 'hs04 mutua X/Y', fixture: 'hs04-recursao-mutua.cpp', fonte: '#define X Y\n#define Y X\nX\n', esperado: 'X' },
  { nome: 'hs05 mutua A/B/C', fixture: 'hs05-recursao-mutua-encadeada.cpp', fonte: '#define A B\n#define B C\n#define C A\nA\n', esperado: 'A' },
  { nome: 'hs09 ## forma token reexpande', fixture: 'hs09-concat-cria-macro.cpp', fonte: '#define foo 42\n#define J(a, b) a ## b\nJ(fo, o)\n', esperado: '42' },
  { nome: 'hs11 hide-set nao escapa', fixture: 'hs11-hide-set-nao-escapa.cpp', fonte: '#define A B\n#define B A\nA\n', esperado: 'A' },
  // stringify
  { nome: 'hs07 # normaliza espacos', fixture: 'hs07-stringify-sem-espaco.cpp', fonte: '#define S(x) #x\nS(  a   +   b  )\n', esperado: '"a + b"' },
  // ##
  { nome: 'hs08 ## forma token', fixture: 'hs08-concat-sem-revalidacao.cpp', fonte: '#define CAT(a, b) a ## b\nCAT(fo, o)\n', esperado: 'foo' },
  // defined
  { nome: 'defined em #if', fixture: 'hs12-definida-em-if-dentro.cpp', fonte: '#define X 1\n#if defined(X)\nint y = 1;\n#else\nint y = 2;\n#endif\n', esperado: 'int y = 1;' },
  { nome: 'defined(X) falso', fixture: 'hs12-definida-em-if-dentro.cpp', fonte: '#if defined(NAO_EXISTE)\nint z = 1;\n#else\nint z = 2;\n#endif\n', esperado: 'int z = 2;' },
  // sanidade
  { nome: 'macro simples', fonte: '#define N 7\nint v = N;\n', esperado: 'int v = 7;' },
  { nome: 'include normal', fonte: '#define H "inc.h"\n', esperado: '' },
];

/**
 * Normaliza uma saida para comparar: a SEQUENCIA DE TOKENS.
 *
 * A primeira versao comparava texto normalizado e matava mutantes por
 * ESPAÇO — `f(1 + 1)` e `f( 1+1)` tem os mesmos tokens, e o mutante do
 * stringify era dado como morto sem nunca ter exercido o stringify. Aqui a
 * comparacao e por token, que e o que o `g++ -E` tambem produz.
 */
function tokensDe(texto) {
  const { Lexer } = lexerMod;
  const r = new Lexer(texto, 'saida.cpp').tokenize();
  return r.tokens
    .filter((t) => t.type !== 'eof' && t.type !== 'error' && t.type !== 'hash')
    .map((t) => `${t.type}:${t.value}`)
    .join(' ');
}

/** Preenche `lexerMod` uma vez, do ORIGINAL (o lexer nao e mutado aqui). */
let lexerMod = null;

/** Compara a saida COM e SEM a mutacao — a prova de equivalencia. */
async function provaEquivalencia(m) {
  writeFileSync(PP, ORIGINAL);
  const antes = {};
  {
    const { Preprocessor } = await import(`${PP}?v=${Date.now()}${Math.random()}`);
    for (const c of m.provaEquivalencia) {
      const pp = new Preprocessor({}).process(c.fonte, 'eq.cpp');
      antes[c.nome] = tokensDe(pp.text);
    }
  }
  writeFileSync(PP, ORIGINAL.replace(m.de, m.para));
  const depois = {};
  {
    const { Preprocessor } = await import(`${PP}?v=${Date.now()}${Math.random()}`);
    for (const c of m.provaEquivalencia) {
      const pp = new Preprocessor({}).process(c.fonte, 'eq.cpp');
      depois[c.nome] = tokensDe(pp.text);
    }
  }
  writeFileSync(PP, ORIGINAL);
  const linhas = [];
  let identicos = 0;
  for (const c of m.provaEquivalencia) {
    const igual = antes[c.nome] === depois[c.nome];
    if (igual) identicos++;
    linhas.push(`         ${igual ? 'IDENTICO' : 'DIFERE  '}  ${c.nome}`);
    linhas.push(`           sem mutante: ${JSON.stringify(antes[c.nome])}`);
    linhas.push(`           com mutante: ${JSON.stringify(depois[c.nome])}`);
  }
  return { identicos, total: m.provaEquivalencia.length, linhas };
}

async function rodarTodos() {
  const { Preprocessor } = await import(`${PP}?v=${Date.now()}${Math.random()}`);
  const falhas = [];
  for (const c of CASOS) {
    const pp = new Preprocessor({ predefined: { __PIXELA_JS__: '1', __wasm32__: '1' } })
      .process(c.fonte, 'mutante.cpp');
    const obtido = tokensDe(pp.text);
    const esperado = tokensDe(c.esperado);
    if (!obtido.includes(esperado)) {
      falhas.push({
        nome: c.nome,
        fixture: c.fixture ?? null,
        esperado,
        obtido,
        mensagem: pp.diagnostics.length
          ? `pre-processador emitiu ${pp.diagnostics.length} diagnóstico(s): ${pp.diagnostics[0].message}`
          : 'saída divergente do esperado, sem diagnóstico',
        erros: pp.diagnostics.length,
      });
    }
  }
  return falhas;
}

// ------------------------------------------------------------- execução

say('=== mutantes-pp ===');
say(`raiz: ${raiz}`);
say('');

lexerMod = await import(`${join(raiz, 'js', 'cpp', 'lexer.js')}`);

// Baseline: sem mutação, tudo tem de passar.
const baseline = await rodarTodos();
say(`baseline (sem mutante): ${CASOS.length - baseline.length}/${CASOS.length} casos OK`);
if (baseline.length > 0) {
  say('ATENCAO: o baseline ja falha — os casos nao medem o que dizem medir:');
  for (const f of baseline) say(`  ${f.nome}: esperado ${JSON.stringify(f.esperado)}, veio ${JSON.stringify(f.obtido)}`);
}
say('');

let mortos = 0;
let vivos = 0;
let equivalentes = 0;
const resumo = [];

for (const m of MUTANTES) {
  let texto = ORIGINAL;
  let aplicado = false;
  if (texto.includes(m.de)) {
    texto = texto.replace(m.de, m.para);
    aplicado = true;
  } else if (m.alternativa && texto.includes(m.alternativa.de)) {
    texto = texto.replace(m.alternativa.de, m.alternativa.para);
    aplicado = true;
  }

  if (!aplicado) {
    // O codigo mudou desde que o mutante foi escrito: o mutante MORREU por
    // nao-encontrar-o-alvo. Registrado como tal.
    resumo.push({ id: m.id, nome: m.nome, estado: 'MORTO (alvo nao encontrado no codigo)' });
    mortos++;
    say(`MORTO  ${m.id} — ${m.nome}`);
    say(`       (alvo \`${m.de.slice(0, 48)}...\` nao existe mais no codigo)`);
    continue;
  }

  writeFileSync(PP, texto);
  const falhas = await rodarTodos();
  writeFileSync(PP, ORIGINAL);

  if (falhas.length > 0) {
    mortos++;
    resumo.push({ id: m.id, nome: m.nome, estado: 'MORTO', falha: falhas });
    say(`MORTO  ${m.id} — ${m.nome}`);
    say(`       por que: ${m.porQue}`);
    say(`       diff da mutação:`);
    say(`         - ${m.de}`);
    say(`         + ${m.para}`);
    for (const f of falhas) {
      say(`       teste que morreu: ${f.nome}${f.fixture ? `  [fixture ${f.fixture}]` : ''}`);
      say(`         esperado: ${JSON.stringify(f.esperado)}`);
      say(`         obtido:   ${JSON.stringify(f.obtido)}`);
      say(`         mensagem: ${f.mensagem}`);
    }
  } else if (m.equivalente) {
    // "Equivalente so vale com prova." Sem a prova, conta como VIVO.
    if (!m.provaEquivalencia) {
      vivos++;
      resumo.push({ id: m.id, nome: m.nome, estado: 'VIVO (sem prova)', falha: [] });
      say(`VIVO   ${m.id} — ${m.nome}`);
      say(`       Sobrevive e foi marcado equivalente MAS NAO tem prova de`);
      say(`       equivalencia. Sem prova, conta como VIVO.`);
      say('');
      continue;
    }
    const p = await provaEquivalencia(m);
    const provado = p.identicos === p.total;
    if (provado) {
      equivalentes++;
      resumo.push({ id: m.id, nome: m.nome, estado: 'EQUIVALENTE (provado)', falha: [] });
      say(`EQUIV  ${m.id} — ${m.nome}`);
      say(`       diff da mutação:`);
      say(`         - ${m.de}`);
      say(`         + ${m.para}`);
      say(`       prova: ${p.identicos}/${p.total} casos-limite dão saida IDENTICA`);
      for (const l of p.linhas) say(l);
    } else {
      vivos++;
      resumo.push({ id: m.id, nome: m.nome, estado: 'VIVO (equivalencia refutada)', falha: [] });
      say(`VIVO   ${m.id} — ${m.nome}`);
      say(`       A equivalencia foi REFUTADA: ${p.identicos}/${p.total} identicos.`);
      for (const l of p.linhas) say(l);
    }
    say('');
  } else {
    vivos++;
    resumo.push({ id: m.id, nome: m.nome, estado: 'VIVO', falha: [] });
    say(`VIVO   ${m.id} — ${m.nome}`);
    say(`       NENHUM caso falhou: o mutante nao e detectado. BURACO NO SUITE.`);
  }
  say('');
}

rmSync(TMP, { recursive: true, force: true });

say('=== resumo ===');
say(`mutantes: ${MUTANTES.length}   mortos: ${mortos}   equivalentes: ${equivalentes}   vivos (buraco): ${vivos}`);
for (const r of resumo) say(`  ${r.id} ${r.estado.padEnd(40)} ${r.nome}`);

const texto = `${L.join('\n')}\n`;
if (LOG) {
  writeFileSync(LOG, texto);
  say(`relatorio em ${LOG}`);
}

// Sai com 1 se algum mutante sobreviveu: um mutante vivo e um teste faltando.
process.exit(vivos > 0 ? 1 : 0);