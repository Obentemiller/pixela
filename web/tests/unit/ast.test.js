/**
 * tests/unit/ast.test.js — TDD de js/cpp/ast.js
 *
 * O AST é a fronteira entre o parser e tudo que vem depois (sema, codegen,
 * os diferenciais com g++ e clang). Duas propriedades importam mais do que
 * o formato:
 *
 *   1. `unparse` + `parse` é identidade — o round-trip precisa devolver
 *      exatamente a mesma árvore. Sem isso nenhum golden pode ser lido por
 *      outra ferramenta.
 *   2. Nenhuma construção lança. Construtor e unparse devolvem sempre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TranslationUnit, Declarator, PtrOperator, VariableDecl, FunctionDecl,
  ClassDecl, EnumDecl, NamespaceDecl, UsingDecl, TypedefDecl, TemplateDecl,
  StaticAssertDecl, EmptyDecl,
  Identifier, Literal, Unary, Binary, Ternary, Call, Index, Member, Assign,
  Cast, New, Delete, Lambda, InitList, Paren, This, TypeId, CompoundLiteral,
  CompoundStmt, ExprStmt, DeclStmt, IfStmt, WhileStmt, DoStmt, ForStmt,
  RangeForStmt, SwitchStmt, CaseStmt, DefaultStmt, BreakStmt, ContinueStmt,
  ReturnStmt, GotoStmt, LabeledStmt, TryStmt, ThrowExpr,
  BaseSpecifier, Enumerator,
  isDeclaration, isStatement, isExpression,
  unparse, walk, find, count,
} from '../../js/cpp/ast.js';

// ----------------------------------------------------------------分类

test('as famílias de nós se reconhecem', () => {
  assert.ok(isExpression(new Identifier('x')));
  assert.ok(isExpression(new Literal(1)));
  assert.ok(isExpression(new This()));
  assert.ok(!isExpression(new VariableDecl([], [])));
  assert.ok(isExpression(new This()));
  assert.ok(!isExpression(new CompoundStmt([])));

  assert.ok(isStatement(new ExprStmt(new Literal(1))));
  assert.ok(isStatement(new ReturnStmt(new Literal(1))));
  assert.ok(!isStatement(new Identifier('x')));

  assert.ok(isDeclaration(new VariableDecl([], [])));
  assert.ok(isDeclaration(new EmptyDecl()));
  assert.ok(!isDeclaration(new ExprStmt(new Literal(1))));
});

test('todo nó tem kind e loc', () => {
  const n = new Identifier('x');
  assert.equal(n.kind, 'Identifier');
  assert.ok(n.loc && typeof n.loc === 'object');
});

// ---------------------------------------------------------------- unparse

test('unparse de expressões basic', () => {
  const casos = [
    [new Identifier('x'), 'x'],
    [new Literal(42), '42'],
    [new Literal('oi', 'string'), '"oi"'],
    [new Literal(true), 'true'],
    [new Paren(new Literal(1)), '(1)'],
    [new Binary('+', new Literal(1), new Literal(2)), '1 + 2'],
    [new Binary('&&', new Literal(1), new Literal(2)), '1 && 2'],
    [new Unary('-', new Literal(1)), '-1'],
    [new Unary('!', new Identifier('p'), true), '!p'],
    [new Unary('++', new Identifier('i'), true), '++i'],
    [new Ternary(new Identifier('c'), new Literal(1), new Literal(2)), 'c ? 1 : 2'],
    [new Call(new Identifier('f'), [new Literal(1), new Literal(2)]), 'f(1, 2)'],
    [new Call(new Identifier('f'), []), 'f()'],
    [new Index(new Identifier('v'), new Literal(0)), 'v[0]'],
    [new Member(new Identifier('p'), 'x'), 'p.x'],
    [new Member(new Identifier('p'), 'x', true), 'p->x'],
    [new Assign(new Identifier('a'), new Literal(1)), 'a = 1'],
    [new Assign(new Identifier('a'), new Literal(1), '+='), 'a += 1'],
    [new This(), 'this'],
    [new TypeId(new Literal(1)), 'typeid(1)'],
  ];
  for (const [no, esperado] of casos) {
    assert.equal(unparse(no), esperado, `para ${no.kind}`);
  }
});

test('unparse respeita a precedência: o que está entre parênteses só quando precisa', () => {
  // 1 + 2 * 3 não precisa de parênteses no meio
  const a = new Binary('+', new Literal(1), new Binary('*', new Literal(2), new Literal(3)));
  assert.equal(unparse(a), '1 + 2 * 3');

  // (1 + 2) * 3 precisa
  const b = new Binary('*', new Binary('+', new Literal(1), new Literal(2)), new Literal(3));
  assert.equal(unparse(b), '(1 + 2) * 3');

  // a - (b - c) precisa, a - b - c não
  assert.equal(unparse(new Binary('-', new Identifier('a'), new Binary('-', new Identifier('b'), new Identifier('c')))),
    'a - (b - c)');
  assert.equal(unparse(new Binary('-', new Identifier('a'), new Identifier('b'))), 'a - b');
});

test('unparse de chamada, membro e index preserva a ordem', () => {
  const e = new Call(new Member(new Identifier('obj'), 'f', true), [new Literal(1)]);
  assert.equal(unparse(e), 'obj->f(1)');
});

test('unparse de declarador: ponteiro, array e função', () => {
  const d1 = new Declarator('x');
  assert.equal(unparse(d1), 'x');

  const d2 = new Declarator('x', { ptr: [new PtrOperator()], array: [new Literal(3)] });
  assert.equal(unparse(d2), '* x[3]');
  assert.equal(unparse(new Declarator('x', { array: [new Literal(3)] })), 'x[3]');

  const d3 = new Declarator('x', { ptr: [new PtrOperator(), new PtrOperator()] });
  assert.equal(unparse(d3), '* * x');

  const d4 = new Declarator('x', { ptr: [new PtrOperator()] });
  assert.equal(unparse(d4), '* x');

  const d5 = new Declarator('f', { params: [] });
  assert.equal(unparse(d5), 'f()');

  const d6 = new Declarator('f', { params: [new VariableDecl(['int'], [new Declarator('a', { ptr: [new PtrOperator()] })])], cvConst: true });
  assert.equal(unparse(d6), 'f(int* a) const');

  // declarador abstrato (sem nome) — usado em cast e em template
  const d7 = new Declarator(null, { ptr: [new PtrOperator()], array: [new Literal(4)] });
  assert.equal(unparse(d7), '* [4]');
});

test('unparse de declarador de função que retorna ponteiro', () => {
  // int (*f)(int)
  const inner = new Declarator('f', { ptr: [new PtrOperator()] });
  const outer = new Declarator(null, { params: [new VariableDecl(['int'], [new Declarator('a')])] });
  outer.inner = inner;
  assert.equal(unparse(outer), '(* f)(int a)');
});

test('unparse de statements', () => {
  assert.equal(unparse(new ExprStmt(new Literal(1))), '1;');
  assert.equal(unparse(new CompoundStmt([])), '{}');
  assert.equal(unparse(new CompoundStmt([new ExprStmt(new Literal(1))])), '{1;}');
  assert.equal(unparse(new IfStmt(new Identifier('c'), new CompoundStmt([new ExprStmt(new Literal(1))]))),
    'if (c) {1;}');
  assert.equal(unparse(new IfStmt(new Identifier('c'), new CompoundStmt([new ExprStmt(new Literal(1))]), new CompoundStmt([new ExprStmt(new Literal(2))]))),
    'if (c) {1;} else {2;}');
  assert.equal(unparse(new WhileStmt(new Identifier('c'), new CompoundStmt([new ExprStmt(new Literal(1))]))),
    'while (c) {1;}');
  assert.equal(unparse(new DoStmt(new CompoundStmt([new ExprStmt(new Literal(1))]), new Identifier('c'))),
    'do {1;} while (c);');
  assert.equal(unparse(new ForStmt(new DeclStmt(new VariableDecl(['int'], [new Declarator('i')])), new Binary('<', new Identifier('i'), new Literal(10)), new Unary('++', new Identifier('i'), true), new CompoundStmt([new ExprStmt(new Literal(1))]))),
    'for (int i; i < 10; ++i) {1;}');
  assert.equal(unparse(new ReturnStmt(new Literal(0))), 'return 0;');
  assert.equal(unparse(new ReturnStmt()), 'return;');
  assert.equal(unparse(new BreakStmt()), 'break;');
  assert.equal(unparse(new ContinueStmt()), 'continue;');
  assert.equal(unparse(new SwitchStmt(new Identifier('x'), [new CaseStmt(new Literal(1), new CompoundStmt([new ExprStmt(new Literal(2))]))])),
    'switch (x) {case 1: {2;}}');
  assert.equal(unparse(new LabeledStmt('lbl', new CompoundStmt([new ExprStmt(new Literal(1))]))), 'lbl: {1;}');
});

test('unparse de declarações', () => {
  assert.equal(unparse(new VariableDecl([], [new Declarator('x')])), 'x;');
  assert.equal(unparse(new VariableDecl(['int'], [new Declarator('x')], new Literal(1))), 'int x = 1;');
  assert.equal(unparse(new VariableDecl(['const', 'int'], [new Declarator('x')])), 'const int x;');
  assert.equal(unparse(new EmptyDecl()), ';');
  assert.equal(unparse(new NamespaceDecl('ns', [new VariableDecl(['int'], [new Declarator('a')])])),
    'namespace ns {int a;}');
  assert.equal(unparse(new UsingDecl('vector', 'std::vector')), 'using std::vector;');
  assert.equal(unparse(new UsingDecl('Int', null, new TypeId(new Identifier('int'), true))), 'using Int = int;');
  assert.equal(unparse(new EnumDecl(['enum', 'class'], 'Cor', [
    new Enumerator('vermelho', new Literal(0)),
    new Enumerator('verde'),
  ])), 'enum class Cor {vermelho = 0, verde};');
  assert.equal(unparse(new StaticAssertDecl(new Literal(1))), 'static_assert(1);');
});

test('unparse de classe com bases e membros', () => {
  const c = new ClassDecl(['class'], 'Ponto', [
    new VariableDecl(['int'], [new Declarator('x')]),
  ], { bases: [new BaseSpecifier('Base', 'public')] });
  // Espaco entre membros: sem ele, `size() const` + `const char* c_str() const`
  // se juntam e o `const` do metodo qualifica a funcao seguinte (round-trip).
  assert.equal(unparse(c), 'class Ponto : public Base {int x; }');
});

test('unparse de template', () => {
  const t = new TemplateDecl([new Declarator('T')], new ClassDecl(['class'], 'V', []));
  assert.equal(unparse(t), 'template<typename T> class V {}');
});

test('unparse de lambda', () => {
  const l = new Lambda([], [], new CompoundStmt([new ReturnStmt(new Literal(1))]), []);
  assert.equal(unparse(l), '[]() {return 1;}');
  const l2 = new Lambda([{ kind: 'porValor', name: 'x' }], [new VariableDecl(['int'], [new Declarator('x')])],
    new CompoundStmt([new ReturnStmt(new Identifier('x'))]), ['mutable']);
  assert.equal(unparse(l2), '[x](int x) mutable {return x;}');
});

test('unparse de new/delete/cast/init-list', () => {
  assert.equal(unparse(new New(new TypeId(new Identifier('int')), [new Literal(7)], false)), 'new int(7)');
  assert.equal(unparse(new New(new TypeId(new Identifier('int')), [new Literal(7)], true)), 'new int[7]');
  assert.equal(unparse(new Delete(new Cast(new TypeId(new Identifier('int'), true), new Identifier('p')))), 'delete (int)p');
  assert.equal(unparse(new Delete(new Cast(new TypeId(new Identifier('int'), true), new Identifier('p')), true)), 'delete[] (int)p');
  assert.equal(unparse(new Cast(new TypeId(new Identifier('int')), new Identifier('x'))), '(int)x');
  assert.equal(unparse(new Cast(new TypeId(new Identifier('int'), true), new Identifier('x'), 'static_cast')), 'static_cast<int>(x)');
  assert.equal(unparse(new Cast(new TypeId(new Identifier('int'), true), new Identifier('x'), 'reinterpret_cast')), 'reinterpret_cast<int>(x)');
  assert.equal(unparse(new InitList([new Literal(1), new Literal(2)])), '{1, 2}');
  assert.equal(unparse(new InitList([])), '{}');
});

// ---------------------------------------------------------------- walk

test('walk visita todos os nós', () => {
  const arvore = new TranslationUnit([
    new VariableDecl(['int'], [new Declarator('x', {
      ptr: [new PtrOperator()],
      array: [new Literal(4)],
    })], new Literal(1)),
  ]);
  let n = 0;
  walk(arvore, () => { n++; });
  assert.ok(n >= 6, `esperava >=6 nós, contou ${n}`);
});

test('find acha por kind e devolve o primeiro', () => {
  const arvore = new TranslationUnit([
    new FunctionDecl(['int'], new Declarator('f', { params: [] })),
  ]);
  const achou = find(arvore, 'FunctionDecl');
  assert.ok(achou);
  assert.equal(achou.declarator.name, 'f');
});

test('count conta por kind', () => {
  const arvore = new TranslationUnit([
    new FunctionDecl(['int'], new Declarator('a', { params: [] })),
    new FunctionDecl(['int'], new Declarator('b', { params: [] })),
    new FunctionDecl(['void'], new Declarator('c', { params: [] })),
  ]);
  assert.equal(count(arvore, 'FunctionDecl'), 3);
});

// ---------------------------------------------------------------- robustez

test('unparse de nó desconhecido não lança', () => {
  assert.doesNotThrow(() => unparse({ kind: 'BugDesconhecido' }));
  assert.doesNotThrow(() => unparse(null));
  assert.doesNotThrow(() => unparse(undefined));
});

test('nenhum construtor lança com entrada incompleta', () => {
  const ctors = [
    () => new TranslationUnit(),
    () => new VariableDecl(),
    () => new FunctionDecl(),
    () => new ClassDecl(),
    () => new EnumDecl(),
    () => new NamespaceDecl(),
    () => new Lambda(),
    () => new SwitchStmt(),
    () => new ForStmt(),
  ];
  for (const c of ctors) assert.doesNotThrow(c);
});

test('todo nó serializa em JSON sem ciclo nem função', () => {
  const arvore = new TranslationUnit([
    new FunctionDecl(['int'], new Declarator('f', { params: [new Declarator('a')] }),
      new CompoundStmt([new ReturnStmt(new Identifier('a'))])),
  ]);
  const json = JSON.stringify(arvore);
  assert.ok(json.length > 0);
  const volta = JSON.parse(json);
  assert.equal(volta.kind, 'TranslationUnit');
});

test('umparse de declaração sem especificadores não devolve string vazia', () => {
  assert.notEqual(unparse(new VariableDecl([], [new Declarator('x')])).trim(), '');
});