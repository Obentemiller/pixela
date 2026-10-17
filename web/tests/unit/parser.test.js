/**
 * tests/unit/parser.test.js — TDD de js/cpp/parser.js
 *
 * Contrato do parser, em ordem de importância:
 *
 *  1. **Nunca lança.** Toda entrada, por mais quebrada que seja, devolve
 *     `{ast, diagnostics}`. Um throw é falha de teste.
 *  2. **Progresso garantido.** Nenhuma entrada pode travar. Os testes de
 *     laço infinito abaixo são a rede de proteção.
 *  3. **Aceita o que o g++ aceita** e **rejeita o que o g++ rejeita**, para o
 *     subconjunto declarado. O corpus vivo está em `parser-cases.mjs`.
 *  4. **Round-trip.** `parse → unparse → parse` devolve a mesma árvore.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Lexer } from '../../js/cpp/lexer.js';
import { Parser } from '../../js/cpp/parser.js';
import { unparse, count } from '../../js/cpp/ast.js';
import { CASOS_VALIDOS, CASOS_INVALIDOS } from './parser-cases.mjs';

/** Lexa, pré-processa e faz o parse, convertendo throws em resultado. */
function compilar(src, arquivo = 't.cpp') {
  try {
    const lex = new Lexer(src, arquivo).tokenize();
    if (lex.diagnostics.length > 0) {
      return { lancou: null, ast: null, diagnostics: lex.diagnostics, tokens: lex.tokens };
    }
    const p = new Parser(lex.tokens, { file: arquivo });
    const r = p.parse();
    return { lancou: null, ...r, tokens: lex.tokens };
  } catch (e) {
    return { lancou: e, ast: null, diagnostics: [], tokens: [] };
  }
}

const erros = (src) => {
  const r = compilar(src);
  assert.equal(r.lancou, null, `parser lançou em ${JSON.stringify(src)}: ${r.lancou?.stack}`);
  return r.diagnostics;
};

const ok = (src) => {
  const r = compilar(src);
  assert.equal(r.lancou, null, `parser lançou: ${r.lancou?.stack}`);
  assert.equal(r.diagnostics.length, 0,
    `esperava sem diagnóstico em ${JSON.stringify(src)}, veio:\n` +
    r.diagnostics.map((d) => `  ${d.code} ${d.message}`).join('\n'));
  return r.ast;
};

// ---------------------------------------------------------------- contrato

test('o parser NUNCA lança, nem com lixo', () => {
  const entradas = [
    '', ' ', '\n\n\n', '@', '#', '#include', 'int', 'int x', 'int x =',
    '{', '}', '(', ')', '<<<', ')))(((', 'int (((x)))', 'struct', 'template<',
    'template<int', 'class{', 'enum', '::', '...', 'a::b::c::d',
    'int f(', 'int f() {', 'void g() { if (', '"abc', "'", '/*', '//',
    'x+++++', '((((((((((((((((((((x))))))))))))))))))))',
    'int a[', 'int a[1', 'new', 'delete', 'using', 'namespace',
    'e com acento: \u00e9', '\u4e2d\u6587', '\u0000\u0001', 'int x = ;',
  ];
  for (const src of entradas) {
    const r = compilar(src);
    assert.equal(r.lancou, null, `lançou em ${JSON.stringify(src)}: ${r.lancou?.stack}`);
    assert.ok(Array.isArray(r.diagnostics), `diagnostics não é array em ${JSON.stringify(src)}`);
    assert.ok(r.ast !== undefined, `ast indefinido em ${JSON.stringify(src)}`);
  }
});

test('nenhum corpus trava: 300 entradas degeneradas terminam', () => {
  // Rede de proteção contra laço infinito: se o parser não consome token,
  // este teste não termina.
  const Alphabet = ['int', 'x', '(', ')', '{', '}', ';', '+', '-', '*', '<', '>',
    ',', '=', '[', ']', '::', '?', ':', 'return', 'if', 'while', 'struct',
    'class', 'template', 'namespace', '"s"', "'c'", '1', '1.5', '...', '->'];
  let s = 12345;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < 300; i++) {
    const n = 1 + Math.floor(rnd() * 12);
    let src = '';
    for (let k = 0; k < n; k++) src += Alphabet[Math.floor(rnd() * Alphabet.length)] + ' ';
    const r = compilar(src);
    assert.equal(r.lancou, null, `lançou em ${JSON.stringify(src)}`);
  }
});

