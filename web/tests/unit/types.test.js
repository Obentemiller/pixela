import test from 'node:test';
import assert from 'node:assert/strict';
import { Type, cppTypeToJS, rankOverloadConversion } from '../../js/cpp/types.js';

test('Type: guarda nome e sinal', () => {
  const t = new Type('int');
  assert.equal(t.name, 'int');
  assert.equal(t.isSigned, true);
  assert.equal(t.isPointer, false);
});

test('Type: getters estáticos devolvem tipos de 32/64 bits', () => {
  assert.equal(Type.int32.name, 'int');
  assert.equal(Type.int32.size, 32);
  assert.equal(Type.int64.name, 'long long');
  assert.equal(Type.int64.size, 64);
  assert.equal(Type.void_.name, 'void');
  assert.equal(Type.void_.size, 0);
});

test('cppTypeToJS: mapeia tipos primitivos (bug do getter corrigido)', () => {
  // A API devolve um Type, não uma string.
  assert.equal(cppTypeToJS('int').name, 'int');
  assert.equal(cppTypeToJS('double').name, 'double');
  assert.equal(cppTypeToJS('bool').name, 'bool');
  assert.equal(cppTypeToJS('void').name, 'void');
});

test('cppTypeToJS: tipo desconhecido cai no default int', () => {
  assert.equal(cppTypeToJS('TipoQueNaoExiste').name, 'int');
});

test('rankOverloadConversion: é função exportada', () => {
  assert.equal(typeof rankOverloadConversion, 'function');
});