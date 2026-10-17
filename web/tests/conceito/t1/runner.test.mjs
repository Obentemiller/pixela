/**
 * tests/conceito/t1/runner.test.mjs — o runner se prova antes de gerar corpus.
 *
 * Um runner errado produz um relatorio errado com muita autoridade. Estes
 * casos usam construcoes cujo veredito do g++ CONHECEMOS, para confirmar que
 * o runner le o mesmo que o g++ le.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { julgar, versoes, limpaTmp } from './runner.mjs';

test('T1-E1-01: runner le um fonte VALIDO pelos dois lados', async () => {
  const r = await julgar('int f(int a) { return a; }\n');
  assert.equal(r.nosso.ok, true, `nosso: ${r.nosso.erro1}`);
  assert.equal(r.gpp.ok, true, `g++: ${r.gpp.erro1}`);
});

test('T1-E1-02: runner le um fonte INVALIDO pelos dois lados', async () => {
  const r = await julgar('int f(int a) { return ;;; ] }\n');
  assert.equal(r.nosso.ok, false, 'nosso tinha de acusar');
  assert.equal(r.gpp.ok, false, 'g++ tinha de acusar');
  assert.ok(r.gpp.erro1, 'o g++ tem de devolver a PRIMEIRA LINHA de erro (dado cru)');
});

test('T1-E1-03: dado CRUD primeiro — o erro1 do g++ nao vem interpretado', async () => {
  const r = await julgar('struct O { int x; }; extern O cout;\n');
  assert.equal(r.gpp.ok, true, 'o g++ aceita isto');
  assert.equal(r.gpp.erro1, null, 'sem erro nao ha linha de erro');
  // classify() e E3: aqui so se verifica que a materia-prima esta la.
  assert.ok('exit' in r.gpp, 'o exit do g++ tem de estar no dado cru');
});

test('T1-E1-04: a armadilha do `.tokens` esta contornada', async () => {
  // Se o runner passasse o OBJETO `{tokens, diagnostics}` ao Parser, a AST
  // sairia VAZIA com ZERO diagnosticos — e um fonte claramente invalido
  // passaria por limpo, em silencio.
  //
  // A sonda tem de ser um fonte que o parser REJEITA DE FACTO. A primeira
  // escolha foi `int x = [1];` e falhou: o parser aceita isso (e o g++ nao) —
  // e o bug S7(d) `19-inv-colchete-fechando`, exatamente o que o T1 existe
  // para medir. Uma sonda que mede um bug conhecido nao mede a armadilha.
  // `int;` da 1 erro medido (`declaracaoTopo` -> EmptyDecl -> erro).
  const r = await julgar('int;\n');
  assert.equal(r.nosso.ok, false,
    'fonte invalida aceite: a armadilha do `.tokens` voltou');
  assert.ok(r.nosso.nErros >= 1, `esperava >=1 erro, veio ${r.nosso.nErros}`);
});

test('T1-E1-05: versoes do oraculo sao registadas (regra 3)', () => {
  const v = versoes();
  assert.match(v.gpp, /g\+\+/, `gpp = ${v.gpp}`);
  assert.match(v.node, /^v\d+/, `node = ${v.node}`);
  assert.ok(v.plataforma);
});

test('T1-E1-06: o g++ CHEGA A Ler o fonte (extensao .cpp no disco)', async () => {
  // Regressao do proprio harness, escrita depois de acontecer: `julgar()`
  // escrevia o fonte SEM extensao, o g++ nao reconhecia a linguagem e
  // respondia `linker input file unused because linking not done` com exit 0.
  // Em 20 717 de 24 971 casos o g++ NUNCA compilou nada e o veredito "aceita"
  // era mentira. Duas execucoes davam sha256 diferentes por causa do caminho
  // temporario no stderr.
  const r = await julgar('struct O { int x; }; O;\n', 'sem-extensao');
  assert.equal(r.gpp.analisou, true,
    `o g++ nao leu o fonte: ${r.gpp.stderr}`);
  assert.equal(r.gpp.ok, false,
    '`O;` sem nome e invalido: o g++ tinha de acusar');
  assert.ok(r.gpp.erro1, 'tem de haver uma linha de erro — um exit 0 sem diagnostico nao prova nada');
});

test('T1-E1-07: o dado CRU nao leva o caminho temporario (reprodutibilidade, regra 3)', async () => {
  const a = await julgar('int;\n', 'repro-a');
  const b = await julgar('int;\n', 'repro-a');
  assert.equal(a.gpp.erro1, b.gpp.erro1,
    `o erro1 mudou entre execucoes:\n  A: ${a.gpp.erro1}\n  B: ${b.gpp.erro1}`);
  assert.ok(!/\/tmp\//.test(String(a.gpp.stderr)),
    `o stderr ainda leva caminho temporario: ${a.gpp.stderr}`);
});

test.after(() => limpaTmp());
