#!/usr/bin/env node
/**
 * gen-literais.mjs — gera a LISTA de literais C++ do diferencial.
 *
 * IMPORTANTE: este script NÃO escreve o tipo esperado. Nas primeiras versões
 * o tipo era calculado por heurística dentro do gerador, e a heurística
 * errou em pelo menos 5 casos (2147483648, 4294967295, 0x80000000,
 * 0777777777, os char, que eu anotava como `int` em vez de `char`).
 * O tipo esperado é o que o g++ diz — `diff-lexer.mjs` calibra e grava
 * `tests/fixtures/literais.json` com o veredito do compilador.
 *
 * Cada entrada é { grupo, fonte, nota? } onde `fonte` é o texto exato do
 * literal em código C++.
 *
 * Uso: node tests/tools/gen-literais.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const L = [];
const add = (grupo, fonte, opts = {}) => L.push({ grupo, fonte, tipo: null, ...opts });

// --------------------------------------------------------------- decimais
// Sem sufixo: primeiro tipo que comporta o valor. O tipo real é calibrado
// pelo g++ — aqui só decidimos o texto do literal.
for (const v of ['0', '1', '7', '9', '10', '42', '100', '255', '256', '1000',
  '1023', '1024', '32767', '32768', '65535', '65536', '2147483647',
  '2147483648L', '2147483649L', '2147483648', '4294967295']) {
  add('decimal', v);
}
add('decimal', '9223372036854775807LL');

// --------------------------------------------------------------- hexadecimais
for (const v of ['0x0', '0x1', '0xF', '0x1F', '0xFF', '0x100', '0xFFFF',
  '0x7FFFFFFF', '0x80000000', '0xFFFFFFFF', '0x1FFFFFFFF']) {
  add('hex', v);
}
add('hex', '0xFFFFFFFFU');
add('hex', '0x1FFFFFFFFU');

// --------------------------------------------------------------- octais
for (const v of ['00', '01', '07', '010', '077', '0777', '07777777', '0777777777']) {
  add('octal', v);
}

// --------------------------------------------------------------- binários
for (const v of ['0b0', '0b1', '0b10', '0b1010', '0b11111111',
  '0b100000000', '0b11111111111111111111111111111111',
  '0b100000000000000000000000000000000']) {
  add('binario', v);
}

// --------------------------------------------------------------- separadores
add('separador', "1'000");
add('separador', "1'234'567");
add('separador', "0x1F'FF");
add('separador', "0b1010'1010");
add('separador', "1'0'0'0");

// --------------------------------------------------------------- sufixos
for (const v of ['7u', '7U', '7l', '7L', '7ul', '7UL', '7lu', '7LU',
  '7ll', '7LL', '7ull', '7ULL', '0u', '0U']) {
  add('sufixo', v);
}

// --------------------------------------------------------------- flutuantes
for (const v of ['1.5', '0.5', '1.', '3.14159', '1e3', '1E3', '1e-3', '1.5e+2',
  '1.e3', '.5', '0.1', '0.001', '12345.6789', '1.5e0', '9.99e2', '0e0',
  '100.0', '3.0f', '0.5F', '2.25e-2', '1e100', '1e-100',
  '1234567890.123456', '0.125', '255.0', '0.0', '2.718281828',
  '1e10', '1e-10']) {
  add('float', v);
}
for (const v of ['1.5f', '1.5F', '1.0L', '1e3L', '7.0L']) {
  add('float-sufixo', v);
}

// --------------------------------------------------------------- char
// O tipo de um char literal sem prefixo é `char`, NÃO `int` (verificado).
add('char', "'A'");
add('char', "'a'");
add('char', "'0'");
add('char', "' '");
add('char', "'\\n'");
add('char', "'\\t'");
add('char', "'\\r'");
add('char', "'\\0'");
add('char', "'\\a'");
add('char', "'\\b'");
add('char', "'\\f'");
add('char', "'\\v'");
add('char', "'\\\\'");
add('char', "'\\''");
add('char', "'\"'");
add('char', "'?'");
add('char', "'\\x41'");
add('char', "'\\101'");
add('char', "'~'");
add('char', "'@'");
add('char', "'`'");
add('char', "'_'");
add('char', "'+'");
add('char', "'='");
add('char', "'{'");
add('char', "'|'");
add('char', "'}'");
add('char', "'\\x7A'");
add('char', "'\\x30'");
add('char', "'\\177'");

// char literals com prefixo: u8/u/U/L mudam o TIPO do token.
add('char-prefixo', "u8'a'");
add('char-prefixo', "u'a'");
add('char-prefixo', "U'a'");
add('char-prefixo', "L'a'");
add('char-prefixo', "L'\\n'");

// --------------------------------------------------------------- strings
// O tipo é `const char[N+1]`; N é o comprimento depois dos escapes.
for (const v of ['"abc"', '""', '"a b"', '"a\\nb"', '"a\\tb"', '"a\\\\b"',
  '"\\x41"', '"\\101"', '"ola mundo"', '"\\r\\n"', '"\\0"', '"\\b\\f"',
  '"\\v\\a"', '"\\"aspas\\""', '"\\\\\\\\"', '"aAbBcC"', '"0123456789"',
  '"espaco no meio"', '"tab\\there"', '"\\x7A\\x7A"']) {
  add('string', v);
}
add('string-prefixo', 'u8"ab"');
add('string-prefixo', 'u"ab"');
add('string-prefixo', 'U"ab"');
add('string-prefixo', 'L"ab"');

// --------------------------------------------------------------- combinações
// Literais que misturam base e sufixo — a combinação mais frágil do lexer.
for (const v of ['0x0u', '0xFFu', '0xFFFFFFFFUL', '010u', '077L', '0b1111u',
  "0xFF'FFu", "1'0UL", '42ull', '42llu', '5uL', '0xFFUL',
  '4294967296u', '2147483647U', '2147483648u', '9223372036854775807u',
  '18446744073709551615ull', '0x1FFFFFFFFUL']) {
  add('combinacao', v);
}

// --------------------------------------------------------------- valores-limite
for (const v of ['127', '128', '0x7fffffff', '2147483648LL', '4294967295LL',
  '0b1111111111111111111111111111111',
  '0b10000000000000000000000000000000',
  '0b111111111111111111111111111111111']) {
  add('limite', v);
}

// Um `-` antes de um literal é o operador unário de menos, não parte do
// literal. `-128` são DOIS tokens. O g++ avalia a EXPRESSÃO -128, que tem
// tipo int e valor -128; o literal 128 também é int. Coberto por teste
// dedicado, fora do comparador de tipo.
add('operador-unario', '-128', {
  nota: 'o sinal é o operador unário de menos; o literal é 128 (int)',
});

// A vírgula NÃO é parte do literal de ponto flutuante: `1,5` são 3 tokens
// (1 , 5) e o programa `auto v = 1,5` nem compila. Coberto por teste
// dedicado, fora do comparador de tipo.
add('float-virgula', '1,5', {
  nota: 'em C++ a vírgula é o operador vírgula; não existe literal "1,5"',
});

// --------------------------------------------------------------- verificação
const duplicados = new Map();
for (const l of L) {
  const k = `${l.fonte}`;
  if (duplicados.has(k)) {
    console.error(`[gen-literais] DUPLICADO: ${JSON.stringify(l.fonte)} — ` +
      `grupos ${duplicados.get(k)} e ${l.grupo}`);
    process.exitCode = 1;
  }
  duplicados.set(k, l.grupo);
}

const destino = join(RAIZ, 'tests', 'fixtures', 'literais-lista.json');
mkdirSync(dirname(destino), { recursive: true });
writeFileSync(destino, JSON.stringify(L, null, 2) + '\n');

const porGrupo = {};
for (const l of L) porGrupo[l.grupo] = (porGrupo[l.grupo] ?? 0) + 1;

console.log(`[gen-literais] ${L.length} literais em ${Object.entries(porGrupo).map(([g, n]) => `${g}:${n}`).join(', ')}`);
console.log(`[gen-literais] lista sem tipo: tests/fixtures/literais-lista.json`);
console.log(`[gen-literais] o tipo é calibrado por tests/tools/diff-lexer.mjs (g++ -m32)`);

if (L.length < 150) {
  console.error(`[gen-literais] só ${L.length} literais, exigido >= 150`);
  process.exitCode = 1;
}