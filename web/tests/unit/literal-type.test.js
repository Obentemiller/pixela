/**
 * tests/unit/literal-type.test.js — TDD de `literalType`.
 *
 * `literalType(token, opts)` devolve o tipo que o padrão C++17 dá ao
 * literal: [dcl.type] para inteiros, [lex.charset] para char e string.
 *
 * O oráculo é `tests/fixtures/literais.json`, calibrado pelo g++ por
 * `tests/tools/diff-lexer.mjs` — NÃO escrito à mão. A primeira versão deste
 * corpus carregava tipos chutados por heurística no gerador, e a heurística
 * errou em pelo menos 5 casos; o tipo agora vem do compilador.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lexer, literalType, valorExato } from '../../js/cpp/lexer.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LITERAIS = JSON.parse(readFileSync(join(RAIZ, 'tests/fixtures/literais.json'), 'utf8'));

// O projeto tem modelo de dados wasm32: long = 32 bits.
const WASM32 = { longBits: 32 };
const LP64 = { longBits: 64 };

function primeiroToken(src, { permitirDiagnostico = false } = {}) {
  const r = new Lexer(src, 'lit.cpp').tokenize();
  if (!permitirDiagnostico) {
    assert.equal(r.diagnostics.length, 0, `lexer diagnosticou em ${JSON.stringify(src)}`);
  }
  return r.tokens[0];
}

// ---------------------------------------------------------------- char

test('literal de char sem prefixo tem tipo char (não int)', () => {
  assert.equal(literalType(primeiroToken("'A'")), 'char');
  assert.equal(literalType(primeiroToken("'\\n'")), 'char');
  assert.equal(literalType(primeiroToken("'\\x41'")), 'char');
  assert.equal(literalType(primeiroToken("'\\101'")), 'char');
  assert.equal(literalType(primeiroToken("'\\177'")), 'char');
});

test('prefixos de char literais (u8 dá char em C++17, char8_t só no C++20)', () => {
  assert.equal(literalType(primeiroToken("u'a'")), 'char16_t');
  assert.equal(literalType(primeiroToken("U'a'")), 'char32_t');
  assert.equal(literalType(primeiroToken("L'a'")), 'wchar_t');
  assert.equal(literalType(primeiroToken("u8'a'")), 'char');
});

test('literal de char sem prefixo com valor > 127 é implementation-defined, mas o valor é negativo', () => {
  // '\xff' não cabe em char com sinal; o padrão deixa a implementação
  // escolher. O que NÃO pode acontecer é o valor lido ser 255.
  const t = primeiroToken("'\\xff'");
  assert.equal(literalType(t), 'char');
  assert.ok(t.value < 0, `esperava negativo, veio ${t.value}`);
});

// ---------------------------------------------------------------- string

test('literal de string sem prefixo é array de char com N+1 elementos', () => {
  assert.equal(literalType(primeiroToken('"abc"')), 'const char[4]');
  assert.equal(literalType(primeiroToken('""')), 'const char[1]');
  assert.equal(literalType(primeiroToken('"a\\nb"')), 'const char[4]');
});

test('prefixos de string literais (u8 dá const char[] em C++17)', () => {
  // O lexer ainda emite E0203 "prefixo não suportado" para u/U/L, mas
  // registra o prefixo — então o tipo é calculado mesmo assim.
  assert.equal(literalType(primeiroToken('u8"ab"')), 'const char[3]');
  assert.equal(literalType(primeiroToken('u"ab"', { permitirDiagnostico: true })), 'const char16_t[3]');
  assert.equal(literalType(primeiroToken('U"ab"', { permitirDiagnostico: true })), 'const char32_t[3]');
  assert.equal(literalType(primeiroToken('L"ab"', { permitirDiagnostico: true })), 'const wchar_t[3]');
});

// ---------------------------------------------------------------- float

test('literal de ponto flutuante sem sufixo é double', () => {
  for (const s of ['1.5', '1.', '.5', '1e3', '1E3', '1e-3', '1.5e+2', '1.e3', '0.0']) {
    assert.equal(literalType(primeiroToken(s)), 'double', s);
  }
});

test('sufixos de literal de ponto flutuante', () => {
  assert.equal(literalType(primeiroToken('1.5f')), 'float');
  assert.equal(literalType(primeiroToken('1.5F')), 'float');
  assert.equal(literalType(primeiroToken('1.0L')), 'long double');
  assert.equal(literalType(primeiroToken('1e3L')), 'long double');
});

// ---------------------------------------------------------------- inteiro

test('inteiro decimal que cabe em int é int', () => {
  for (const s of ['0', '1', '127', '128', '1000', '65535', '2147483647']) {
    assert.equal(literalType(primeiroToken(s), WASM32), 'int', s);
  }
});

test('separadores de dígito não afetam o tipo', () => {
  assert.equal(literalType(primeiroToken("1'000"), WASM32), 'int');
  assert.equal(literalType(primeiroToken("1'234'567"), WASM32), 'int');
  assert.equal(literalType(primeiroToken("0x1F'FF"), WASM32), 'int');
});

test('sufixos de inteiro sem combinação ambígua', () => {
  assert.equal(literalType(primeiroToken('7u'), WASM32), 'unsigned int');
  assert.equal(literalType(primeiroToken('7U'), WASM32), 'unsigned int');
  assert.equal(literalType(primeiroToken('7l'), WASM32), 'long');
  assert.equal(literalType(primeiroToken('7L'), WASM32), 'long');
  assert.equal(literalType(primeiroToken('7ul'), WASM32), 'unsigned long');
  assert.equal(literalType(primeiroToken('7lu'), WASM32), 'unsigned long');
  assert.equal(literalType(primeiroToken('7ll'), WASM32), 'long long');
  assert.equal(literalType(primeiroToken('7LL'), WASM32), 'long long');
  assert.equal(literalType(primeiroToken('7ull'), WASM32), 'unsigned long long');
  assert.equal(literalType(primeiroToken('7ULL'), WASM32), 'unsigned long long');
});

test('BASE DECIMAL: o valor que não cabe em int sobe para long, depois long long', () => {
  assert.equal(literalType(primeiroToken('2147483647'), WASM32), 'int');
  assert.equal(literalType(primeiroToken('2147483647L'), WASM32), 'long');
  // 2147483648 NÃO cabe em long em wasm32 (long tem 32 bits com sinal,
  // máximo 2147483647), então sobe para long long. Confirmado com g++ -m32.
  assert.equal(literalType(primeiroToken('2147483648'), WASM32), 'long long');
  assert.equal(literalType(primeiroToken('4294967295'), WASM32), 'long long');
  assert.equal(literalType(primeiroToken('2147483648L'), WASM32), 'long long');
  assert.equal(literalType(primeiroToken('2147483649L'), WASM32), 'long long');
  assert.equal(literalType(primeiroToken('9223372036854775807LL'), WASM32), 'long long');
});

test('o mesmo texto muda de tipo com o modelo de dados: 2147483648 em LP64', () => {
  // Em LP64 `long` tem 64 bits, então 2147483648 CABE em long.
  assert.equal(literalType(primeiroToken('2147483648'), LP64), 'long');
  assert.equal(literalType(primeiroToken('2147483648L'), LP64), 'long');
  // …e 4294967295 também cabe em long, mas não em int.
  assert.equal(literalType(primeiroToken('4294967295'), LP64), 'long');
  assert.equal(literalType(primeiroToken('4294967295UL'), LP64), 'unsigned long');
});

test('base decimal com sufixo u: a escada unsigned é int → long → long long', () => {
  assert.equal(literalType(primeiroToken('0u'), WASM32), 'unsigned int');
  assert.equal(literalType(primeiroToken('4294967295u'), WASM32), 'unsigned int');
  assert.equal(literalType(primeiroToken('4294967296u'), WASM32), 'unsigned long long');
  // em LP64 `unsigned long` tem 64 bits e o valor cabe
  assert.equal(literalType(primeiroToken('4294967296u'), LP64), 'unsigned long');
});

test('BASE NÃO-DECIMAL: o valor que não cabe em int vira unsigned int, não long', () => {
  // [dcl.type]p3: para hex/octal/bin o tipo começa em int e o sufixo u
  // promotes para unsigned int ANTES de qualquer promoção por tamanho.
  assert.equal(literalType(primeiroToken('0x7FFFFFFF'), WASM32), 'int');
  assert.equal(literalType(primeiroToken('0x80000000'), WASM32), 'unsigned int');
  assert.equal(literalType(primeiroToken('0xFFFFFFFF'), WASM32), 'unsigned int');
  // 0777777777 octal = 134217727, que CABE em int
  assert.equal(literalType(primeiroToken('0777777777'), WASM32), 'int');
  assert.equal(literalType(primeiroToken('0b100000000'), WASM32), 'int');
  assert.equal(literalType(primeiroToken('0b111111111'), WASM32), 'int');
});

test('base não-decimal que NÃO cabe em unsigned int sobe para long long', () => {
  // 33 bits: não cabe em unsigned int (32) nem em unsigned long (32 em wasm32)
  assert.equal(literalType(primeiroToken('0x1FFFFFFFF'), WASM32), 'long long');
  assert.equal(literalType(primeiroToken('0b100000000000000000000000000000000'), WASM32), 'long long');
  // com sufixo u explícito vai para unsigned long long
  assert.equal(literalType(primeiroToken('0x1FFFFFFFFU'), WASM32), 'unsigned long long');
});

test('base não-decimal com sufixo l/ul respeita o modelo de dados', () => {
  assert.equal(literalType(primeiroToken('0xFFUL'), WASM32), 'unsigned long');
  // em wasm32 unsigned long tem 32 bits, então 33 bits não cabe
  assert.equal(literalType(primeiroToken('0x1FFFFFFFFUL'), WASM32), 'unsigned long long');
  // em LP64 unsigned long tem 64 bits e 33 bits cabe
  assert.equal(literalType(primeiroToken('0x1FFFFFFFFUL'), LP64), 'unsigned long');
});

test('separar "-" do literal: -128 são DOIS tokens e o literal é 128', () => {
  const r = new Lexer('-128', 'lit.cpp').tokenize();
  assert.equal(r.tokens.length, 3, 'esperava -, 128, eof');
  assert.equal(r.tokens[0].type, 'operator');
  assert.equal(r.tokens[0].value, '-');
  assert.equal(r.tokens[1].literalKind, 'int');
  assert.equal(literalType(r.tokens[1], WASM32), 'int');
});

// ---------------------------------------------------------------- corpus

test('todo o corpus de literais tem o mesmo tipo que o g++ (wasm32)', () => {
  const falhas = [];
  let comparados = 0;
  for (const lit of LITERAIS) {
    if (lit.comparável === false) continue;
    comparados++;
    const t = primeiroToken(lit.fonte, { permitirDiagnostico: true });
    const obtido = literalType(t, WASM32);
    if (obtido !== lit.tipo) {
      falhas.push(`${lit.fonte}: nosso=${obtido}, g++ diz ${lit.tipo}`);
    }
  }
  assert.ok(comparados >= 150, `só ${comparados} literais comparáveis`);
  assert.deepEqual(falhas, [], `divergências com o g++:\n${falhas.join('\n')}`);
});

test('todo o corpus de literais tem o mesmo VALOR que o g++', () => {
  const falhas = [];
  for (const lit of LITERAIS) {
    if (lit.comparável === false || lit.comparaValor === false) continue;
    const t = primeiroToken(lit.fonte, { permitirDiagnostico: true });
    // O valor do g++ vem em hex byte a byte para strings (inclui o NUL
    // terminador) e em decimal para os demais.
    if (lit.grupo.startsWith('string')) {
      const nosso = [...String(t.value)]
        .map((c) => c.codePointAt(0).toString(16).padStart(2, '0').slice(-2)).join('') + '00';
      if (nosso !== lit.valorGpp) falhas.push(`${lit.fonte}: nosso=${nosso}, g++=${lit.valorGpp}`);
    } else {
      const exato = valorExato(t);
      const nosso = exato === null ? String(t.value) : exato.toString();
      const ehFloat = /^%(float|double|long double)$/.test(t.literalKind === 'float'
        ? (/[fF]$/.test(t.suffix) ? 'float' : /[lL]$/.test(t.suffix) ? 'long double' : 'double') : '');
      if (ehFloat) {
        const a = Number(lit.valorGpp); const b = Number(nosso);
        if (Math.abs(a - b) > 1e-12 * Math.max(1, Math.abs(a))) {
          falhas.push(`${lit.fonte}: nosso=${nosso}, g++=${lit.valorGpp}`);
        }
      } else if (nosso !== lit.valorGpp && Number(lit.valorGpp) !== Number(nosso)) {
        falhas.push(`${lit.fonte}: nosso=${nosso}, g++=${lit.valorGpp}`);
      }
    }
  }
  assert.deepEqual(falhas, [], `divergências de valor com o g++:\n${falhas.join('\n')}`);
});

test('valorExato devolve null para literal que não é inteiro', () => {
  assert.equal(valorExato(primeiroToken('1.5')), null);
  assert.equal(valorExato(primeiroToken("'a'")), null);
  assert.equal(valorExato(primeiroToken('"abc"')), null);
  assert.equal(valorExato(primeiroToken('a')), null);
});

test('valorExato respeita a base (BigInt não trata zero à esquerda como octal)', () => {
  assert.equal(valorExato(primeiroToken('077')), 63n);
  assert.equal(valorExato(primeiroToken('0777')), 511n);
  assert.equal(valorExato(primeiroToken('0xFF')), 255n);
  assert.equal(valorExato(primeiroToken('0b1010')), 10n);
  assert.equal(valorExato(primeiroToken('42')), 42n);
  // acima de 2^53: o Number do lexer perde precisão, o BigInt não
  assert.equal(valorExato(primeiroToken('18446744073709551615ull')),
    18446744073709551615n);
});

test('o prefixo u8 só dá char8_t a partir do C++20', () => {
  const t = primeiroToken('u8"ab"');
  assert.equal(literalType(t, { ...WASM32, std: 201703 }), 'const char[3]');
  assert.equal(literalType(t, { ...WASM32, std: 202002 }), 'const char8_t[3]');
  const c = primeiroToken("u8'a'");
  assert.equal(literalType(c, { ...WASM32, std: 201703 }), 'char');
  assert.equal(literalType(c, { ...WASM32, std: 202002 }), 'char8_t');
});

test('a vírgula NÃO faz parte do literal de ponto flutuante', () => {
  // `1,5` são três tokens (1 , 5) — a vírgula é o operador vírgula.
  const r = new Lexer('1,5', 'lit.cpp').tokenize();
  assert.equal(r.diagnostics.length, 0);
  assert.equal(r.tokens.length, 4);
  assert.equal(r.tokens[0].literalKind, 'int');
  assert.equal(r.tokens[1].value, ',');
  assert.equal(r.tokens[2].literalKind, 'int');

  // …e a vírgula não engole o ponto que vem depois: `1,.5` é 1 , 0.5
  const r2 = new Lexer('1,.5', 'lit.cpp').tokenize();
  assert.equal(r2.diagnostics.length, 0);
  assert.equal(r2.tokens.length, 4);
  assert.equal(r2.tokens[0].value, 1);
  assert.equal(r2.tokens[1].value, ',');
  assert.equal(r2.tokens[2].literalKind, 'float');
  assert.equal(r2.tokens[2].value, 0.5);
});

test('literalType nunca lança para token que não é literal', () => {
  const r = new Lexer('a + b', 'lit.cpp').tokenize();
  for (const t of r.tokens) {
    assert.doesNotThrow(() => literalType(t), `lançou em ${t.type}`);
  }
});

test('literalType de um token que não é literal devolve null', () => {
  const r = new Lexer('a + b', 'lit.cpp').tokenize();
  assert.equal(literalType(r.tokens[0]), null);
  assert.equal(literalType(r.tokens[1]), null);
});