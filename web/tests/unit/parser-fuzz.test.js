/**
 * tests/unit/parser-fuzz.test.js — fuzz do parser.
 *
 * Duas propriedades, com semente FIXA (a falha tem de ser reproduzível):
 *
 *  1. **Nunca lança e nunca trava.** 3000 casos gerados de um alfabeto de
 *     tokens C++. Cada caso tem um orçamento de 1 s: se estourar, o teste
 *     falha nomeando a entrada exata.
 *  2. **Round-trip estável.** Quando o caso é aceito sem diagnóstico,
 *     `parse → unparse → parse` devolve o mesmo texto. Isso pega bugs em que
 *     o parser aceita algo mas o unparse perde informação.
 *
 * A semente é a mesma do fuzz do lexer (`0xC0FFEE`) para que as duas suítes
 * sejam reproduzíveis a partir de um único número.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Lexer } from '../../js/cpp/lexer.js';
import { Parser } from '../../js/cpp/parser.js';
import { unparse } from '../../js/cpp/ast.js';

const SEMENTE = 0xc0ffee;
const CASOS = 3000;
const ORCAMENTO_MS = 1000;

/** Gerador linear congruente: mesma semente, mesma sequência, sempre. */
function gerar(semente, quantos) {
  let s = semente >>> 0;
  const proximo = () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 0x100000000;
  };
  const saida = [];
  for (let i = 0; i < quantos; i++) {
    const n = 1 + Math.floor(proximo() * 14);
    let txt = '';
    for (let k = 0; k < n; k++) txt += ALFABETO[Math.floor(proximo() * ALFABETO.length)];
    saida.push(txt);
  }
  return saida;
}

const ALFABETO = [
  'int', 'char', 'void', 'bool', 'float', 'double', 'long', 'unsigned',
  'const', 'static', 'inline', 'virtual', 'explicit', 'mutable', 'constexpr',
  'struct', 'class', 'enum', 'union', 'namespace', 'template', 'typename',
  'using', 'typedef', 'public', 'private', 'protected', 'friend',
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
  'return', 'break', 'continue', 'goto', 'try', 'catch', 'throw',
  'new', 'delete', 'sizeof', 'typeid', 'static_cast', 'noexcept', 'this',
  'true', 'false', 'nullptr', 'operator', 'constexpr',
  'a', 'b', 'x', 'y', 'Foo', 'Bar', 'ns', 'std', 'vector',
  '1', '42', '0x1F', '077', '0b1010', '1.5', '1e3', "'c'", '"s"', '"a" "b"',
  '(', ')', '{', '}', '[', ']', '<', '>', '<<', '>>', '::', '->', '.',
  '+', '-', '*', '/', '%', '=', '==', '!=', '<=', '>=', '&&', '||', '!',
  '?', ':', ';', ',', '.', '...', '->*', '.*', '#',
];

/**
 * Gerador ESTRUTURADO.
 *
 * Lixo aleatório quase nunca é aceito por um parser: em 3000 casos, só ~14
 * passavam, e um round-trip sobre 14 casos não prova nada. Este gerador
 * monta programas a partir de fragmentos que o padrão aceita, para que a
 * maioria dos casos entre no round-trip.
 *
 * A mesma semente, a mesma sequência — continua reprodutível.
 */