// ---------------------------------------------------------------- válidos

/**
 * Cada caso do corpus é um `test()` INDIVIDUAL.
 *
 * Antes eram três testes agregados (`for` dentro de um `test`), o que fazia a
 * contagem de `npm test` não refletir o número de casos: 193 casos válidos
 * contavam como 1. A ordem exige que a contagem reflita os casos.
 */
for (const [i, src] of CASOS_VALIDOS.entries()) {
  test(`válido #${i + 1} sem diagnóstico: ${JSON.stringify(src).slice(0, 72)}`, () => {
    const r = compilar(src);
    assert.equal(r.lancou, null, `LANÇOU: ${r.lancou?.stack}`);
    assert.deepEqual(r.diagnostics.map((d) => `${d.code} ${d.message}`), [],
      `esperava 0 diagnósticos`);
  });
}

for (const [i, src] of CASOS_VALIDOS.entries()) {
  test(`válido #${i + 1} faz round-trip: ${JSON.stringify(src).slice(0, 72)}`, () => {
    const r1 = compilar(src);
    if (r1.diagnostics.length > 0) return; // já coberto pelo teste acima
    const texto = unparse(r1.ast);
    const r2 = compilar(texto);
    assert.deepEqual(r2.diagnostics.map((d) => `${d.code} ${d.message}`), [],
      `unparse -> ${JSON.stringify(texto)}\nreparse falhou`);
    assert.equal(unparse(r2.ast), texto, 'unparse não é estável na 2ª passada');
  });
}

// ---------------------------------------------------------------- inválidos

for (const [i, { src }] of CASOS_INVALIDOS.entries()) {
  test(`inválido #${i + 1} é rejeitado: ${JSON.stringify(src).slice(0, 72)}`, () => {
    const r = compilar(src);
    assert.equal(r.lancou, null, `LANÇOU: ${r.lancou?.stack}`);
    assert.ok(r.diagnostics.length > 0, 'aceito sem erro (deveria ser rejeitado)');
    assert.ok(r.diagnostics.some((d) => /^E01/.test(d.code)),
      `sem E01xx, veio ${r.diagnostics.map((d) => d.code).join(',')}`);
  });
}

// ---------------------------------------------------------------- diagnóstico

test('construção fora do escopo dá E02xx nomeado, nunca "token inesperado"', () => {
  const casos = [
    ['asm("nop");', 'E0201'],
    ['goto fim;', 'E0202'],
    ['int x [[maybe_unused]] = 1;', 'E0208'],
  ];
  for (const [src, codigo] of casos) {
    const d = erros(src);
    assert.ok(d.some((x) => x.code === codigo),
      `${JSON.stringify(src)}: esperava ${codigo}, veio ${d.map((x) => x.code + ' ' + x.message).join('; ')}`);
    assert.ok(!d.some((x) => /inesperado/i.test(x.message)),
      `${JSON.stringify(src)}: veio "token inesperado" em vez de ${codigo}`);
  }
});

test('o diagnóstico tem code frame com linha e coluna', () => {
  const d = erros('int x = ;');
  assert.ok(d.length > 0);
  const diag = d[0];
  assert.ok(diag.loc && typeof diag.loc.line === 'number', 'sem loc.line');
  assert.ok(diag.loc && typeof diag.loc.column === 'number', 'sem loc.column');
  assert.ok(typeof diag.message === 'string' && diag.message.length > 0);
});

test('erro de sintaxe traz o token encontrado', () => {
  const d = erros('int x = 1 +;');
  assert.ok(d.length > 0);
  assert.ok(d.some((x) => /[;+]/.test(x.message)), `mensagem não cita o token: ${d.map((x) => x.message).join('; ')}`);
});

