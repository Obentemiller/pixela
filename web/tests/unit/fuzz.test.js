/**
 * tests/unit/fuzz.test.js — fuzz e propriedades sobre o lexer.
 *
 * Seed fixa: os casos são reproduzíveis entre execuções.
 * 2000 entradas, timeout de 1 s por caso. O lexer NUNCA deve lançar nem travar.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Lexer } from '../../js/cpp/lexer.js';

const SEED = 0xC0FFEE;
const N_CASOS = 2000;
const TIMEOUT_CASO_MS = 1000;

// PRNG determinístico (mulberry32)
function prng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALFA = 'abcxyz_ABCXYZ0123456789';
const PONTOS = ' \t\n\r(){}[];,.+-*/%<>=!&|^~?:#"\'\\@$`';

/** Gera uma entrada aleatória curta. */
function entradaAleatoria(rnd, tamanho) {
  let s = '';
  for (let i = 0; i < tamanho; i++) {
    s += rnd() < 0.6 ? ALFA[(rnd() * ALFA.length) | 0] : PONTOS[(rnd() * PONTOS.length) | 0];
  }
  return s;
}

/** Muta uma entrada existente trocando/inserindo caracteres. */
function mutar(rnd, base) {
  const chars = [...base];
  const nOps = 1 + ((rnd() * 3) | 0);
  for (let i = 0; i < nOps; i++) {
    if (chars.length === 0) { chars.push('x'); continue; }
    const pos = (rnd() * chars.length) | 0;
    const op = rnd();
    if (op < 0.4) chars[pos] = ALFA[(rnd() * ALFA.length) | 0];
    else if (op < 0.8) chars[pos] = PONTOS[(rnd() * PONTOS.length) | 0];
    else chars.splice(pos, 1);
  }
  return chars.join('');
}

/** Fragmentos reais de C++ para mutação. */
const SEMENTES = [
  'int main() { return 0; }',
  '#include <vector>\n#define N 7\nint x = N;',
  '#if 0\nint a;\n#else\nint b;\n#endif',
  'char c = \'a\';',
  'const char* s = "ola\\n";',
  'auto f = [](int x) { return x * 2; };',
  'template<typename T> T max(T a, T b) { return a > b ? a : b; }',
  'for (int i = 0; i < 10; ++i) sum += i;',
  '1.5e-3f 0x1F 0b1010 077 1\'000',
  '/* bloco\nmultilinha */ int z; // linha',
  'R"(raw string)"',
  'std::vector<int>> v;',
];

test('fuzz: 2000 entradas aleatórias/mutadas nunca lançam nem travam', () => {
  const rnd = prng(SEED);
  let maisLongoMs = 0;
  let piorCaso = null;

  for (let i = 0; i < N_CASOS; i++) {
    let src;
    const modo = rnd();
    if (modo < 0.4) src = entradaAleatoria(rnd, 1 + ((rnd() * 40) | 0));
    else if (modo < 0.7) src = mutar(rnd, SEMENTES[(rnd() * SEMENTES.length) | 0]);
    else src = mutar(rnd, entradaAleatoria(rnd, 1 + ((rnd() * 20) | 0)));

    const t0 = Date.now();
    let lancou = null;
    let r = null;
    try {
      r = new Lexer(src, 'fuzz.cpp').tokenize({ mode: rnd() < 0.3 ? 'preprocess' : 'normal' });
    } catch (e) {
      lancou = e;
    }
    const dt = Date.now() - t0;
    if (dt > maisLongoMs) { maisLongoMs = dt; piorCaso = { i, src, dt }; }

    assert.equal(lancou, null,
      `caso ${i} lançou ${lancou?.constructor.name}: ${lancou?.message}\nsrc=${JSON.stringify(src)}`);

    // invariantes que valem para TODA entrada
    assert.ok(Array.isArray(r.tokens), `caso ${i}: tokens não é array`);
    assert.ok(r.tokens.length >= 1, `caso ${i}: lista de tokens vazia`);
    assert.equal(r.tokens.at(-1).type, 'eof', `caso ${i}: não terminou em eof`);
    assert.equal(r.tokens.filter((x) => x.type === 'eof').length, 1,
      `caso ${i}: mais de um eof`);
    assert.ok(Array.isArray(r.diagnostics), `caso ${i}: diagnostics não é array`);
    for (const d of r.diagnostics) {
      assert.equal(typeof d.message, 'string', `caso ${i}: diagnóstico sem message`);
      assert.ok(d.loc && d.loc.line >= 1 && d.loc.column >= 1,
        `caso ${i}: diagnóstico com loc inválida: ${JSON.stringify(d.loc)}`);
    }
    for (const t of r.tokens) {
      assert.ok(t.loc.line >= 1 && t.loc.column >= 1,
        `caso ${i}: token ${t.type} com loc inválida`);
    }
    assert.ok(dt < TIMEOUT_CASO_MS,
      `caso ${i} levou ${dt}ms (> ${TIMEOUT_CASO_MS}ms)\nsrc=${JSON.stringify(src)}`);
  }

  console.log(`[fuzz] ${N_CASOS} casos, seed 0x${SEED.toString(16).toUpperCase()}, ` +
    `caso mais lento: ${maisLongoMs}ms ${piorCaso ? `(caso ${piorCaso.i}, ${JSON.stringify(piorCaso.src).slice(0, 60)})` : ''}`);
});

test('propriedade: re-tokenizar os tokens reescritos dá a mesma sequência kind+text', () => {
  const rnd = prng(SEED ^ 0x5EED);
  const fontes = [
    ...SEMENTES,
    ...Array.from({ length: 200 }, () => entradaAleatoria(rnd, 5 + ((rnd() * 60) | 0))),
  ];

  // Tipos de token cujo TEXTO no fonte é reconstruível exatamente. Literais de
  // string/char não entram: o valor processado (escapes resolvidos) não é o
  // texto original, e um string não pode conter newline — a reconstrução por
  // `hasSpaceBefore` quebraria a sequência. O round-trip desses é coberto
  // pelos casos do corpus, que comparam valor e texto explicitamente.
  const REESCOLHAVEL = new Set(['ident', 'keyword', 'type', 'operator', 'punctuator', 'number']);

  let conferidos = 0;
  for (const src of fontes) {
    const a = new Lexer(src, 'r.cpp').tokenize();

    // reconstrói usando o texto-fonte de cada token reescobível
    // (exclui literais char/string: o valor processado não é o texto original,
    //  e reescrevê-los sem escapes pode produzir bytes diferentes)
    let rebuilt = '';
    const esperados = [];
    let temLiteral = false;
    for (const t of a.tokens) {
      if (t.type === 'eof') break;
      if (!REESCOLHAVEL.has(t.type)) { if (t.isLiteral || t.type === 'error') temLiteral = true; continue; }
      if (t.hasSpaceBefore && rebuilt !== '') rebuilt += ' ';
      rebuilt += t.text;
      esperados.push(`${t.type}:${t.text}`);
    }
    // só exigimos round-trip exato se não houver literais (que não são
    // reconstruíveis sem o texto-fonte completo)
    if (temLiteral) continue;

    const b = new Lexer(rebuilt, 'r.cpp').tokenize();
    const seqB = b.tokens
      .filter((t) => t.type !== 'eof' && t.type !== 'error')
      .map((t) => `${t.type}:${t.text}`);

    assert.deepEqual(seqB, esperados,
      `round-trip difere\n  src original: ${JSON.stringify(src)}\n  reconstruído: ${JSON.stringify(rebuilt)}`);
    conferidos++;
  }
  console.log(`[round-trip] ${conferidos} fontes conferidas`);
});