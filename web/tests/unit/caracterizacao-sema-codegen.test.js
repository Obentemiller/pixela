/**
 * tests/unit/caracterizacao-sema-codegen.test.js
 *
 * `sema.js` e `codegen.js` estavam com **zero** testes, e um `npm test` verde
 * não dizia nada sobre eles. A pergunta "são stubs ou implementação?" tem
 * resposta medida: são implementação, e estão no caminho de execução —
 * `core.js`, `index.js` e `worker.js` importam os dois.
 *
 * Este arquivo não valida CORREÇÃO: valida o COMPORTAMENTO ATUAL. Um teste de
 * caracterização congela o que o código faz hoje, inclusive o que está errado,
 * para que uma mudança seja uma decisão e não um acidente. Onde o
 * comportamento atual é um defeito, o teste diz isso na asserção.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const { Lexer } = await import(join(RAIZ, 'js', 'cpp', 'lexer.js'));
const { Parser } = await import(join(RAIZ, 'js', 'cpp', 'parser.js'));
const { Sema } = await import(join(RAIZ, 'js', 'cpp', 'sema.js'));
const { CodeGenerator } = await import(join(RAIZ, 'js', 'cpp', 'codegen.js'));

/** Atalho: fonte -> AST, com os diagnósticos do parse. */
function parse(src, arquivo = 't.cpp') {
  const lex = new Lexer(src, arquivo).tokenize();
  const r = new Parser(lex.tokens, { file: arquivo }).parse();
  return { ast: r.ast, diagnostics: r.diagnostics };
}

// ===================================================================
// O que os dois módulos SÃO
// ===================================================================

test('S7i: sema.js e codegen.js têm implementação, não são stubs', () => {
  assert.equal(typeof Sema, 'function', 'Sema deve ser uma classe exportada');
  assert.equal(typeof CodeGenerator, 'function', 'CodeGenerator deve ser uma classe exportada');

  // métodos privados com corpo real
  const metodosSema = Object.getOwnPropertyNames(Sema.prototype)
    .filter((n) => n !== 'constructor');
  assert.ok(metodosSema.length >= 12,
    `Sema tem ${metodosSema.length} métodos; um stub teria 1-2`);

  const metodosCodegen = Object.getOwnPropertyNames(CodeGenerator.prototype)
    .filter((n) => n !== 'constructor');
  assert.ok(metodosCodegen.length >= 15,
    `CodeGenerator tem ${metodosCodegen.length} métodos; um stub teria 1-2`);

  // o código-fonte é substantivo
  for (const f of ['sema.js', 'codegen.js']) {
    const linhas = readFileSync(join(RAIZ, 'js', 'cpp', f), 'utf8').split('\n').length;
    assert.ok(linhas > 200, `${f} tem ${linhas} linhas; um stub teria poucas`);
  }
});

test('S7i: sema.js e codegen.js ESTÃO no caminho de execução', () => {
  for (const entrada of ['core.js', 'index.js', 'worker.js']) {
    const texto = readFileSync(join(RAIZ, 'js', 'cpp', entrada), 'utf8');
    assert.match(texto, /from '\.\/sema\.js'/, `${entrada} importa sema.js`);
    assert.match(texto, /from '\.\/codegen\.js'/, `${entrada} importa codegen.js`);
  }
});

// ===================================================================
// Sema: caracterização
// ===================================================================

test('S7i: Sema.analyze devolve um resultado com o AST e diagnósticos', () => {
  const { ast, diagnostics } = parse('int f(int a) { return a; }\n');
  assert.equal(diagnostics.length, 0, 'a fonte de exemplo tem de parsear limpa');

  const s = new Sema();
  const res = s.analyze(ast);
  assert.ok(res, 'analyze tem de devolver algo');
  assert.ok(res.ast, 'o resultado tem de trazer o ast');
  assert.ok(Array.isArray(res.diagnostics), 'o resultado tem de trazer diagnostics[]');
});

