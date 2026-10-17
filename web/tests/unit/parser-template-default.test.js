/**
 * tests/unit/parser-template-default.test.js — A2-BUG-1: `template<...>` com
 * argumento default.
 *
 * O ORÁCULO é o `g++`, colado em `reports/A2/p02-gpp-oraculo.log` — 17 casos,
 * classificados sintático vs semântico. O que importa aqui é o veredito
 * SINTÁTICO: `‘U’ does not name a type` / `no default argument for ‘U’` são
 * Sema (E02xx) e NÃO competem a este arquivo.
 *
 * O bug tem DUAS causas independentes, ambas medidas antes do conserto:
 *
 *   1. `constante()` só aceita expressão constante, então o default de um
 *      PARÂMETRO DE TIPO (`= int`, `= std::vector<int>`) era rejeitado.
 *   2. `constante()` parseia expressão binária, então comia o `>` de
 *      fechamento como operador MAIOR — `template<int N = 3>` virava
 *      `3 > struct`. Prova: `int N = 3;` fora de template dá 0 erros, dentro
 *      dá 2.
 *
 * E o conserto PREENCHE `Declarator.default`. Descartar o default seria
 * aceitação silenciosa com árvore incompleta — o vício do S7(d), onde
 * `enum E` virou `EnumDecl` com `enumerators: []`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Lexer } from '../../js/cpp/lexer.js';
import { Parser } from '../../js/cpp/parser.js';
import { Preprocessor } from '../../js/cpp/preprocessor.js';
import { unparse } from '../../js/cpp/ast.js';

/** Com `#include`, o texto tem de passar pelo Preprocessor antes do Lexer. */
function compila(src) {
  const pp = new Preprocessor({}).process(src, 't.cpp');
  return new Parser(new Lexer(pp.text, 't.cpp').tokenize().tokens, { file: 't.cpp' }).parse();
}

function erros(src) {
  return compila(src).diagnostics.filter((d) => d.severity === 'error');
}

function ast(src) {
  return compila(src).ast;
}

function tmplDecl(src) {
  const decls = ast(src).decls;
  const t = decls.find((d) => d.kind === 'TemplateDecl');
  assert.ok(t, `esperava TemplateDecl, veio ${decls.map((d) => d.kind).join(', ')}`);
  return t;
}

/** `= <x>` tem de estar no default do Declarator — não pode ser descartado. */
function defaultDo(t, nomeParam) {
  const p = t.params.find((x) => x.name === nomeParam);
  assert.ok(p, `esperava o parametro \`${nomeParam}\`, veio ${t.params.map((x) => x.name).join(', ')}`);
  return p.default;
}

// =========================================================== o g++ ACEITA (8)
// reports/A2/p02-gpp-oraculo.log §3.1

const ACEITAM = [
  ['B', 'A2B', 'template<class T = int> struct S { T x; };'],
  ['C', 'A2C', 'template<class T, class U = T> struct S { U x; };'],
  ['E', 'A2E', 'template<int N = 3> struct S { int a[N]; };'],
  ['G', 'A2G', 'template<class T = int, class U = char> struct S {};'],
  ['M', 'A2M', 'template<class = int> struct S {};'],
  ['P', 'A2P', 'template<class T, int N = 3> struct S {};'],
  ['Q', 'A2Q', 'template<typename T = int> struct S { T x; };'],
];

for (const [id, nome, src] of ACEITAM) {
  test(`A2-BUG-1-${nome}: g++ aceita — ${src}`, () => {
    const e = erros(src);
    assert.equal(e.length, 0,
      `g++ aceita (caso ${id}); nosso deu ${e.map((d) => `${d.code}@${d.loc.line}:${d.loc.column} ${d.message}`).join('; ')}`);
  });
}

test('A2-BUG-1-O: g++ aceita — typename com default std::vector<int> (com <vector>)', () => {
  const src = '#include <vector>\ntemplate<typename T = std::vector<int>> struct S {};';
  const e = erros(src);
  assert.equal(e.length, 0,
    `g++ aceita (caso O); nosso deu ${e.map((d) => `${d.code}@${d.loc.line}:${d.loc.column} ${d.message}`).join('; ')}`);
});

