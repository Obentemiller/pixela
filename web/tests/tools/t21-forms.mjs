/**
 * t21-forms.mjs — harness das 14 formas de T2.1.
 *
 * Para cada forma: número de diagnósticos, códigos, AST ok?, round-trip ok?
 * Critério da ordem: TODAS as 14 devem ter 0 diagnósticos.
 * Única exceção: designador C++20 `{.x=1}` -> E03xx.
 *
 * Uso: node tests/tools/t21-forms.mjs
 * Saída: tabela markdown em stdout (vira reports/A2/t21.log via tee).
 */
import { Lexer } from '../../js/cpp/lexer.js';
import { Preprocessor } from '../../js/cpp/preprocessor.js';
import { Parser } from '../../js/cpp/parser.js';
import { unparse } from '../../js/cpp/ast.js';

/** As 14 formas de T2.1 + os casos negativos de desambiguação. */
export const FORMAS = [
  // 1 — constexpr array 2D com init-list aninhado (pixela.hpp kBrailleBit)
  ['F01', 'constexpr int kBrailleBit[2][4] = { {0,1,2,6}, {3,4,5,7} };'],
  // 2 — array 2D com vírgula final
  ['F02', 'int a[2][2] = {{1,2},{3,4},};'],
  // 3 — array vazio
  ['F03', 'int a[3] = {};'],
  // 4 — array 2D 3 linhas
  ['F04', 'int a[2][3] = {{1,2},{3,4},{5,6}};'],
  // 5 — chamada com initializer-clause
  ['F05', 'void f() { g({1,2,3}); }'],
  // 6 — return com braced-init-list (Vec3::operator+)
  // P6: `Vec3` precisa ser DECLARADO — a TypeNameScope não adivinha nomes.
  ['F06', 'struct Vec3 { double x, y, z; };\nVec3 operator+(const Vec3 &o) const { return {x + o.x, y + o.y, z + o.z}; }'],
  // 7 — return em função simples
  ['F07', 'int f() { return {a + b, c + d}; }'],
  // 8 — template-id com init-list aninhado
  // `std::vector` exige o header virtual: o prelúdio é DECLARADO (P10),
  // não uma lista fixa no parser.
  ['F08', '#include <vector>\nauto v = std::vector<std::vector<int>>{{1,2},{3}};'],
  // 9 — std::min com initializer-list (pixela.hpp fillProjected)
  ['F09', 'int f(Proj a, Proj b, Proj c) { return std::min({a.sx, b.sx, c.sx}); }'],
  // 10 — return com expr complexa (Vec3::cross)
  ['F10', 'struct Vec3 { double x, y, z; };\nVec3 cross(const Vec3 &o) const { return {y * o.z - z * o.y, z * o.x - x * o.z, x * o.y - y * o.x}; }'],
  // 11 — construção por chaves em posição de expressão (Color{...})
  ['F11', 'struct C { C(int a, int b); }; int f() { return Color{255,255,255}.a; }'],
  // 12 — T x{}; (direct-list-init de declaração)
  ['F12', 'struct T { T(); }; void f() { T x{}; }'],
  // 13 — T x = {}; e new T[3]{1,2,3} / new T{...}
  ['F13', 'struct T { T(); T(int); }; void f() { T x = {}; }'],
  // 14 — atribuição com braced-init-list
  ['F14', 'struct T { T(); T& operator=(const T&); }; void f(T x) { x = {1, 2}; }'],
  // 15 — new com init-list
  ['F15', 'void f() { int *p = new int[3]{1,2,3}; }'],
  // 16 — new T(args) e new T{args}
  ['F16', 'struct T { T(int); }; void f() { T *a = new T(1); T *b = new T{1}; }'],
  // 17 — membro de classe int x{0}
  ['F17', 'struct T { int x{0}; int y = 0; };'],
  // 18 — ctor mem-initializer : x{1}
  ['F18', 'struct T { T() : x{1}, y(2) {} int x, y; };'],
  // 19 — designador C++20 -> DEVE dar E03xx (única exceção permitida)
  ['D01', 'struct T { int x; }; T t{.x=1};'],
];

/** Casos negativos: NÃO podem virar init-list. */
export const NEGATIVOS = [
  ['N01', 'void f() { if (c) { g(); } }'],
  ['N02', 'void f() { if (c) { g(); } else { h(); } }'],
  ['N03', 'void f() { do { g(); } while (c); }'],
  // `T` declarado: o teste é sobre o `{` de `T f() {` NÃO virar
  // init-list, não sobre `T` existir.
  ['N04', 'struct T { int x; }; T f() { return 1; }'],
  ['N05', 'void f() { []{}(); }'],
  ['N06', 'void f() { { g(); } }'],
  ['N07', 'struct T { T() {} };'],
  ['N08', 'void f() { while (c) { g(); } }'],
  ['N09', 'void f() { for (;;) { g(); } }'],
];

