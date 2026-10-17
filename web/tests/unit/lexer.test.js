/**
 * tests/unit/lexer.test.js — TDD do lexer.
 *
 * O lexer NÃO LANÇA: cada caso roda dentro de try/catch e um throw é falha.
 * A suíte principal usa o corpus de tests/unit/lexer-cases.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Lexer, Token } from '../../js/cpp/lexer.js';
import { CASOS } from './lexer-cases.mjs';

/** Executa o lexer convertendo throws em resultado observável. */
function lexSeguro(src, opts = {}) {
  try {
    return { lancou: null, ...new Lexer(src, 't.cpp').tokenize(opts) };
  } catch (e) {
    return { lancou: e, tokens: null, diagnostics: null };
  }
}

/** Opções de tokenização exigidas por um caso do corpus. */
function optsDoCaso(caso) {
  return caso.modoPreprocess ? { mode: 'preprocess' } : {};
}

function formaEsperada(esperado) {
  return esperado.map((x) => (x === 'eof' ? 'eof' : x));
}

function formaReal(tokens) {
  return tokens.map((tk) => (tk.type === 'eof' ? 'eof' : [tk.type, tk.value]));
}

// ---------------------------------------------------------------- corpus

test('lexer: corpus completo', async (t) => {
  assert.ok(CASOS.length >= 80, `corpus tem ${CASOS.length} casos, exigido >= 80`);

  let passou = 0;
  const falhas = [];

  for (const caso of CASOS) {
    const r = lexSeguro(caso.src, optsDoCaso(caso));
    if (r.lancou) {
      falhas.push(`${caso.nome}: LEVANTOU ${r.lancou.constructor.name}: ${r.lancou.message}`);
      continue;
    }
    const esperado = formaEsperada(caso.esperado);
    const real = formaReal(r.tokens);

    if (JSON.stringify(esperado) !== JSON.stringify(real)) {
      falhas.push(
        `${caso.nome}\n    src:      ${JSON.stringify(caso.src)}\n` +
        `    esperado: ${JSON.stringify(esperado)}\n    real:     ${JSON.stringify(real)}`
      );
      continue;
    }
    if (caso.diagnosticos !== undefined && r.diagnostics.length !== caso.diagnosticos) {
      falhas.push(
        `${caso.nome}: diagnosticos esperado=${caso.diagnosticos} real=${r.diagnostics.length}` +
        ` (${JSON.stringify(r.diagnostics.map((d) => d.message))})`
      );
      continue;
    }
    passou++;
  }

  await t.test(`${passou}/${CASOS.length} casos do corpus`, () => {
    assert.equal(falhas.length, 0, `\n  ` + falhas.join('\n  '));
  });
});

test('lexer: o corpus tem pelo menos 80 casos', () => {
  assert.ok(CASOS.length >= 80, `corpus tem ${CASOS.length}, exigido >= 80`);
});

// ---------------------------------------------------------------- invariantes

test('lexer: nunca lança para nenhuma entrada', () => {
  for (const caso of CASOS) {
    const r = lexSeguro(caso.src, optsDoCaso(caso));
    assert.equal(r.lancou, null,
      `${caso.nome}: lançou ${r.lancou?.constructor.name}: ${r.lancou?.message}`);
  }
});

test('lexer: sempre termina com exatamente um token eof', () => {
  for (const caso of CASOS) {
    const r = lexSeguro(caso.src, optsDoCaso(caso));
    assert.ok(r.tokens.length >= 1, caso.nome);
    assert.equal(r.tokens.at(-1).type, 'eof', `${caso.nome}: último token não é eof`);
    assert.equal(r.tokens.filter((x) => x.type === 'eof').length, 1,
      `${caso.nome}: mais de um eof`);
  }
});

test('lexer: todo token tem posição 1-based e monotonamente crescente', () => {
  const src = 'int main() {\n  int x = 42;\n  return x;\n}\n';
  const { tokens } = new Lexer(src, 't.cpp').tokenize();
  let ultimoOffset = -1;
  for (const tk of tokens) {
    assert.ok(tk.loc.line >= 1, `${tk.type}: linha ${tk.loc.line} < 1`);
    assert.ok(tk.loc.column >= 1, `${tk.type}: coluna ${tk.loc.column} < 1`);
    if (tk.type !== 'eof') {
      assert.ok(tk.loc.start >= ultimoOffset,
        `${tk.type}@${tk.loc.line}:${tk.loc.column}: offset regrediu`);
      ultimoOffset = tk.loc.start;
    }
  }
});

test('lexer: loc de cada token aponta para o texto certainado', () => {
  const src = 'int main() {\n  int x = 42;\n}';
  const { tokens } = new Lexer(src, 't.cpp').tokenize();
  const linhas = src.split('\n');
  for (const tk of tokens) {
    if (tk.type === 'eof') continue;
    const linha = linhas[tk.loc.line - 1];
    assert.ok(linha !== undefined, `${tk.type}: linha ${tk.loc.line} inexiste`);
    const textoNaPos = linha.slice(tk.loc.column - 1, tk.loc.column - 1 + String(tk.value).length);
    // para literais, o texto-fonte é o valor; para operators/punctuators também
    assert.equal(textoNaPos, String(tk.value),
      `${tk.type}: loc ${tk.loc.line}:${tk.loc.column} não aponta para ${JSON.stringify(String(tk.value))}`);
  }
});

// ---------------------------------------------------------------- header-name

test('lexer: modo preprocess reconhece #include <...> como header-name', () => {
  const r = new Lexer('#include <vector>', 't.cpp').tokenize({ mode: 'preprocess' });
  const hn = r.tokens.find((x) => x.type === 'header-name');
  assert.ok(hn, `esperava header-name, veio: ${JSON.stringify(r.tokens.map((x) => [x.type, x.value]))}`);
  assert.equal(hn.value, 'vector');
});

test('lexer: modo preprocess reconhece #include "..." como header-name', () => {
  const r = new Lexer('#include "meu.h"', 't.cpp').tokenize({ mode: 'preprocess' });
  const hn = r.tokens.find((x) => x.type === 'header-name');
  assert.ok(hn);
  assert.equal(hn.value, 'meu.h');
});

test('lexer: fora do modo preprocess, #include vira tokens normais', () => {
  const r = new Lexer('#include <vector>', 't.cpp').tokenize();
  assert.ok(r.tokens.some((x) => x.type === 'ident' && x.value === 'vector'));
  assert.ok(!r.tokens.some((x) => x.type === 'header-name'));
});

// ---------------------------------------------------------------- API

test('lexer: Token.toString mostra tipo, valor e linha:coluna', () => {
  assert.equal(new Token('ident', 'x', { line: 2, column: 5 }).toString(), 'ident:x@2:5');
});

test('lexer: tokenize é repetível no mesmo Lexer', () => {
  const l = new Lexer('int x', 't.cpp');
  const a = l.tokenize();
  const b = l.tokenize();
  assert.deepEqual(formaReal(a.tokens), formaReal(b.tokens));
  assert.deepEqual(formaReal(a.tokens), [
    ['keyword', 'int'], ['ident', 'x'], 'eof',
  ]);
});

test('lexer: source vazio devolve só eof e zero diagnósticos', () => {
  const r = new Lexer('', 't.cpp').tokenize();
  assert.equal(r.tokens.length, 1);
  assert.equal(r.tokens[0].type, 'eof');
  assert.deepEqual(r.diagnostics, []);
});