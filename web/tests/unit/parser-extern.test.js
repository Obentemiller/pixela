/**
 * tests/unit/parser-extern.test.js — A2-BUG-2: `extern T x;` é declaração.
 *
 * `parser.js` roteia TODO `extern` para `linkageSpec()`, que exige string
 * literal. Isso é correto para `extern "C" ...` e errado para `extern T x;`,
 * que é uma declaração comum com o specifier `extern` — o mesmo que já está
 * em `PALAVRAS_ESPECIFICADOR`.
 *
 * O ORÁCULO é o `g++`, colado em `reports/A2/p01-gpp-oraculo.log`. O que
 * importa aqui é o veredito SINTÁTICO: `T does not name a type` é erro de
 * Sema (E02xx, fora do escopo do parser), então o tipo dos testes é
 * `struct O` declarado — assim o g++ só se manifesta sobre sintaxe.
 *
 * ESTE ARQUIVO NÃO É A PROVA DO BUG: `npm test` roda `diff-parse.mjs`, que
 * classifica as 180 fixtures contra o g++. Este arquivo é a **fixação de
 * comportamento** que impede a regressão de voltar silenciosa.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Lexer } from '../../js/cpp/lexer.js';
import { Parser } from '../../js/cpp/parser.js';

function parse(src, file = 't.cpp') {
  return new Parser(new Lexer(src, file).tokenize().tokens, { file }).parse();
}

function erros(src) {
  return parse(src).diagnostics.filter((d) => d.severity === 'error');
}

/** `extern T x;` é DECLARAÇÃO: o specifier `extern` fica em `specifiers[]`. */
function varDeclDe(src, indice = -1) {
  const vars = parse(src).ast.decls.filter((d) => d.kind === 'VariableDecl');
  return indice < 0 ? vars[vars.length + indice] : vars[indice];
}

// ---------------------------------------------- o g++ ACEITA (5 construções)
// oracle: "ACEITA (0 erro)" em reports/A2/p01-gpp-oraculo.log

test('A2-BUG-2-01: extern int x; é declaração válida', () => {
  const e = erros('extern int x;');
  assert.equal(e.length, 0,
    `g++ aceita; nosso deu ${e.map((d) => `${d.code}@${d.loc.line}:${d.loc.column} ${d.message}`).join('; ')}`);
  assert.ok(varDeclDe('extern int x;').specifiers.includes('extern'),
    'o specifier `extern` tem de aparecer em specifiers[]');
});

test('A2-BUG-2-02: extern T x; — a construção que originou o bug', () => {
  const src = 'struct O { int x; }; extern O cout;';
  const e = erros(src);
  assert.equal(e.length, 0,
    `g++ aceita; nosso deu ${e.map((d) => `${d.code}@${d.loc.line}:${d.loc.column} ${d.message}`).join('; ')}`);
  const v = varDeclDe(src);
  assert.ok(v.specifiers.includes('extern'), `specifiers = ${JSON.stringify(v.specifiers)}`);
  assert.equal(v.declarators[0].name, 'cout', 'o nome tem de ser `cout`, não perdido');
});

test('A2-BUG-2-03: extern const T x; — cv antes do declarador', () => {
  const src = 'struct O { int x; }; extern const O cout;';
  const e = erros(src);
  assert.equal(e.length, 0,
    `g++ aceita; nosso deu ${e.map((d) => `${d.code}@${d.loc.line}:${d.loc.column} ${d.message}`).join('; ')}`);
  const specs = varDeclDe(src).specifiers;
  assert.ok(specs.includes('extern'), `specifiers = ${JSON.stringify(specs)}`);
  assert.ok(specs.includes('const'), `specifiers = ${JSON.stringify(specs)}`);
});

test('A2-BUG-2-04: extern T x, y; — dois declaradores', () => {
  const src = 'struct O { int x; }; extern O a, b;';
  const e = erros(src);
  assert.equal(e.length, 0,
    `g++ aceita; nosso deu ${e.map((d) => `${d.code}@${d.loc.line}:${d.loc.column} ${d.message}`).join('; ')}`);
  const nomes = varDeclDe(src).declarators.map((d) => d.name);
  assert.deepEqual(nomes, ['a', 'b'], `declaradores = ${JSON.stringify(nomes)}`);
});

