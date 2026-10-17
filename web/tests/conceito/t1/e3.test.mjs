/**
 * tests/conceito/t1/e3.test.mjs — a classificacao tem de ser AUDITAVEL.
 *
 * A regra que decide o que e bug: so conta `ACEITACAO-SILENCIOSA` quando o
 * g++ rejeita por SINTATICA. Contar semantico acusaria o parser de um bug de
 * Sema que ele nao tem.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { classificaGpp, classificaCaso, ROTULOS } from './e3-classificar.mjs';

test('T1-E3-01: "expected X before Y" e SINTATICO', () => {
  for (const m of [
    'expected unqualified-id before ‘,’ token',
    'expected primary-expression before X token',
    'expected type-specifier before ‘>’ token',
    'expected unqualified-id at end of input',
    'expected identifier before ‘int’ token',
  ]) {
    assert.equal(classificaGpp(m, false), 'rejeita-sintatico', `classificou errado: ${m}`);
  }
});

test('T1-E3-02: "does not name a type" e SEMANTICO', () => {
  for (const m of [
    '‘T’ does not name a type',
    '‘vector’ in namespace ‘std’ does not name a template type',
    '‘x’ was not declared in this scope',
    '‘min’ is not a member of ‘std’',
  ]) {
    assert.equal(classificaGpp(m, false), 'rejeita-semantico', `classificou errado: ${m}`);
  }
});

test('T1-E3-03: a regra do ISO C++ (o typo C\\+ em vez de C\\+\\+)', () => {
  // 660 dos 24 971 casos dependem desta regra. Com `C\\+` ela nunca disparava
  // e 660 casos ficavam no balde de padrao desconhecido.
  const m = 'ISO C++ forbids declaration of ‘p’ with no type [-fpermissive]';
  assert.equal(classificaGpp(m, false), 'rejeita-semantico');
});

test('T1-E3-04: exit 0 e ACEITA, sem consulta a mensagem', () => {
  assert.equal(classificaGpp(null, true), 'aceita');
  assert.equal(classificaGpp('qualquer coisa', true), 'aceita');
});

test('T1-E3-05: mensagem desconhecida vai para INDETERMINADO, nunca para bug', () => {
  assert.equal(classificaGpp('mensagem que nao existe em nenhuma lista', false), 'indeterminado');
  const q = classificaCaso({
    nOk: true, gOk: false, gMsg: 'mensagem que nao existe em nenhuma lista',
    gTimeout: false, nLancou: false, gErro1: 'x: error: mensagem',
  });
  assert.equal(q, 'indeterminado-padrao-desconhecido');
  assert.equal(ROTULOS[q].bug, false, 'indeterminado NUNCA pode contar como bug');
});

test('T1-E3-06: rejeitar algo so-semantico NAO e aceitacao silenciosa', () => {
  const q = classificaCaso({
    nOk: false, gOk: false, gMsg: '‘T’ does not name a type',
    gTimeout: false, nLancou: false, gErro1: 'x: error: ...',
  });
  assert.equal(q, 'indeterminado-rejeita-semantico');
  assert.equal(ROTULOS[q].bug, false);
});

test('T1-E3-07: os quatro quadrantes principais', () => {
  const base = { gTimeout: false, nLancou: false, gErro1: null };
  const ambosAceitam = classificaCaso({ ...base, nOk: true, gOk: true, gMsg: null });
  const aceitacaoSilenciosa = classificaCaso({ ...base, nOk: true, gOk: false, gMsg: 'expected unqualified-id before ‘;’ token' });
  const ambosRejeitam = classificaCaso({ ...base, nOk: false, gOk: false, gMsg: 'expected unqualified-id before ‘;’ token' });
  const falsaRejeicao = classificaCaso({ ...base, nOk: false, gOk: true, gMsg: null });
  assert.equal(ambosAceitam, 'ambos-aceitam');
  assert.equal(aceitacaoSilenciosa, 'ACEITACAO-SILENCIOSA');
  assert.equal(ambosRejeitam, 'ambos-rejeitam');
  assert.equal(falsaRejeicao, 'FALSA-REJEICAO');
  // so estes dois sao bug
  assert.equal(ROTULOS[aceitacaoSilenciosa].bug, true);
  assert.equal(ROTULOS[falsaRejeicao].bug, true);
  assert.equal(ROTULOS[ambosAceitam].bug, false);
  assert.equal(ROTULOS[ambosRejeitam].bug, false);
});

test('T1-E3-08: as guardas de infra entram antes de qualquer quadrante', () => {
  const base = { nOk: true, gOk: false, gMsg: 'expected X before Y' };
  assert.equal(classificaCaso({ ...base, gTimeout: true }), 'indeterminado-timeout');
  assert.equal(classificaCaso({ ...base, nLancou: true }), 'indeterminado-excecao-nosso');
  // o bug do `.cpp` ausente: o g++ nao leu, o veredito nao vale nada
  assert.equal(classificaCaso({ ...base, gErro1: 'x: warning: linker input file unused because linking not done' }),
    'indeterminado-gpp-nao-leu');
});

test('T1-E3-09: todo quadrante tem rotulo (nenhum caso cai sem nome)', () => {
  const base = { gTimeout: false, nLancou: false, gErro1: null };
  for (const nOk of [true, false]) for (const gOk of [true, false]) {
    const q = classificaCaso({ ...base, nOk, gOk, gMsg: gOk ? null : 'expected X before Y' });
    assert.ok(ROTULOS[q], `quadrante sem rotulo: ${q}`);
  }
});
