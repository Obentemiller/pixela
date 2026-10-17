#!/usr/bin/env node
/**
 * diff-pp.mjs — Teste diferencial do pré-processador contra o g++.
 *
 * Para cada fixture em tests/fixtures/pp/*.cpp:
 *   1. roda `g++ -E -P -nostdinc -x c++` e coleta a sequência de TOKENS da
 *      saída (ignorando quebras e espaços);
 *   2. roda o nosso Preprocessor e faz o mesmo;
 *   3. compara as duas sequências.
 *
 * Uso: node tests/tools/diff-pp.mjs [--verbose]
 * Sai com 1 se qualquer fixture divergir.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Preprocessor } from '../../js/cpp/preprocessor.js';
import { Lexer } from '../../js/cpp/lexer.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = join(RAIZ, 'tests', 'fixtures', 'pp');
const VERBOSE = process.argv.includes('--verbose');

/**
 * Normaliza uma saída de pré-processador para uma lista de tokens.
 * Usa o MESMO lexer do compilador — assim comparamos a mesma unidade.
 */
function paraTokens(texto) {
  // Um '#pragma' sobrevivente na saída não é erro de compilação: é
  // diretiva que o pré-processador preserva (o GCC também preserva).
  // O lexer em modo normal marca o '#' como token de erro; em modo
  // preprocess ele vira 'hash'. Comparamos os dois como equivalentes.
  const r = new Lexer(texto, 'saida').tokenize();
  const tokens = r.tokens
    .filter((t) => t.type !== 'eof')
    .map((t) => `${t.type}:${t.value}`);
  return { lista: tokens, diagnosticos: r.diagnostics };
}

function comparar(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return { indice: i, gpp: a[i], nosso: b[i] };
  }
  return null;
}

const arquivos = readdirSync(FIXTURES).filter((f) => f.endsWith('.cpp')).sort();
if (arquivos.length === 0) {
  console.error(`[diff-pp] nenhum fixture em ${FIXTURES}`);
  process.exit(1);
}

const linhas = [];
let iguais = 0;
let diferentes = 0;
const relatorioDivergencias = [];

for (const arq of arquivos) {
  const caminho = join(FIXTURES, arq);
  const fonte = readFileSync(caminho, 'utf8');

  // ---- g++
  // Definimos os mesmos pré-definidos que o nosso pré-processador usa, para
  // que a comparação seja justa (o GCC não conhece __PIXELA_JS__).
  const defines = ['-D__PIXELA_JS__=1', '-D__wasm32__=1'];
  let saidaGpp;
  let erroGpp = null;
  try {
    saidaGpp = execFileSync('g++',
      ['-E', '-P', '-nostdinc', ...defines, '-x', 'c++', '-'],
      { input: fonte, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    // g++ pode avisar em stderr mas ainda produzir saída
    saidaGpp = e.stdout ?? '';
    if (!saidaGpp) erroGpp = `${e.stderr ?? e.message}`.split('\n').slice(0, 3).join(' | ');
  }

  // ---- nosso
  let saidaNossa;
  let erroNosso = null;
  try {
    const pp = new Preprocessor({
      predefined: { __PIXELA_JS__: '1', __wasm32__: '1' },
    });
    const r = pp.process(fonte, arq);
    saidaNossa = r.text;
    if (r.diagnostics.length) {
      erroNosso = r.diagnostics.map((d) => `${d.loc?.line}:${d.loc?.column} ${d.message}`).slice(0, 3).join(' | ');
    }
  } catch (e) {
    erroNosso = `THROW ${e.constructor.name}: ${e.message}`;
  }

  const tGpp = paraTokens(saidaGpp ?? '');
  const tNos = paraTokens(saidaNossa ?? '');

  const diff = comparar(tGpp.lista, tNos.lista);

  const cabecalho = diff
    ? `DIFERE  ${arq} (g++ ${tGpp.lista.length} tokens, nosso ${tNos.lista.length})`
    : `IGUAL   ${arq} (${tGpp.lista.length} tokens)`;

  linhas.push(cabecalho);

  if (erroGpp) linhas.push(`        g++: ${erroGpp}`);
  if (erroNosso) linhas.push(`        nosso: ${erroNosso}`);

  if (diff) {
    diferentes++;
    const janela = 4;
    const ini = Math.max(0, diff.indice - janela);
    const fim = Math.min(tGpp.lista.length, diff.indice + janela);
    linhas.push(`        primeiro diferente no token ${diff.indice}:`);
    linhas.push(`          g++:  ...${tGpp.lista.slice(ini, fim).join(' ')}...`);
    linhas.push(`          nosso:...${tNos.lista.slice(ini, fim).join(' ')}...`);
    relatorioDivergencias.push({ arq, diff, gpp: tGpp.lista.slice(ini, fim), nosso: tNos.lista.slice(ini, fim) });
  } else {
    iguais++;
    if (VERBOSE) linhas.push(`        ${tGpp.lista.join(' ')}`);
  }
}

const cabecalho = [
  `=== diff-pp: ${arquivos.length} fixtures comparadas com g++ -E -P -nostdinc ===`,
  `iguais: ${iguais}   diferentes: ${diferentes}`,
  '',
];

const relatorio = cabecalho.concat(linhas).join('\n');
console.log(relatorio);

const destino = join(RAIZ, 'reports', 'diff-pp.log');
mkdirSync(dirname(destino), { recursive: true });
writeFileSync(destino, relatorio + '\n');
console.log(`\n[diff-pp] relatório em reports/diff-pp.log`);
process.exit(diferentes === 0 ? 0 : 1);