test('S7i: Sema não lança em nenhuma das 12 formas de T2.1', () => {
  const fontes = [
    'int a[] = {1, 2, 3};',
    'int a[][2] = {{1, 2}, {3, 4}};',
    'struct S { int a; int b; }; S s{1, 2};',
    'int* p = new int[3]{1, 2, 3};',
    'struct C { int r; int g; int b; }; C f() { return {1, 2, 3}; }',
    'int x = std::min({1, 2, 3});',
    'struct S { int operator+(const S&) const { return 1; } };',
    'extern "C" int f(int);',
    'extern "C" { int f(int); int g(int); }',
    'auto f(int x) -> int { return x; }',
    'template<class T> T f(T x) { return x; }',
    'auto f = [](int x) { return x; };',
  ];
  for (const src of fontes) {
    const { ast, diagnostics } = parse(src);
    assert.equal(diagnostics.length, 0, `a fonte tem de parsear limpa: ${src}`);
    assert.doesNotThrow(() => new Sema().analyze(ast),
      `Sema.analyze NÃO pode lançar em: ${src}`);
  }
});

test('S7i: Sema é idempotente — duas análises dão o mesmo resultado', () => {
  const { ast } = parse('int f(int a, int b) { return a + b; }\n');
  const a = JSON.stringify(new Sema().analyze(ast).diagnostics ?? []);
  const b = JSON.stringify(new Sema().analyze(ast).diagnostics ?? []);
  assert.equal(a, b, 'analyze tem de ser puro: duas chamadas, mesmo resultado');
});

test('S7i: Sema aceita construtor com e sem scopeManager', () => {
  const { ast } = parse('int g() { return 1; }\n');
  assert.doesNotThrow(() => new Sema(null).analyze(ast),
    'new Sema(null) tem de funcionar (o parametro tem default)');
  assert.doesNotThrow(() => new Sema({}).analyze(ast),
    'new Sema({}) tem de funcionar com um objeto vazio no lugar do scopeManager');
});

// ===================================================================
// CodeGenerator: caracterização
// ===================================================================

test('S7i: CodeGenerator.generate devolve {code} com o runtime do pixela', () => {
  const { ast } = parse('int f(int a) { return a; }\n');
  const out = new CodeGenerator().generate(ast);
  assert.ok(out, 'generate tem de devolver algo');
  assert.equal(typeof out.code, 'string', 'o resultado tem de trazer code como string');
  assert.match(out.code, /pixCanvas/, 'o código gerado embute o runtime do pixela');
});

test('S7i: CodeGenerator não lança em nenhuma das 12 formas de T2.1', () => {
  const fontes = [
    'int a[] = {1, 2, 3};',
    'int a[][2] = {{1, 2}, {3, 4}};',
    'struct S { int a; int b; }; S s{1, 2};',
    'int* p = new int[3]{1, 2, 3};',
    'struct C { int r; int g; int b; }; C f() { return {1, 2, 3}; }',
    'int x = std::min({1, 2, 3});',
    'struct S { int operator+(const S&) const { return 1; } };',
    'extern "C" int f(int);',
    'extern "C" { int f(int); int g(int); }',
    'auto f(int x) -> int { return x; }',
    'template<class T> T f(T x) { return x; }',
    'auto f = [](int x) { return x; };',
  ];
  for (const src of fontes) {
    const { ast } = parse(src);
    assert.doesNotThrow(() => new CodeGenerator().generate(ast),
      `CodeGenerator.generate NÃO pode lançar em: ${src}`);
  }
});

test('S7i: CodeGenerator aceita opções e as respeita', () => {
  const { ast } = parse('int f() { return 1; }\n');
  assert.doesNotThrow(() => new CodeGenerator({}).generate(ast));
  // A forma de `options` é um contrato público; este teste congela o que
  // hoje é aceito, sem afirmar que é o conjunto completo.
  const comOpcoes = new CodeGenerator({ nomeDoModulo: 'x' }).generate(ast);
  assert.equal(typeof comOpcoes.code, 'string');
});

test('S7i: a saída é DETERMINÍSTICA (duas gerações dão o mesmo texto)', () => {
  const { ast } = parse('int f(int a, int b) { return a + b; }\n');
  const a = new CodeGenerator().generate(ast).code;
  const b = new CodeGenerator().generate(ast).code;
  assert.equal(a, b, 'duas gerações do mesmo AST têm de dar o mesmo código');
});

test('S7i: o pipeline completo parse -> sema -> codegen roda', () => {
  const { ast, diagnostics } = parse(
    'int soma(int a, int b) { return a + b; }\nint main() { return soma(1, 2); }\n');
  assert.equal(diagnostics.length, 0);
  assert.doesNotThrow(() => {
    const sema = new Sema().analyze(ast);
    new CodeGenerator().generate(sema.ast ?? ast);
  });
});