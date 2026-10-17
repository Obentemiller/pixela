/**
 * tests/unit/source.prop.test.js — propriedades de SourceFile.
 *
 * 1. offset -> {line, column} -> offset não perde informação (5000 offsets)
 * 2. linhas com \r\n
 * 3. linhas com \ de continuação
 * 4. loc de token casa com a linha do texto
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceFile } from '../../js/cpp/source.js';
import { Lexer } from '../../js/cpp/lexer.js';

const SEED = 0x5EEDBEEF;

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

// --------------------------------------------------------------- round-trip

test('propriedade: offset -> {line,column} -> offset preserva 5000 offsets', () => {
  const rnd = prng(SEED);
  const texts = [
    'int main() { return 0; }',
    'a\nb\nc\nd\ne\nf\ng\nh\ni\nj',
    'linha1\nlinha2\nlinha3\nlinha4\nlinha5\nlinha6\nlinha7\nlinha8\n',
    '\n\n\n\n\n',
    'sem newline no fim',
    'com\r\nCRLF\r\nde\r\nnovo',
    'x'.repeat(1000),
    Array.from({ length: 50 }, (_, i) => `linha ${i} com conteúdo`).join('\n'),
  ];

  let total = 0;
  for (const text of texts) {
    const sf = new SourceFile(text, 't.cpp');
    const n = text.length;
    const passos = n <= 1 ? n + 1 : 5000;
    for (let k = 0; k < passos; k++) {
      const offset = n <= 1 ? k : Math.floor(rnd() * (n + 1));
      const loc = sf.offsetToLoc(offset);
      const volta = sf.locToOffset(loc.line, loc.column);
      assert.equal(volta, offset,
        `round-trip perdeu offset=${offset} em ${JSON.stringify(text.slice(0, 40))} (loc=${JSON.stringify(loc)})`);
      total++;
    }
  }
  console.log(`[source.prop] ${total} offsets verificados`);
});

test('propriedade: todo offset tem loc 1-based válido', () => {
  const text = 'int a;\nfloat b;\n\n// c\nchar c;\n';
  const sf = new SourceFile(text, 't.cpp');
  for (let off = 0; off <= text.length; off++) {
    const loc = sf.offsetToLoc(off);
    assert.ok(loc.line >= 1, `offset ${off}: linha ${loc.line}`);
    assert.ok(loc.column >= 1, `offset ${off}: coluna ${loc.column}`);
    assert.ok(loc.line <= text.split('\n').length,
      `offset ${off}: linha ${loc.line} acima do total`);
  }
});

test('propriedade: offset fora do texto devolve loc 0:0', () => {
  const sf = new SourceFile('abc', 't.cpp');
  assert.deepEqual(sf.offsetToLoc(-1), { line: 0, column: 0 });
  assert.deepEqual(sf.offsetToLoc(999), { line: 0, column: 0 });
});

// --------------------------------------------------------------- CRLF

test('SourceFile: linhas com \\r\\n', () => {
  const text = 'int a;\r\nint b;\r\nint c;';
  const sf = new SourceFile(text, 't.cpp');
  // \r fica no fim da linha, \n começa a próxima
  assert.deepEqual(sf.offsetToLoc(0), { line: 1, column: 1 });
  assert.deepEqual(sf.offsetToLoc(6), { line: 1, column: 7 }); // o \r
  assert.deepEqual(sf.offsetToLoc(7), { line: 1, column: 8 }); // o \n
  assert.deepEqual(sf.offsetToLoc(8), { line: 2, column: 1 }); // i de "int b"
  assert.equal(sf.getLine(2).replace('\r', ''), 'int b;');
});

test('propriedade: round-trip também vale com CRLF', () => {
  const text = 'um\r\ndois\r\ntres\r\nquatro';
  const sf = new SourceFile(text, 't.cpp');
  for (let off = 0; off <= text.length; off++) {
    const { line, column } = sf.offsetToLoc(off);
    assert.equal(sf.locToOffset(line, column), off, `CRLF: offset ${off}`);
  }
});

// --------------------------------------------------------------- continuação

test('lexer + SourceFile: barra de continuação avança a linha corretamente', () => {
  const text = 'int a = 1 + \\\n    2;\nint b;\n';
  const sf = new SourceFile(text, 't.cpp');
  const { tokens } = new Lexer(text, 't.cpp').tokenize();

  const num2 = tokens.find((t) => t.value === 2);
  assert.ok(num2, 'deveria achar o literal 2');
  assert.equal(num2.loc.line, 2, `literal 2 na linha ${num2.loc.line}, esperado 2`);

  // o offset do token aponta para o mesmo caractere que a linha do SourceFile
  const linha = sf.getLine(num2.loc.line);
  assert.equal(linha[num2.loc.column - 1], '2',
    `loc ${num2.loc.line}:${num2.loc.column} não aponta para '2' em ${JSON.stringify(linha)}`);

  const depois = tokens.find((t) => t.value === 'b');
  assert.equal(depois.loc.line, 3, `ident b na linha ${depois.loc.line}, esperado 3`);
});

test('lexer: continuação em comentário não conta linha do código seguinte', () => {
  const text = 'int a;\n// c1 \\\ncontinua\nint b;\n';
  const { tokens } = new Lexer(text, 't.cpp').tokenize();
  const b = tokens.find((t) => t.value === 'b');
  assert.equal(b.loc.line, 4, `ident b na linha ${b.loc.line}, esperado 4`);
});

// --------------------------------------------------------------- loc x texto

test('propriedade: loc de cada token aponta para seu texto no SourceFile', () => {
  const fontes = [
    'int main() {\n  int x = 42;\n  return x;\n}\n',
    'struct P { float x; float y; };\nvoid move(P p) { p.x += 1; }\n',
    '// comentário\n/* bloco */\nint z; // fim\n',
    'char c = \'a\';\nconst char* s = "texto";\n',
    '#include <vector>\nstd::vector<int> v;\n',
  ];
  let total = 0;
  for (const text of fontes) {
    const sf = new SourceFile(text, 't.cpp');
    const { tokens } = new Lexer(text, 't.cpp').tokenize();
    for (const t of tokens) {
      if (t.type === 'eof') continue;
      const esperado = t.text;
      const pos = sf.locToOffset(t.loc.line, t.loc.column);
      const lido = text.slice(pos, pos + esperado.length);
      assert.equal(lido, esperado,
        `token ${t.type}:${JSON.stringify(esperado)} em ${t.loc.line}:${t.loc.column}, ` +
        `mas o texto lá é ${JSON.stringify(lido)}`);
      total++;
    }
  }
  console.log(`[source.prop] ${total} tokens com loc verificados contra o texto`);
});