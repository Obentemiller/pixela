/**
 * tests/conceito/t1/corpus.test.mjs — o corpus tem de ser UNICO e ESTAVEL.
 *
 * Ambos os bugs do harness apareceram daqui, nao do parser:
 *
 *   1. nomes duplicados -> tres casos escreviam no mesmo ficheiro tmp e
 *      corriam umarace sob paralelismo; o g++ lia o conteudo de outro caso;
 *      duas execucoes davam sha256 diferentes;
 *   2. o gramatical era gerado por `Math.random` implicito na ordem de
 *      leitura de diretorio, entao nao era reproduzivel.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { gerarMutacoes, fontesValidas, nomeDeToken } from './corpus-mutacao.mjs';
import { gerarGramatica, prng, PREAMBULO } from './corpus-gramatica.mjs';

test('T1-E2-01: os nomes do corpus de mutacao sao UNICOS', () => {
  const casos = gerarMutacoes();
  const vistos = new Set();
  const dups = [];
  for (const c of casos) {
    if (vistos.has(c.nome)) dups.push(c.nome);
    vistos.add(c.nome);
  }
  assert.equal(dups.length, 0,
    `${dups.length} nomes duplicados (ex.: ${dups.slice(0, 3).join(', ')}) — dois casos com o mesmo nome escrevem no mesmo ficheiro tmp`);
  assert.ok(casos.length > 3000, `corpus pequeno demais: ${casos.length}`);
});

test('T1-E2-02: nomeDeToken distingue pontuacao que se apagaria', () => {
  // `;`, `,` e `*` viravam todos '' com replace(/[^\w]/g,'').
  const tres = [';', ',', '*'].map(nomeDeToken);
  assert.equal(new Set(tres).size, 3, `colidiram: ${tres.join(' ')}`);
  assert.ok(tres.every((t) => /^[0-9a-f]+$/.test(t)), `nao e seguro para nome de ficheiro: ${tres.join(' ')}`);
  assert.equal(nomeDeToken('::'), '3a3a');
});

test('T1-E2-03: o corpus de mutacao cobre as quatro operacoes', () => {
  const casos = gerarMutacoes();
  const ops = new Set(casos.map((c) => c.op));
  for (const op of ['apagar', 'trocar', 'duplicar', 'inserir']) {
    assert.ok(ops.has(op), `falta a operacao ${op}`);
  }
});

test('T1-E2-04: o corpus de mutacao parte das 120 parse-valid', () => {
  const f = fontesValidas();
  assert.equal(f.length, 120, `esperava 120 fixtures, achei ${f.length}`);
  const bases = new Set(gerarMutacoes().map((c) => c.base));
  assert.equal(bases.size, 120, `as 120 fixtures nem todas foram mutadas: ${bases.size}`);
});

test('T1-E2-05: o corpus gramatical e REPRODUZIVEL com a mesma semente', () => {
  const a = gerarGramatica(200, 20261016);
  const b = gerarGramatica(200, 20261016);
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'mesma semente, corpus diferente');
});

test('T1-E2-06: semente diferente produz corpus diferente (a semente manda)', () => {
  const a = gerarGramatica(200, 1);
  const b = gerarGramatica(200, 2);
  assert.notEqual(JSON.stringify(a), JSON.stringify(b));
});

test('T1-E2-07: os nomes do corpus gramatical sao UNICOS', () => {
  const casos = gerarGramatica(3000, 20261016);
  assert.equal(new Set(casos.map((c) => c.nome)).size, casos.length, 'nomes duplicados');
});

test('T1-E2-08: o preambulo declara os tipos, para o veredito ser SINTATICO', () => {
  // Sem isto o g++ responde `does not name a type`, que e SEMANTICO, e a
  // quadrante "nos rejeitamos / g++ aceita" viraria ruido.
  for (const t of ['struct A', 'struct B', 'struct C', 'typedef int I', 'typedef unsigned U',
    'template<class T> struct T1', 'template<class T, int N> struct T2',
    'template<class T, class U> struct T3', 'using Alias']) {
    assert.ok(PREAMBULO.includes(t), `o preambulo nao declara \`${t}\``);
  }
});

test('T1-E2-09: o gramatical cobre template-com-default e `>` como comparacao', () => {
  const casos = gerarGramatica(3000, 20261016);
  const comDefault = casos.filter((c) => /template<[^>]*=/.test(c.regra)).length;
  const comComparacao = casos.filter((c) => c.regra.includes('>') && c.regra.includes('(')).length;
  assert.ok(comDefault > 500, `poucos casos com default de template: ${comDefault}`);
  assert.ok(comComparacao > 50, `poucos casos com \`>\` dentro de parenteses: ${comComparacao}`);
});

test('T1-E2-10: o PRNG e reprodutivel (mulberry32)', () => {
  const a = prng(42); const b = prng(42);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
});
