/**
 * tests/conceito/t2/runner.test.mjs — o runner de round-trip se prova.
 *
 * A propriedade que o T2 mede e `unparse(entrada)` aceita -> `unparse` de
 *verdade. Se o runner errar aqui, o relatorio diz que o unparse quebra coisas
 * que ele nao quebra — ou o contrario, que e pior.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { unparse } from '../../../js/cpp/ast.js';
import { desparse, gppTexto, tokensDe, limpaTmp } from './runner.mjs';

test('T2-E1-01: um fonte SIMPLES sobrevive ao round-trip', async () => {
  const src = 'int f(int a) { return a; }\n';
  const g = await gppTexto(src, 'rt-simples');
  assert.equal(g.ok, true, `a original tinha de ser aceite: ${g.erro1}`);
  const d = desparse(src);
  assert.equal(d.erros, 0, `o parser tinha de aceitar: ${d.erro1}`);
  const u = unparse(d.ast);
  const g2 = await gppTexto(u, 'rt-simples-2');
  assert.equal(g2.ok, true, `o unparse produziu C++ invalido:\n${u}\n${g2.erro1}`);
});

test('T2-E1-02: o §10 do P0-2 — template de parametro NAO-TIPO', async () => {
  // `template<int N = 3>` desparseia com `typename ` hardcoded (ast.js:861),
  // e o resultado e C++ invalido. Este teste fixa o comportamento REAL.
  const src = 'template<int N = 3> struct S { int a[N]; };\n';
  assert.equal((await gppTexto(src, 'rt-sec10')).ok, true, 'a original e valida');
  const u = unparse(desparse(src).ast);
  const g = await gppTexto(u, 'rt-sec10-2');
  assert.equal(g.ok, false, 'o unparse deveria quebrar este caso — se comecar a passar, o §10 foi corrigido e o teste tem de ser reescrito');
  assert.ok(u.includes('typename'), `esperava o \`typename \` hardcoded no unparse: ${u}`);
});

test('T2-E1-03: o unparse de TemplateDecl perde o `;` final', async () => {
  // ACHADO DO T2, nao bug do teste. `ast.js` faz
  //   `template<${...}> ${declTexto(d.decl)}`
  // e `declTexto(ClassDecl)` nao emite o `;`. O `VariableDecl` emite — e por
  // isso o defeito so aparece em template/class/enum.
  //
  // `js/cpp/**` e LEITURA neste bloco (regra 6 da ordem longa), e por isso o
  // teste REGISTA o comportamento em vez de exigir o correto. Se um dia o `;`
  // voltar, este teste falha e a correcao e reescrever a expectativa.
  const src = 'template<class T = int> struct S { T x; };\n';
  const u = unparse(desparse(src).ast);
  assert.ok(!u.trimEnd().endsWith(';'),
    `esperava a ausencia do \`;\` final; se ha \`;\`, o bug foi corrigido e este teste deve ser reescrito. unparse: ${u}`);
  const g = await gppTexto(u, 'rt-tipo-2');
  assert.equal(g.ok, false, `o g++ tinha de rejeitar o saida do unparse: ${u}`);
  assert.match(String(g.msg), /expected .;|after struct definition/,
    `mensagem inesperada do g++: ${g.msg}`);
});

test('T2-E1-03b: o `;` NAO falta quando o no e um VariableDecl', async () => {
  // O contralado: se o `;` falta sempre, o bug e do unparse de topo. Se so
  // falta em template/class/enum, e desses nos.
  const u = unparse(desparse('int g = 1;\n').ast);
  assert.ok(u.trimEnd().endsWith(';'), `o VariableDecl emite o \`;\`: ${u}`);
  assert.equal((await gppTexto(u, 'rt-var-2')).ok, true, `o round-trip do VariableDecl tem de dar: ${u}`);
});

test('T2-E1-04: tokensDe conta tokens, e nao caracteres', () => {
  assert.equal(tokensDe('int x;').length, 3);
  assert.equal(tokensDe('int  x  ;').length, 3, 'espaco nao e token');
  assert.ok(tokensDe('int f(int a) { return a; }').length > 8);
});

test('T2-E1-05: o g++ le o texto desparseado (extensao .cpp)', async () => {
  const g = await gppTexto('int;\n', 'sem-extensao-t2');
  assert.equal(g.analisou, true, `o g++ nao leu: ${g.erro1}`);
  assert.equal(g.ok, false, '`int;` e invalido');
});

test.after(() => limpaTmp());