function gerarEstruturado(semente, quantos) {
  let s = semente >>> 0;
  const proximo = () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 0x100000000;
  };
  const escolher = (lista) => lista[Math.floor(proximo() * lista.length)];

  const tipos = ['int', 'char', 'float', 'double', 'bool', 'long', 'unsigned int', 'void'];
  const nomes = ['a', 'b', 'x', 'y', 'valor', 'contador'];

  const tipo = () => escolher(tipos);
  const nome = () => escolher(nomes);
  const num = () => escolher(['1', '42', '0', '7', "'c'", '1.5', '2.0f']);
  const expr = () => escolher([
    `${num()}`, nome(), `${nome()} + ${num()}`, `${nome()} * 2`,
    `f(${num()})`, `arr[0]`, `obj.x`, `ptr->y`, `(${num()})`,
    `${nome()} ? ${num()} : ${num()}`, `-${num()}`, `!${num()}`,
  ]);

  const declaracoes = [
    () => `${tipo()} ${nome()};`,
    () => `${tipo()} ${nome()} = ${expr()};`,
    () => `${tipo()} ${nome()} = {${num()}, ${num()}};`,
    () => `const ${tipo()} ${nome()} = ${num()};`,
    () => `${tipo()} ${nome()}[4];`,
    () => `${tipo()}* p${escolher(['', '1', '2'])};`,
    () => `${tipo()}& r = ${nome()};`,
    () => `static ${tipo()} ${nome()} = ${num()};`,
  ];
  const statements = [
    () => `${expr()};`,
    () => `return ${expr()};`,
    () => `if (${expr()}) { ${expr()}; }`,
    () => `if (${expr()}) ${expr()}; else ${expr()};`,
    () => `while (${expr()}) { ${expr()}; }`,
    () => `do { ${expr()}; } while (${expr()});`,
    () => `for (int i = 0; i < ${num()}; ++i) { ${expr()}; }`,
    () => `for (${tipo()} v : arr) { ${expr()}; }`,
    () => `switch (${expr()}) { case 1: ${expr()}; break; default: break; }`,
    () => `{ ${tipo()} local = ${expr()}; }`,
    () => `int auto l = [](int q) { return q; }; ${expr()};`,
  ];
  const funcoes = [
    () => `${tipo()} fn() { return ${expr()}; }`,
    () => `${tipo()} fn(${tipo()} p, int q) { return ${expr()}; }`,
    () => `void fn() { ${escolher(statements)()} }`,
    () => `int fn(int n) { int s = 0; for (int i = 0; i < n; ++i) { s += i; } return s; }`,
    () => `void fn() { if (${expr()}) { ${escolher(statements)()} } }`,
  ];
  const tiposComp = [
    () => `struct ${escolher(['S', 'T', 'Ponto'])} { ${tipo()} x; };`,
    () => `class ${escolher(['C', 'K'])} { public: ${tipo()} x; ${escolher(funcoes)()} };`,
    () => `struct ${escolher(['B', 'A'])} { int x; }; struct ${escolher(['D', 'E'])} : public ${escolher(['B', 'A'])} { int y; };`,
    () => `enum ${escolher(['E', 'Cor'])} { ${escolher(['A', 'B', 'C'])} };`,
    () => `namespace ${escolher(['n', 'ns'])} { ${tipo()} ${nome()}; }`,
    () => `template<typename T> struct V { T p; };`,
    () => `using ${escolher(['I', 'Alias'])} = ${tipo()};`,
  ];

  const saida = [];
  for (let i = 0; i < quantos; i++) {
    const quantosDecl = 1 + Math.floor(proximo() * 4);
    let txt = '';
    for (let k = 0; k < quantosDecl; k++) {
      const grupo = proximo();
      txt += grupo < 0.30 ? `${escolher(declaracoes)()}\n`
        : grupo < 0.60 ? `${escolher(funcoes)()}\n`
          : grupo < 0.90 ? `${escolher(tiposComp)()}\n`
            : `${escolher(statements)()}\n`;
    }
    saida.push(txt);
  }
  return saida;
}

const casosDeLixo = gerar(SEMENTE, CASOS);
const casosEstruturados = gerarEstruturado(SEMENTE ^ 0x5a5a, CASOS);
const casos = [...casosEstruturados, ...casosDeLixo];

/** Executa um caso com orçamento de tempo. */
function compilarComOrcamento(src) {
  const t0 = performance.now();
  const lex = new Lexer(src, 'fuzz.cpp').tokenize();
  if (lex.diagnostics.length > 0) {
    return { ok: true, ms: performance.now() - t0, diag: lex.diagnostics.length, texto: null };
  }
  const r = new Parser(lex.tokens, { file: 'fuzz.cpp' }).parse();
  const ms = performance.now() - t0;
  return { ok: true, ms, diag: r.diagnostics.length, texto: r.diagnostics.length === 0 ? unparse(r.ast) : null };
}

