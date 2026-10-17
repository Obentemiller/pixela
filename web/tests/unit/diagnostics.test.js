import test from 'node:test';
import assert from 'node:assert/strict';
import { Diagnostic, ErrorCodes } from '../../js/cpp/diagnostics.js';

test('Diagnostic: guarda severidade, código, mensagem e loc', () => {
  const d = new Diagnostic('error', 'E0101', 'mensagem', { line: 3, column: 7 });
  assert.equal(d.severity, 'error');
  assert.equal(d.code, 'E0101');
  assert.equal(d.message, 'mensagem');
  assert.deepEqual(d.loc, { line: 3, column: 7 });
});

test('ErrorCodes: códigos são strings sem espaços', () => {
  for (const [nome, codigo] of Object.entries(ErrorCodes)) {
    assert.equal(typeof codigo, 'string', `${nome} não é string`);
    assert.equal(codigo.trim(), codigo, `${nome} tem espaço nas bordas: "${codigo}"`);
    assert.match(codigo, /^[A-Z][0-9]+$/, `${nome} fora do formato: "${codigo}"`);
  }
});

test('ErrorCodes: possui os códigos esperados do compilador', () => {
  for (const nome of ['UNEXPECTED_TOKEN', 'EXPECTED_SEMICOLON', 'UNDECLARED_IDENTIFIER', 'TYPE_MISMATCH']) {
    assert.ok(nome in ErrorCodes, `falta ErrorCodes.${nome}`);
  }
});