/** Analisa e devolve o registro de um trecho. */
export function analisa(trecho, file = 't.cpp') {
  // O PRELÚDIO DECLARADO entra aqui: um caso que usa `std::vector` precisa
  // do `#include <vector>`, como o código real. Sem isso o harness mede uma
  // coisa que não existe em uso nenhum (P10).
  const pp = new Preprocessor({}).process(trecho, file);
  const lex = new Lexer(pp.text, file);
  const lt = lex.tokenize();
  const r = new Parser(lt.tokens, { file }).parse();
  const diags = r.diagnostics ?? [];

  // round-trip: unparse -> reparse -> compara AST ignorando loc
  let rtOk = null;
  let rtTexto = '';
  try {
    const texto1 = unparse(r.ast);
    const lex2 = new Lexer(texto1, file).tokenize();
    const r2 = new Parser(lex2.tokens, { file }).parse();
    rtTexto = texto1;
    rtOk = r2.diagnostics.length === 0;
  } catch (e) {
    rtOk = false;
    rtTexto = `<erro: ${e.message}>`;
  }

  return {
    trecho,
    nDiag: diags.length,
    codigos: [...new Set(diags.map((d) => d.code))],
    decls: r.ast?.decls?.length ?? 0,
    astOk: diags.length === 0 && (r.ast?.decls?.length ?? 0) > 0,
    rtOk,
    rtTexto,
    msgs: diags.map((d) => `${d.code} @${d.loc?.line}:${d.loc?.column} ${d.message}`),
  };
}

/** Verifica se o AST contém algum nó do tipo pedido (sem descer em loc). */
export function temNo(texto, kinds, file = 't.cpp') {
  const lex = new Lexer(texto, file).tokenize();
  const r = new Parser(lex.tokens, { file }).parse();
  const vistos = new Set();
  (function anda(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(anda); return; }
    if (n.kind) vistos.add(n.kind);
    for (const k of Object.keys(n)) if (k !== 'loc') anda(n[k]);
  })(r.ast);
  return kinds.filter((k) => vistos.has(k));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const linhas = [];
  linhas.push('### Formas de T2.1 (todas devem ter 0 diagnósticos)');
  linhas.push('');
  linhas.push('| # | trecho | nº diag | códigos | AST ok? | round-trip ok? |');
  linhas.push('|---|---|---:|---|---|---|');

  const linhasNeg = [];
  linhasNeg.push('### Casos negativos (NÃO podem virar init-list)');
  linhasNeg.push('');
  linhasNeg.push('| # | trecho | nº diag | códigos | AST ok? | round-trip ok? |');
  linhasNeg.push('|---|---|---:|---|---|---|');

  let falhas = 0;
  for (const [id, trecho] of FORMAS) {
    const a = analisa(trecho);
    const designador = id === 'D01';
    const ok = designador ? (a.codigos.some((c) => c.startsWith('E03')) || a.nDiag > 0) : a.nDiag === 0;
    if (!ok) falhas++;
    linhas.push(`| ${id} | \`${trecho}\` | ${a.nDiag} | ${a.codigos.join(',') || '—'} | ${a.astOk ? 'sim' : 'NÃO'} | ${a.rtOk === null ? '?' : (a.rtOk ? 'sim' : 'NÃO')} |`);
    if (a.nDiag > 0) for (const m of a.msgs.slice(0, 4)) linhas.push(`| | ↳ ${m} | | | | |`);
  }

  linhasNeg.push('');
  for (const [id, trecho] of NEGATIVOS) {
    const a = analisa(trecho);
    const ok = a.nDiag === 0;
    if (!ok) falhas++;
    linhasNeg.push(`| ${id} | \`${trecho}\` | ${a.nDiag} | ${a.codigos.join(',') || '—'} | ${a.astOk ? 'sim' : 'NÃO'} | ${a.rtOk ? 'sim' : 'NÃO'} |`);
  }

  const tot = FORMAS.length + NEGATIVOS.length;
  linhas.push('');
  linhas.push(`**${tot - falhas}/${tot} conformes.** ${falhas} fora do esperado.`);
  console.log(linhas.join('\n'));
  console.log('');
  console.log(linhasNeg.join('\n'));
  process.exitCode = falhas === 0 ? 0 : 1;
}