test(`fuzz: ${CASOS} casos, semente 0x${SEMENTE.toString(16).toUpperCase()}, nunca lança e nunca trava`, () => {
  const falhas = [];
  let maisLento = 0;
  let maisLentoCaso = '';
  let lance = 0;

  for (const src of casos) {
    let r;
    try {
      r = compilarComOrcamento(src);
    } catch (e) {
      lance++;
      falhas.push(`LANÇOU ${JSON.stringify(src)}: ${e.message}`);
      continue;
    }
    if (r.ms > maisLento) { maisLento = r.ms; maisLentoCaso = src; }
    if (r.ms > ORCAMENTO_MS) {
      falhas.push(`ORÇAMENTO ${r.ms.toFixed(0)} ms (> ${ORCAMENTO_MS}) em ${JSON.stringify(src)}`);
    }
  }

  assert.equal(lance, 0, `${lance} casos lançaram:\n${falhas.slice(0, 5).join('\n')}`);
  assert.deepEqual(falhas, [], `fuzz falhou:\n${falhas.slice(0, 10).join('\n')}`);
  assert.ok(maisLento < ORCAMENTO_MS,
    `caso mais lento: ${maisLento.toFixed(1)} ms em ${JSON.stringify(maisLentoCaso)}`);
  console.log(`      fuzz: mais lento ${maisLento.toFixed(3)} ms (orçamento ${ORCAMENTO_MS} ms), `
    + `${casos.length} casos`);
});

test('fuzz: round-trip estável nos casos aceitos', () => {
  const falhas = [];
  let aceitos = 0;
  // P7: os casos de FUZZ são gerados aleatoriamente e muitos são inválidos
  // por construção — pulá-los é correto. O que não pode é pular em SILÊNCIO:
  // a contagem é impressa, e `aceitos` tem de ser grande o bastante para o
  // teste estar de fato exercitando round-trip.
  let rejeitadosLex = 0;
  let rejeitadosParse = 0;
  let lancou = 0;

  for (const src of casos) {
    let r;
    try {
      const lex = new Lexer(src, 'fuzz.cpp').tokenize();
      if (lex.diagnostics.length > 0) { rejeitadosLex++; continue; }
      r = new Parser(lex.tokens, { file: 'fuzz.cpp' }).parse();
    } catch {
      lancou++; // já coberto pelo teste de "nunca lança"
      continue;
    }
    if (r.diagnostics.length > 0) { rejeitadosParse++; continue; }
    aceitos++;

    const t1 = unparse(r.ast);
    const lex2 = new Lexer(t1, 'fuzz2.cpp').tokenize();
    if (lex2.diagnostics.length > 0) {
      falhas.push(`REPARSE ${JSON.stringify(src)}\n  unparse -> ${JSON.stringify(t1)}\n  ${lex2.diagnostics.map((d) => d.message).join('; ')}`);
      continue;
    }
    const r2 = new Parser(lex2.tokens, { file: 'fuzz2.cpp' }).parse();
    if (r2.diagnostics.length > 0) {
      falhas.push(`REPARSE-DIAG ${JSON.stringify(src)}\n  unparse -> ${JSON.stringify(t1)}\n  ${r2.diagnostics.map((d) => d.message).join('; ')}`);
      continue;
    }
    const t2 = unparse(r2.ast);
    if (t1 !== t2) {
      falhas.push(`DIVERGE ${JSON.stringify(src)}\n  1a: ${JSON.stringify(t1)}\n  2a: ${JSON.stringify(t2)}`);
    }
  }

  // P7: nada de pular em silêncio. A contagem é impressa e o piso é
  // verificado — se o parser passar a rejeitar tudo, `aceitos` cai e o
  // round-trip deixa de ser exercitado sem nenhum teste ficar vermelho.
  console.log(`      fuzz round-trip: ${aceitos} aceitos, `
    + `${rejeitadosLex} rejeitados no lexer, ${rejeitadosParse} no parser, `
    + `${lancou} lançaram (de ${casos.length})`);
  assert.ok(aceitos >= 50, `só ${aceitos} casos aceitos — o fuzz não está exercitando o parser`);
  assert.ok(aceitos > casos.length * 0.2,
    `só ${aceitos} de ${casos.length} (${(100 * aceitos / casos.length).toFixed(1)}%) — `
    + `abaixo de 20%, o round-trip quase não está sendo testado`);
  assert.deepEqual(falhas.slice(0, 20), [],
    `round-trip instável em ${falhas.length} casos:\n${falhas.slice(0, 20).join('\n')}`);
});