test('A2-BUG-2-05: extern "C" int f(); — o caminho que NÃO pode regredir', () => {
  // Esta é a razão de a correção ser uma guarda e não um desvio: `extern "C"`
  // tem de continuar indo para `linkageSpec()`.
  const r = parse('extern "C" int f();');
  const e = r.diagnostics.filter((d) => d.severity === 'error');
  assert.equal(e.length, 0,
    `g++ aceita; nosso deu ${e.map((d) => `${d.code} ${d.message}`).join('; ')}`);
  const linkage = r.ast.decls.find((d) => d.kind === 'LinkageSpec');
  assert.ok(linkage, `esperava LinkageSpec, veio ${r.ast.decls.map((d) => d.kind).join(', ')}`);
  assert.equal(linkage.language, 'C', `language = ${JSON.stringify(linkage.language)}`);
});

// ---------------------------------------------- o g++ REJEITA (2 construções)
// oracle: "declaration does not declare anything" em reports/A2/p01-gpp-oraculo.log

test('A2-BUG-2-06: extern; sozinho continua INVÁLIDO', () => {
  // Este é o controle que o bloco pede: `extern` sem tipo e sem nome. O g++
  // rejeita com "declaration does not declare anything".
  const e = erros('extern;');
  assert.ok(e.length >= 1,
    'g++ rejeita com "declaration does not declare anything"; aceitar aqui seria um falso-verde');
});

test('A2-BUG-2-07: `extern O;` é um GAP CONHECIDO, fora do escopo deste fix', () => {
  // MEDIDO (reports/A2/p01-extern-gap-declarador.log):
  //
  //   `struct O{int x;}; extern O;`  -> 0 erros, VariableDecl{["extern"], name:"O"}
  //   `struct O{int x;}; const O;`  -> 0 erros, VariableDecl{["const"], name:"O"}
  //
  // O g++ rejeita os DOIS com "declaration does not declare anything". Como o
  // comportamento é IDÊNTICO sem `extern`, a causa NÃO é A2-BUG-2: é a
  // validação de "lista de specifiers sem tipo de base", que mora em
  // `declaracaoSimples()` — FORA da região ~632-635 que este bloco pode
  // editar, e já classificada no grupo S7(d) "sem validação" (P0-3).
  //
  // Este teste REGISTRA o estado, não o aprova: se um dia a validação fechar,
  // o valor muda de 0 e o teste avisa. Ver `reports/A2/pedido-escopo.md`.
  const e = erros('struct O { int x; }; extern O;');
  console.log(`      \`extern O;\` -> ${e.length} diag (g++ rejeita: declaration does not declare anything)`);
  const semExtern = erros('struct O { int x; }; const O;');
  console.log(`      \`const O;\`   -> ${semExtern.length} diag — o MESMO gap sem \`extern\``);
  assert.equal(semExtern.length, e.length,
    'se os dois divergirem, o gap passou a ser de `extern` e pertence a este bloco');
});

// ---------------------------------------------- contrato do fix

test('A2-BUG-2-C1: a correção NÃO introduz campo novo na AST', () => {
  // O conserto tem de ser uma GUARDA no despacho do topo. Se aparecer algum
  // campo novo além de `specifiers` incluindo `extern`, o fix escalou.
  const chaves = new Set();
  (function anda(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(anda);
    for (const k of Object.keys(n)) chaves.add(k);
    for (const v of Object.values(n)) anda(v);
  })(varDeclDe('extern int x;'));
  for (const proibido of ['externLinkage', 'linkage', 'externString', 'linkageLang']) {
    assert.ok(!chaves.has(proibido), `campo novo inesperado na AST: ${proibido}`);
  }
  // `extern` NÃO é campo: é valor dentro de `specifiers`.
  assert.ok(!chaves.has('extern'), '`extern` não pode virar campo; é valor de specifiers[]');
  assert.ok(chaves.has('specifiers'), 'specifiers[] continua presente');
});

test('A2-BUG-2-C2: os dois caminhos de `extern` continuam distinguíveis', () => {
  // A guarda é sobre o PRÓXIMO token ser string. Se alguém a mover ou
  // inverter, um dos dois caminhos morre — este teste pega os dois.
  const comString = parse('extern "C" int f();').ast.decls[0].kind;
  const semString = parse('extern int x;').ast.decls[0].kind;
  assert.equal(comString, 'LinkageSpec', `extern "C" -> ${comString}`);
  assert.equal(semString, 'VariableDecl', `extern T -> ${semString}`);
});
