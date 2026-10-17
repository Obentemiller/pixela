/**
 * P6 — o tipo é o que a TypeNameScope diz, não "toda letra maiúscula".
 *
 * O commit 463cab7.trouxe a heurística `nome.length === 1 && nome >= 'A' &&
 * nome <= 'Z'` para que `T x{};` parseasse. Ela quebra expressesões
 * legítimas: `a * b;`, `x < y > z;`, `i & j;`, `a[i];`.
 *
 * Este arquivo é o TESTE que falha antes da correção (passo 3 do protocolo
 * de bug) e passa depois (passo 5).
 *
 * Regra: um nome é TIPO se, e somente se:
 *   (a) é palavra-chave de tipo built-in (`int`, `char`, `void`…);
 *   (b) é nome de TIPO do prelúdio (`std::vector`, `std::string`…);
 *   (c) foi declarado como tipo VISTO no arquivo — `struct S{}`, `enum E{}`,
 *       `typedef … X`, `using X = …`;
 *   (d) é parâmetro de template registrado ao parsear `template<class T>`;
 *   (e) está em lista de parâmetros (`noTipo`), onde identificador solto é tipo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Lexer } from '../../js/cpp/lexer.js';
import { Parser } from '../../js/cpp/parser.js';
import { unparse, walk } from '../../js/cpp/ast.js';

function compilar(src, arquivo = 't.cpp') {
  // `tokenize()` devolve `{tokens, diagnostics}`; é preciso `.tokens`.
  // Passar o objeto inteiro faz o Parser receber `[]` e devolver AST vazia.
  const lex = new Lexer(src, arquivo).tokenize();
  return new Parser(lex.tokens, { file: arquivo }).parse();
}

/** A entrada tem de ser lida como EXPRESSÃO, não como declaração. */
function comoExpressao(src) {
  const r = compilar(src);
  assert.equal(r.diagnostics.length, 0,
    `esperava 0 diagnósticos em ${JSON.stringify(src)}, veio:\n` +
    r.diagnostics.map((d) => `  ${d.code} @${d.loc.line}:${d.loc.column} ${d.message}`).join('\n'));
  // A expressão é o ÚLTIMO statement da ÚLTIMA função com corpo.
  const comCorpo = r.ast.decls.filter((d) => d.body?.stmts?.length);
  assert.ok(comCorpo.length > 0, `nenhuma função com corpo em ${JSON.stringify(src)}`);
  const corpo = comCorpo[comCorpo.length - 1].body;
  const st = corpo.stmts[corpo.stmts.length - 1];
  assert.equal(st?.kind, 'ExprStmt',
    `esperava ExprStmt em ${JSON.stringify(src)}, veio ${st?.kind}`);
  return st.expr;
}

/** Nenhum nó do tipo pode ter o nome dado (senão virou declaração). */
function semTipo(nodes, ...nomes) {
  for (const n of nodes) {
    walk(n, (x) => {
      if (x.kind === 'VariableDecl' && x.specifiers?.includes(nomes[0])) {
        assert.fail(`\`${nomes[0]}\` foi tratado como TIPO em ${JSON.stringify(nomes[0])}: `
          + `${JSON.stringify(x.specifiers)} — parseou como declaração, não como expressão`);
      }
      return true;
    });
  }
}

// ------------------------------------------------ P6-NEG: expressões que a
// heurística de letra maiúscula quebrava. Cada uma é um `test()` individual.

test('P6-N01: `int a=0,b=0; a * b;` é multiplicação, não declaração', () => {
  const e = comoExpressao('void f() { int a = 0, b = 0; a * b; }');
  assert.equal(e.kind, 'Binary');
  assert.equal(e.op, '*');
});

test('P6-N02: `int f(int); int x=0; f(x);` é chamada, não declaração', () => {
  const e = comoExpressao('int f(int); void g() { int x = 0; f(x); }');
  assert.equal(e.kind, 'Call');
  assert.equal(e.callee?.name, 'f');
});

test('P6-N03: `int x=0,y=0,z=0; x < y > z;` é comparação, não template', () => {
  const e = comoExpressao('void f() { int x = 0, y = 0, z = 0; x < y > z; }');
  assert.equal(e.kind, 'Binary');
  assert.ok(['<', '>'].includes(e.op), `op esperado </>, veio ${e.op}`);
});

test('P6-N04: `int i=0,j=0; i & j;` é AND bit a bit, não referência', () => {
  const e = comoExpressao('void f() { int i = 0, j = 0; i & j; }');
  assert.equal(e.kind, 'Binary');
  assert.equal(e.op, '&');
});

test('P6-N05: `int a[3]; int i=0; a[i];` é indexação, não declaração', () => {
  const e = comoExpressao('void f() { int a[3]; int i = 0; a[i]; }');
  assert.equal(e.kind, 'Index');
});

// ------------------------------------------------ P6-POS: positivos, com o
// tipo DECLARADO. Estes devem continuar parseando com 0 diagnósticos.