// ================================================ o g++ REJEITA: sem decl (5)
// reports/A2/p02-gpp-oraculo.log §3.2 — "expected unqualified-id before ';'".
// L é o CONTROLE: rejeita igual sem ter default nenhum, o que prova que a
// causa é a ausência da declaração, não o default.

const SEM_DECLARACAO = [
  ['L', 'A2L', 'template<class T>;'],
  ['A', 'A2A', 'template<class T = int>;'],
  ['D', 'A2D', 'template<int N = 3>;'],
  ['F', 'A2F', 'template<class = int>;'],
  ['N', 'A2N', 'template<class T, class U>;'],
];

for (const [id, nome, src] of SEM_DECLARACAO) {
  test(`A2-BUG-1-${nome}: g++ rejeita (falta a declaração, caso ${id}) — e rejeitamos também`, () => {
    assert.ok(erros(src).length >= 1,
      'g++ rejeita com "expected unqualified-id before \';\'"; aceitar aqui seria um falso-verde');
  });
}

// ============================================ o g++ REJEITA: default ausente (2)
// reports/A2/p02-gpp-oraculo.log §3.3 — "expected type-specifier before '>'".
// Estes são SINTÁTICOS, e é aqui que o default tem de ser lido.

test('A2-BUG-1-I: template<class T = >; — default ausente continua INVÁLIDO', () => {
  assert.ok(erros('template<class T = >;').length >= 1,
    'g++ rejeita com "expected type-specifier before \'>\'"');
});

test('A2-BUG-1-J: template<class = >; — parametro e default vazios continuam INVÁLIDOS', () => {
  assert.ok(erros('template<class = >;').length >= 1,
    'g++ rejeita com "expected type-specifier before \'>\'"');
});

// ======================================================= default PRESENTE na AST
// Isto é o que impede o vício do S7(d): o default tem de estar NA ÁRVORE.

test('A2-BUG-1-P1: o default de tipo fica em params[i].default (não é descartado)', () => {
  const t = tmplDecl('template<class T = int> struct S { T x; };');
  const d = defaultDo(t, 'T');
  assert.notEqual(d, null, 'o default NÃO pode ser null: seria árvore incompleta em silêncio');
  // `int` é um TypeId — a mesma forma que `std::vector<int>` usa no catálogo.
  assert.equal(d.kind, 'TypeId', `esperava TypeId, veio ${JSON.stringify(d)?.slice(0, 120)}`);
  assert.equal(d.isType, true, 'o default de um parâmetro de TIPO tem de ser TypeId com isType');
});

test('A2-BUG-1-P2: o default de parâmetro NÃO-tipo fica em params[i].default', () => {
  const t = tmplDecl('template<int N = 3> struct S { int a[N]; };');
  const d = defaultDo(t, 'N');
  assert.notEqual(d, null, 'o default de N = 3 NÃO pode ser null');
  assert.equal(d.kind, 'Literal', `esperava Literal, veio ${JSON.stringify(d)?.slice(0, 120)}`);
  assert.equal(d.value, 3, `esperava 3, veio ${JSON.stringify(d.value)}`);
});

test('A2-BUG-1-P3: o `>` de fechamento NÃO é comido como operador maior', () => {
  // A causa 2. `template<int N = 3>` produzia `3 > struct` e 2 diagnósticos.
  // Com o conserto, o default é LITERAL e não BINÁRIO.
  const t = tmplDecl('template<int N = 3> struct S { int a[N]; };');
  assert.equal(defaultDo(t, 'N').kind, 'Literal',
    'se o default vier Binary, o `>` de fechamento foi comido como operador');
});

test('A2-BUG-1-P4: default que referencia parametro anterior', () => {
  const t = tmplDecl('template<class T, class U = T> struct S { U x; };');
  const d = defaultDo(t, 'U');
  assert.notEqual(d, null, '`class U = T` tem de guardar o default');
  // `T` sozinho é um IDENTIFIER que nomeia um tipo, não um `TypeId` com
  // `specifierText` — `int` é que vira TypeId. Os dois são defaults válidos;
  // o que importa é que o NÓMULO esteja lá, não descartado.
  assert.ok(d.kind === 'Identifier' || d.kind === 'TypeId',
    `esperava Identifier ou TypeId, veio ${JSON.stringify(d)?.slice(0, 100)}`);
  assert.equal(d.name ?? d.expr?.name, 'T', 'o default tem de ser `T`');
});

