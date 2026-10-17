import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceFile } from '../../js/cpp/source.js';

test('SourceFile: guarda texto e nome de arquivo', () => {
  const sf = new SourceFile('int a = 1;\nint b = 2;\n', 't.cpp');
  assert.equal(sf.text, 'int a = 1;\nint b = 2;\n');
  assert.equal(sf.name, 't.cpp');
});

test('SourceFile: offsetToLoc mapeia offset para linha/coluna', () => {
  const sf = new SourceFile('abc\ndefgh\nij', 't.cpp');
  assert.deepEqual(sf.offsetToLoc(0), { line: 1, column: 1 });
  assert.deepEqual(sf.offsetToLoc(4), { line: 2, column: 1 });
  assert.deepEqual(sf.offsetToLoc(10), { line: 3, column: 1 });
  // o próprio '\n' pertence à linha que ele termina
  assert.deepEqual(sf.offsetToLoc(3), { line: 1, column: 4 });
  assert.deepEqual(sf.offsetToLoc(9), { line: 2, column: 6 });
});

test('SourceFile: locToOffset é inverso de offsetToLoc', () => {
  const sf = new SourceFile('abc\ndefgh\nij', 't.cpp');
  for (const off of [0, 2, 4, 7, 9, 10]) {
    const { line, column } = sf.offsetToLoc(off);
    assert.equal(sf.locToOffset(line, column), off, `offset ${off}`);
  }
});

test('SourceFile: getLine devolve a linha (1-based)', () => {
  const sf = new SourceFile('abc\ndefgh\nij', 't.cpp');
  assert.equal(sf.getLine(1), 'abc');
  assert.equal(sf.getLine(2), 'defgh');
  assert.equal(sf.getLine(3), 'ij');
  assert.equal(sf.getLine(99), '');
});