test('P6-P01: `struct T{}; T x{};` — T declarado, T é tipo', () => {
  const r = compilar('struct T {}; void f() { T x{}; }');
  assert.equal(r.diagnostics.length, 0, r.diagnostics.map((d) => d.message).join(' | '));
  const decl = r.ast.decls[1].body.stmts[0];
  assert.equal(decl.kind, 'DeclStmt');
  assert.deepEqual(decl.decl.specifiers, ['T']);
});

test('P6-P02: `template<class T> void g(){ T x{}; }` — T é parâmetro de template', () => {
  const r = compilar('template<class T> void g() { T x{}; }');
  assert.equal(r.diagnostics.length, 0, r.diagnostics.map((d) => d.message).join(' | '));
  const decl = r.ast.decls[0].decl.body.stmts[0];
  assert.equal(decl.kind, 'DeclStmt');
  assert.deepEqual(decl.decl.specifiers, ['T']);
});

test('P6-P03: `using U=int; U * p;` — U declarado, U é tipo', () => {
  const r = compilar('using U = int; void f() { U * p; }');
  assert.equal(r.diagnostics.length, 0, r.diagnostics.map((d) => d.message).join(' | '));
  const decl = r.ast.decls[1].body.stmts[0];
  assert.equal(decl.kind, 'DeclStmt');
  assert.deepEqual(decl.decl.specifiers, ['U']);
});

test('P6-P04: `struct T{}; T x = {};` — T declarado, T é tipo', () => {
  const r = compilar('struct T {}; void f() { T x = {}; }');
  assert.equal(r.diagnostics.length, 0, r.diagnostics.map((d) => d.message).join(' | '));
  assert.equal(r.ast.decls[1].body.stmts[0].kind, 'DeclStmt');
});

test('P6-P05: `typedef int I; I v;` — typedef registra nome de tipo', () => {
  const r = compilar('typedef int I; void f() { I v; }');
  assert.equal(r.diagnostics.length, 0, r.diagnostics.map((d) => d.message).join(' | '));
  const decl = r.ast.decls[1].body.stmts[0];
  assert.equal(decl.kind, 'DeclStmt');
  assert.deepEqual(decl.decl.specifiers, ['I']);
});

test('P6-P06: `enum E{A}; E v;` — enum registra nome de tipo', () => {
  const r = compilar('enum E { A }; void f() { E v; }');
  assert.equal(r.diagnostics.length, 0, r.diagnostics.map((d) => d.message).join(' | '));
  const decl = r.ast.decls[1].body.stmts[0];
  assert.equal(decl.kind, 'DeclStmt');
  assert.deepEqual(decl.decl.specifiers, ['E']);
});

// ------------------------------------------------ P6: o escopo tem de
// ser de verdade — um tipo declarado em um escopo NÃO pode vazar.

test('P6-S01: tipo declarado dentro de função não vaza para fora dela', () => {
  const src = 'void f() { struct Local {}; Local x{}; } void g() { Local y; }';
  const r = compilar(src);
  const ultima = r.ast.decls[1].body.stmts[0];
  assert.equal(ultima.kind, 'ExprStmt',
    '`Local` foi reconhecido como tipo FORA do escopo onde foi declarado');
});

test('P6-S02: template com parâmetro de tipo não registra fora da sua lista', () => {
  const src = 'template<class T> void f() { T x{}; } void g() { T y; }';
  const r = compilar(src);
  const ultima = r.ast.decls[1].body.stmts[0];
  assert.equal(ultima.kind, 'ExprStmt',
    '`T` foi reconhecido como tipo FORA do template onde foi declarado');
});

// ------------------------------------------------ P6: o escopo é real,
// então testes que usavam `T` sem declarar precisam ser corrigidos.

test('P6-N06: `T x{};` SEM declarar T não é declaração válida', () => {
  // Não há `struct T` nem `template<class T>`: `T` é um identificador comum
  // e `T x{}` não é C++ válido. O parser deve dizer que não, e NÃO aceitar
  // silenciosamente por causa da letra maiúscula.
  const r = compilar('void f() { T x{}; }');
  assert.ok(r.diagnostics.length > 0,
    'aceitou `T x{};` sem declarar T — a heurística de letra maiúscula voltou');
});

// ------------------------------------------------ round-trip dos positivos

for (const [id, src] of [
  ['P6-P01', 'struct T {}; void f() { T x{}; }'],
  ['P6-P02', 'template<class T> void g() { T x{}; }'],
  ['P6-P03', 'using U = int; void f() { U * p; }'],
]) {
  test(`${id} faz round-trip: ${JSON.stringify(src)}`, () => {
    const r1 = compilar(src);
    assert.equal(r1.diagnostics.length, 0);
    const texto = unparse(r1.ast);
    const r2 = compilar(texto);
    assert.equal(r2.diagnostics.length, 0,
      `unparse -> ${JSON.stringify(texto)}\n` +
      r2.diagnostics.map((d) => `${d.code} ${d.message}`).join('\n'));
  });
}