test('A2-BUG-1-P5: dois defaults no mesmo template', () => {
  const t = tmplDecl('template<class T = int, class U = char> struct S {};');
  assert.equal(t.params.length, 2, `esperava 2 params, veio ${t.params.length}`);
  assert.equal(defaultDo(t, 'T').kind, 'TypeId');
  assert.equal(defaultDo(t, 'U').kind, 'TypeId');
});

test('A2-BUG-1-P6: parametro de tipo SEM nome com default (caso M)', () => {
  // `template<class = int>` é VÁLIDO em C++ quando há declaração. O nome é
  // null e mesmo assim o default tem de estar na árvore.
  const t = tmplDecl('template<class = int> struct S {};');
  assert.equal(t.params.length, 1);
  const d = t.params[0].default;
  assert.notEqual(d, null, '`class = int` tem default mesmo sem nome');
  assert.equal(d.kind, 'TypeId');
});

test('A2-BUG-1-P7: parametro SEM default tem default === null (campo existe sempre)', () => {
  // O campo é inicializado a null no construtor: `default` existe em TODO
  // Declarator, para o schema ser uniforme.
  const t = tmplDecl('template<class T> struct S { T x; };');
  const p = t.params[0];
  assert.ok('default' in p, 'o campo `default` tem de existir mesmo sem valor');
  assert.equal(p.default, null, 'sem default, o campo vale null (não `undefined`)');
});

// ============================================================== round-trip
// docs/ast.md §1.4: `parse → unparse → parse` devolve a mesma árvore.

test('A2-BUG-1-R1: round-trip preserva o default de tipo', () => {
  const src = 'template<class T = int> struct S { T x; };';
  const a1 = ast(src);
  const texto = unparse(a1);
  assert.match(texto, /template<[^>]*=\s*int/, `o default sumiu no unparse: ${texto}`);
  const a2 = tmplDecl(texto);
  assert.equal(defaultDo(a2, 'T')?.kind, 'TypeId',
    `o default não sobreviveu ao round-trip. unparse produziu: ${texto}`);
});

test('A2-BUG-1-R2: round-trip preserva o default de parâmetro não-tipo', () => {
  const src = 'template<int N = 3> struct S { int a[N]; };';
  const texto = unparse(ast(src));
  assert.match(texto, /=\s*3/, `o default sumiu no unparse: ${texto}`);
  assert.equal(erros(texto).length, 0, `o unparse produziu C++ inválido: ${texto}`);
});

test('A2-BUG-1-R3: round-trip de template SEM default não muda nada', () => {
  const src = 'template<class T> struct S { T x; };';
  const texto = unparse(ast(src));
  assert.equal(erros(texto).length, 0, `o unparse produziu C++ inválido: ${texto}`);
});

// ================================================ semântico, fora do escopo

test('A2-BUG-1-S1: `= int` antes de parametro sem default é SEMÂNTICO, não sintático', () => {
  // Caso K: `template<class T = int, class U> struct S {};`
  // g++: `no default argument for 'U'` na COLUNA 41 — aponta para o `U`, não
  // para o `= int`. É Sema (E02xx). O parser NÃO tem Sema, logo NÃO pode
  // acusar. Este teste registra o limite em vez de mascará-lo.
  const src = 'template<class T = int, class U> struct S {};';
  const e = erros(src);
  console.log(`      caso K -> ${e.length} diag sintático(s); g++ acusa no \`U\` (col 41, semântico)`);
  assert.ok(true, 'limitação registrada; o default dos dois lados tem de estar na árvore');
  // O que o parser TEM de garantir, mesmo sem Sema: nada se perde.
  const t = tmplDecl(src);
  assert.equal(t.params.length, 2);
  assert.notEqual(defaultDo(t, 'T'), null, 'o `= int` tem de estar na árvore mesmo neste caso');
  assert.equal(defaultDo(t, 'U'), null, '`U` não tem default — e o campo diz isso');
});