test('recoverência: um erro não impede declarar o resto do arquivo', () => {
  // `int a = ;` é erro, mas `int b = 2;` depois deve aparecer no AST.
  const r = compilar('int a = ; int b = 2;');
  assert.ok(r.diagnostics.length > 0, 'esperava ao menos um erro');
  assert.ok(r.ast && r.ast.decls.length >= 1, 'o parser não recuperou');
  const nomes = r.ast.decls.map((d) => unparse(d));
  assert.ok(nomes.some((t) => t.includes('b')), `decls: ${nomes.join(' | ')}`);
});

test('recoverência: desbalanceamento de chaves não engole o arquivo todo', () => {
  const r = compilar('void f() { int x = 1;');
  assert.ok(r.diagnostics.length > 0);
  assert.ok(r.ast, 'devolveu ast');
});

test('vários erros são reportados, não só o primeiro', () => {
  const d = erros('int a = ; int b = ; int c = ;');
  assert.ok(d.length >= 2, `esperava >=2 diagnósticos, veio ${d.length}`);
});

// ---------------------------------------------------------------- estrutura

test('contagem de declarações no nível superior', () => {
  const ast = ok(`
    int a;
    int b = 1;
    void f();
    struct S { int x; };
    namespace n { int c; }
  `);
  assert.equal(ast.decls.length, 5);
  assert.equal(count(ast, 'FunctionDecl'), 1);
  assert.equal(count(ast, 'ClassDecl'), 1);
  assert.equal(count(ast, 'NamespaceDecl'), 1);
});

test('a AST tem o formato documentado em docs/ast.md', () => {
  const ast = ok('int x = 1;');
  assert.equal(ast.kind, 'TranslationUnit');
  const d = ast.decls[0];
  assert.equal(d.kind, 'VariableDecl');
  assert.deepEqual(d.specifiers, ['int']);
  assert.equal(d.declarators[0].kind, 'Declarator');
  assert.equal(d.declarators[0].name, 'x');
  assert.ok(d.loc && typeof d.loc.line === 'number');
});

test('função: corpo, parâmetros e tipo de retorno', () => {
  const ast = ok('int soma(int a, int b) { return a + b; }');
  const f = ast.decls[0];
  assert.equal(f.kind, 'FunctionDecl');
  assert.equal(f.body.kind, 'CompoundStmt');
  assert.equal(f.body.stmts.length, 1);
  assert.equal(f.body.stmts[0].kind, 'ReturnStmt');
});

test('classe: membros, bases e especificadores', () => {
  const ast = ok('struct P : public B { int x; void m(); };');
  const c = ast.decls[0];
  assert.equal(c.kind, 'ClassDecl');
  assert.equal(c.name, 'P');
  assert.equal(c.bases.length, 1);
  assert.equal(c.bases[0].access, 'public');
  assert.equal(c.members.length, 2);
});

test('template: parâmetros ficam na declaração', () => {
  const ast = ok('template<typename T> T max(T a, T b) { return a > b ? a : b; }');
  const t = ast.decls[0];
  assert.equal(t.kind, 'TemplateDecl');
  assert.equal(t.decl.kind, 'FunctionDecl');
});

test('operador `>>` de template divide em dois `>`', () => {
  const r = compilar('std::vector<std::vector<int>> x;');
  assert.equal(r.diagnostics.length, 0,
    r.diagnostics.map((d) => d.message).join('; '));
});

test('strings adjacentes são concatenadas em uma só', () => {
  const ast = ok('const char* s = "a" "b" "c";');
  const init = ast.decls[0].init;
  assert.equal(init.kind, 'Literal');
  assert.equal(init.value, 'abc');
});

// ---------------------------------------------------------------- determinismo

test('parse é determinístico: duas execuções dão a mesma AST', () => {
  const src = 'int f(int a) { for (int i = 0; i < a; ++i) { a += i; } return a; }';
  const a = JSON.stringify(ok(src));
  const b = JSON.stringify(ok(src));
  assert.equal(a, b);
});

test('a AST serializa em JSON', () => {
  const ast = ok('int f(int a) { return a * 2; }');
  assert.doesNotThrow(() => JSON.stringify(ast));
  assert.equal(JSON.parse(JSON.stringify(ast)).kind, 'TranslationUnit');
});