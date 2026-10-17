import test from 'node:test';
import assert from 'node:assert/strict';
import { Namespace, ScopeManager, Symbol } from '../../js/cpp/scope.js';

test('Namespace: insert + lookup devolvem o mesmo símbolo', () => {
  const ns = new Namespace('global');
  const sym = new Symbol('x', 'int');
  ns.insert(sym);
  assert.equal(ns.lookup('x'), sym);
});

test('Namespace: lookup de símbolo inexistente devolve null', () => {
  const ns = new Namespace('global');
  assert.equal(ns.lookup('nao_existe'), null);
});

test('Symbol: guarda nome e tipo', () => {
  const s = new Symbol('x', 'int');
  assert.equal(s.name, 'x');
  assert.equal(s.type, 'int');
  assert.equal(s.isConst, false);
  assert.equal(s.isStatic, false);
});

test('ScopeManager: enterScope/exitScope empilham e desempilham', () => {
  const m = new ScopeManager(new Namespace('global'));
  const antes = m.scopes ? m.scopes.length : null;
  m.enterScope();
  const dentro = m.scopes ? m.scopes.length : null;
  m.exitScope();
  const depois = m.scopes ? m.scopes.length : null;
  assert.equal(dentro, antes + 1, 'enterScope deveria criar um escopo');
  assert.equal(depois, antes, 'exitScope deveria remover');
});

test('ScopeManager: declareVariable + lookupIdent', () => {
  const m = new ScopeManager(new Namespace('global'));
  m.enterScope();
  m.declareVariable('x', 'int');
  assert.ok(m.isDeclared('x'), 'isDeclared(x) deveria ser verdadeiro');
  assert.ok(m.lookupIdent('x'), 'lookupIdent(x) deveria achar');
  m.exitScope();
});