/**
 * tests/unit/goldens.test.js — os goldens rodam dentro de `npm test`.
 *
 * Antes, `tests/tools/gen-goldens.mjs --check` existia mas NADA o executava:
 * os 111 goldens eram gerados uma vez e nunca mais comparados. Um golden que
 * ninguém verifica congela o que foi gravado, não o que o parser produz.
 *
 * Este arquivo faz duas coisas, ambas dentro de `npm test`:
 *
 *  1. Cada golden vira um `test()` INDIVIDUAL — um por construção. O nome do
 *     teste é o nome do golden, então uma falha diz exatamente qual
 *     construção mudou.
 *  2. Cada golden é verificado nos DOIS sentidos: o `.json` gravado tem de
 *     bater com a AST que o parser produz agora, e o `.cpp` tem de bater com
 *     o caso que o gerou.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lexer } from '../../js/cpp/lexer.js';
import { Parser } from '../../js/cpp/parser.js';
import { unparse } from '../../js/cpp/ast.js';
import { CASOS } from '../tools/golden-casos.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GOLDEN = join(RAIZ, 'tests', 'golden', 'ast');

/**
 * AST sem `loc` — a mesma forma que `gen-goldens.mjs` grava.
 * A ordem das chaves NÃO é ordenada: o gerador usa `Object.keys(no)` sem
 * `sort()`, e ordenar aqui faria todo golden divergir.
 */
function semLoc(no) {
  if (no === null || typeof no !== 'object') return no;
  if (Array.isArray(no)) return no.map(semLoc);
  const out = {};
  for (const k of Object.keys(no)) {
    if (k === 'loc' || k === 'locEnd') continue;
    out[k] = semLoc(no[k]);
  }
  return out;
}

const nomes = Object.keys(CASOS);

// ------------------------------------------------- 1. um test() por golden

for (const nome of nomes) {
  test(`golden ${nome}: a AST gravada bate com a que o parser produz`, () => {
    const base = join(GOLDEN, nome);
    assert.ok(existsSync(`${base}.cpp`), `falta o golden ${nome}.cpp — rode gen-goldens.mjs`);
    assert.ok(existsSync(`${base}.json`), `falta o golden ${nome}.json — rode gen-goldens.mjs`);

    const src = readFileSync(`${base}.cpp`, 'utf8').replace(/\n$/, '');
    const esperado = readFileSync(`${base}.json`, 'utf8').replace(/\n$/, '');

    const lex = new Lexer(src, `${nome}.cpp`).tokenize();
    const r = new Parser(lex.tokens, { file: `${nome}.cpp` }).parse();
    assert.equal(r.diagnostics.length, 0,
      `${nome}: ${r.diagnostics.slice(0, 3).map((d) => `${d.code} ${d.message}`).join('; ')}`);

    const atual = JSON.stringify(semLoc(r.ast), null, 2);
    assert.equal(atual, esperado, `${nome}: a AST mudou (unparse: ${JSON.stringify(unparse(r.ast))})`);
  });
}

// ------------------------------------------------- 2. o .cpp bate com o caso

for (const nome of nomes) {
  test(`golden ${nome}: o fonte gravado bate com o caso em gen-goldens.mjs`, () => {
    const base = join(GOLDEN, nome);
    assert.ok(existsSync(`${base}.cpp`), `falta o golden ${nome}.cpp`);
    assert.equal(readFileSync(`${base}.cpp`, 'utf8').replace(/\n$/, ''), CASOS[nome],
      `${nome}: o .cpp gravado divergiu do caso em gen-goldens.mjs`);
  });
}

// ------------------------------------------------- 2b. o UNPARSE gravado bate
//
// O `.txt` é o texto que o `unparse` produz. Sem esta comparação, uma
// regressão no unparse passava: a AST continuava igual e o golden ficava
// verde. Foi o que aconteceu com `case 'InitList'` — quebrá-lo para
// `'BROKEN'` mantinha os 224 testes verdes até esta linha existir.

for (const nome of nomes) {
  test(`golden ${nome}: o unparse gravado bate com o que o unparse produz`, () => {
    const base = join(GOLDEN, nome);
    assert.ok(existsSync(`${base}.txt`), `falta o golden ${nome}.txt`);
    const src = readFileSync(`${base}.cpp`, 'utf8').replace(/\n$/, '');
    const esperado = readFileSync(`${base}.txt`, 'utf8').replace(/\n$/, '');
    const lex = new Lexer(src, `${nome}.cpp`).tokenize();
    const r = new Parser(lex.tokens, { file: `${nome}.cpp` }).parse();
    assert.equal(unparse(r.ast), esperado, `${nome}: o unparse mudou`);
  });
}

// ------------------------------------------------- 3. inventário

test(`inventário: ${nomes.length} goldens, um por construção`, () => {
  const porPrefixo = new Map();
  for (const n of nomes) {
    const p = n.split('-')[0];
    porPrefixo.set(p, (porPrefixo.get(p) ?? 0) + 1);
  }
  console.log(`      goldens por família: ${[...porPrefixo]
    .map(([k, v]) => `${k}=${v}`).join(' ')}`);
  assert.ok(porPrefixo.get('t21') >= 18,
    `só ${porPrefixo.get('t21')} goldens t21 — a ordem pede 18 formas de T2.1`);
  assert.ok(porPrefixo.get('t23') >= 2,
    `só ${porPrefixo.get('t23')} goldens t23 — a ordem pede as 2 formas de linkage`);
});

test('todo golden tem .cpp, .json e .txt', () => {
  const faltando = [];
  for (const nome of nomes) {
    for (const ext of ['.cpp', '.json', '.txt']) {
      if (!existsSync(join(GOLDEN, `${nome}${ext}`))) faltando.push(`${nome}${ext}`);
    }
  }
  assert.deepEqual(faltando, [], `goldens sem arquivo: ${faltando.join(', ')}`);
});