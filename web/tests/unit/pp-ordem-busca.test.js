/**
 * tests/unit/pp-ordem-busca.test.js — R2: a ordem de busca de `#include`.
 *
 * A ordem §4/A1 da fase A1 prescreve:
 *
 *   `#include "x"`  → includeDirs? NÃO. diretório do INCLUDER primeiro.
 *   `#include <x>`  → includeDirs (o `-I`) ANTES do diretório do includer.
 *
 * E o caminho canônico é a identidade do header: `pragma once`, include guard
 * e detecção de ciclo precisam reconhecer `a/../h.h` e `h.h` como o MESMO
 * arquivo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Preprocessor, resolve } from '../../js/cpp/preprocessor.js';

/**
 * Compila `src` com o nome `como` do arquivo principal. O nome importa: é
 * ele que diz ao pré-processador de onde vem um `#include "x"`.
 */
const compila = (src, includes, opts = {}, como = 'main.cpp') =>
  new Preprocessor({ includes, ...opts }).process(src, como);

// ------------------------------------------------ (a) assinatura e ordem

test('R2-a: `resolve(includerPath, spec, isAngle)` é a assinatura', () => {
  assert.equal(typeof resolve, 'function');
  assert.equal(resolve.length, 2, 'isAngle tem valor padrão, então length conta os obrigatórios');
  // `isAngle` não muda o cálculo — o que muda é QUEM é procurado primeiro.
  assert.equal(resolve('src/examples/mesh3d.cpp', '../pixela.hpp', false), 'src/pixela.hpp');
  assert.equal(resolve('src/examples/mesh3d.cpp', '../pixela.hpp', true), 'src/pixela.hpp');
});

test('R2-a: "x" procura o diretório do INCLUDER antes da raiz', () => {
  // Mesmo nome em dois lugares: o do includer tem de ganhar.
  const inc = {
    'src/mod/util.hpp': 'int V = 1;\n',
    'util.hpp': 'int V = 2;\n',
  };
  const src = '#include "util.hpp"\nint f() { return V; }\n';
  const pp = compila(src, inc, {}, 'src/mod/main.cpp');
  assert.ok(!/não encontrado/.test(pp.diagnostics.map((d) => d.message).join('')),
    'o include não deveria falhar');
  assert.ok(pp.text.includes('int V = 1'), 'tem de usar o util.hpp do INCLUDER (src/mod), não o da raiz');
  assert.ok(!pp.text.includes('int V = 2'), 'o util.hpp da raiz não deveria entrar');
});

test('R2-a: <x> procura includeDirs ANTES do diretório do includer', () => {
  const inc = {
    'src/mod/sist.hpp': 'int S = 1;\n', // do includer
    'externo/sist.hpp': 'int S = 2;\n', // do -I
  };
  const src = '#include <sist.hpp>\nint f() { return S; }\n';
  const semI = compila(src, inc, {}, 'src/mod/main.cpp');
  assert.ok(semI.text.includes('int S = 1'), 'sem includeDirs, <x> cai no includer');

  const comI = compila(src, inc, { includeDirs: ['externo'] }, 'src/mod/main.cpp');
  assert.ok(comI.text.includes('int S = 2'), 'com includeDirs=[externo], <x> tem de pegar o -I');
  assert.ok(!comI.text.includes('int S = 1'), 'o do includer não deveria ganhar de <x>');
});

test('R2-a: a ordem dos includeDirs importa (o primeiro vence)', () => {
  const inc = { 'um/s.hpp': 'int S = 1;\n', 'dois/s.hpp': 'int S = 2;\n' };
  const pp = compila('#include <s.hpp>\n', inc, { includeDirs: ['um', 'dois'] });
  assert.ok(pp.text.includes('int S = 1'));
  const pp2 = compila('#include <s.hpp>\n', inc, { includeDirs: ['dois', 'um'] });
  assert.ok(pp2.text.includes('int S = 2'));
});

test('R2-a: o header virtual de sistema entra por ÚLTIMO (R6)', () => {
  // Este teste afirmava a ordem antiga ("virtual tem precedência sobre tudo"),
  // que está ERRADA pela ordem normativa: `"x"` -> diretório do includer ->
  // `includeDirs` -> virtual; `<x>` -> `includeDirs` -> virtual. Um header
  // virtual é um STUB do que o projeto tem em `src/`; se vier primeiro, um
  // `#include "pixela.hpp"` do bridge resolve para `int pix_width()` em vez
  // de `src/pixela.hpp`, e `class Canvas` nunca chega ao parser.
  //
  // O teste agora fixa a ordem CORRETA nos dois sentidos.
  const inc = { 'raiz/vector': 'int DO_DISCO = 1;\n' };
  // (1) existe arquivo no disco com o nome -> o disco vence
  const comDisco = compila('#include <vector>\n', inc, { includeDirs: ['raiz'] });
  assert.ok(comDisco.text.includes('DO_DISCO'),
    `com includeDirs apontando para o arquivo, o disco tem de vencer; veio: ${comDisco.text.slice(0, 160)}`);
  // (2) não existe nada no disco -> o virtual entra
  const semDisco = compila('#include <vector>\n', {});
  assert.ok(/struct\s+vector/.test(semDisco.text), 'sem nada no disco, o prelúdio declarado tem de entrar');
});

// ------------------------------------------------ (b) caminho canônico é a identidade

test('R2-b: pragma once reconhece o mesmo arquivo por duas grafias', () => {
  const inc = {
    'h.h': '#pragma once\nint H = 1;\n',
    'a/../h.h': 'IGNORADO\n', // mesma chave, outra grafia
  };
  const src = '#include "a/../h.h"\n#include "h.h"\n';
  const pp = compila(src, inc);
  const n = (pp.text.match(/int H = 1/g) || []).length;
  assert.equal(n, 1, `o header entrou ${n}x; com pragma once tem de entrar 1x`);
});

test('R2-b: ciclo é detectado pelo caminho canônico, não pela grafia', () => {
  const inc = {
    'a.h': '#include "sub/../a.h"\nint A = 1;\n',
  };
  const pp = compila('#include "a.h"\n', inc);
  const msg = pp.diagnostics.map((d) => d.message).join(' | ');
  assert.ok(/circular/i.test(msg), `esperava 'circular', veio: ${msg}`);
  assert.ok(msg.includes('a.h'), `a cadeia tem de trazer o caminho canonico: ${msg}`);
});

test('R2-b: __FILE__ devolve o caminho canônico, não a grafia escrita', () => {
  const inc = { 'h.h': 'const char* F = __FILE__;\n' };
  const pp = compila('#include "a/../h.h"\n', inc);
  assert.ok(pp.text.includes('"h.h"'), `__FILE__ deveria ser o canonico; veio: ${pp.text.trim()}`);
  assert.ok(!pp.text.includes('"a/../h.h"'), '__FILE__ nao pode ser a grafia escrita');
});

test('R2-b: include guard também é pela identidade canônica', () => {
  const guard = '#ifndef G_H\n#define G_H\nint G = 1;\n#endif\n';
  const inc = { 'g.h': guard, 'a/../g.h': 'IGNORADO\n' };
  const pp = compila('#include "a/../g.h"\n#include "g.h"\n', inc);
  const n = (pp.text.match(/int G = 1/g) || []).length;
  assert.equal(n, 1, `o guard não segurou: entrou ${n}x`);
});

// ------------------------------------------------ (c) includeDirs existe

test('R2-c: `includeDirs` é lido do construtor e aceito como array', () => {
  const pp = new Preprocessor({ includeDirs: ['a', 'b/'] });
  assert.deepEqual(pp.includeDirs, ['a', 'b'], 'a barra final é removida');
  assert.equal(new Preprocessor({}).includeDirs.length, 0);
});

test('R2-c: `isAngle` distingue "..." de <...>', () => {
  // O que separa as duas buscas é o `includeDirs`: para `<x>` ele é o
  // PRIMEIRO passo, para `"x"` ele é o SEGUNDO (depois do diretório do
  // includer). Com o MESMO nome nos dois formatos e um `-I` apontando para
  // outro lugar, o resultado tem de diferir.
  const inc = { 'raiz.h': 'int R = 1;\n' };
  // `"raiz.h"`: o diretório do includer (a raiz) ganha.
  assert.ok(compila('#include "raiz.h"\n', inc).text.includes('int R = 1'));
  // `<so_I.h>` SEM includeDirs: não acha — `so_I.h` só existe sob `I/`.
  const semI = compila('#include <so_I.h>\n', inc);
  assert.ok(/não encontrado/.test(semI.diagnostics.map((d) => d.message).join('')),
    '`<so_I.h>` não deveria achar `so_I.h` sem includeDirs');
  // `<so_I.h>` COM `includeDirs: ['I']`: acha, e o mapa tem a chave `I/so_I.h`.
  const inc2 = { 'I/so_I.h': 'int S = 1;\n' };
  const comI = compila('#include <so_I.h>\n', inc2, { includeDirs: ['I'] });
  assert.ok(comI.text.includes('int S = 1'), '`<so_I.h>` tem de achar pelo includeDirs');
  // `"so_I.h"` com o MESMO includeDirs também acha — R6: para `"x"` o
  // `includeDirs` é o SEGUNDO passo, não o único.
  const quotes = compila('#include "so_I.h"\n', inc2, { includeDirs: ['I'] });
  assert.ok(quotes.text.includes('int S = 1'),
    `para "x" o includeDirs é o segundo passo; veio: ${quotes.text.slice(0, 160)}`);
});

// ------------------------------------------------ (d) `..` que escapa a raiz

test('R2-d: resolve devolve "" quando o `..` escapa a raiz', () => {
  // base de `main.cpp` é `` (vazia): um `..` já escapa.
  assert.equal(resolve('main.cpp', '../x.h'), '');
  // base de `a/b.cpp` é `a`: um `..` consome `a`, o segundo escapa.
  assert.equal(resolve('a/b.cpp', '../x.h'), 'x.h');
  assert.equal(resolve('a/b.cpp', '../../x.h'), '');
  assert.equal(resolve('a/b/c.cpp', '../../d/../../../x.h'), '');
  // `c/../../x.h` desce e volta: o `..` que popa `c` cancela o `c`.
  assert.equal(resolve('a/b.cpp', 'c/../../x.h'), 'x.h');
});

test('R2-d: include que escapa a raiz é erro, com a cadeia', () => {
  const pp = compila('#include "../fora.h"\n', {});
  const msg = pp.diagnostics.map((d) => d.message).join(' | ');
  assert.ok(/não encontrado/.test(msg), `esperava 'não encontrado'; veio ${msg}`);
  assert.ok(msg.includes('incluído de main.cpp'), `a mensagem tem de trazer o includer; veio ${msg}`);
});

test('R2-d: a mensagem de header ausente lista a linha do include', () => {
  const src = 'int a;\nint b;\n#include "sumiu.h"\n';
  const pp = compila(src, {});
  const d = pp.diagnostics.find((x) => /não encontrado/.test(x.message));
  assert.ok(d, 'esperava um diagnóstico de header ausente');
  assert.equal(d.loc?.line, 3, 'a linha reportada tem de ser a do #include');
});

test('R2-d: header ausente em include aninhado traz o includer real', () => {
  const inc = { 'a.h': '#include "faltando.h"\n' };
  const pp = compila('#include "a.h"\n', inc);
  const msg = pp.diagnostics.map((d) => d.message).join(' | ');
  assert.ok(/não encontrado/.test(msg));
  assert.ok(msg.includes('a.h'), `a cadeia tem de dizer QUEM incluiu: ${msg}`);
});
// ------------------------------------------------ (e) header virtual x disco

test('R3: o header do DISCO vence o virtual de mesmo nome (R6)', () => {
  // Até o R6 isto era o contrário, e era justificado por uma leitura errada
  // da ordem ("o virtual precede o mapa"). A ordem normativa é o contrário,
  // e `docs/ast.md` §6.2 foi reescrito. Um header virtual é um STUB: se ele
  // ganhar, `#include "pixela.hpp"` do bridge resolve para `int pix_width()`
  // e `class Canvas` nunca chega ao parser — e nada acusava, porque o
  // arquivo "parseava sem diagnóstico" sem a classe real.
  const inc = { 'pixela.hpp': 'int DO_DISCO = 1;\n' };
  const pp = compila('#include "pixela.hpp"\n', inc);
  assert.ok(pp.text.includes('DO_DISCO'),
    `o header do disco tem de vencer o virtual; texto: ${pp.text.slice(0, 160)}`);
  assert.deepEqual(pp.resolvidos, ['pixela.hpp'],
    'e ele tem de constar da lista de resolvidos');
});

test('R3: o header do disco também vence o virtual na forma <x> quando há -I', () => {
  const inc = { 'I/vector': 'int DO_I = 1;\n' };
  const comI = compila('#include <vector>\n', inc, { includeDirs: ['I'] });
  assert.ok(comI.text.includes('DO_I'),
    `para <x> o includeDirs é o primeiro passo; texto: ${comI.text.slice(0, 160)}`);
  // Sem `-I` e sem arquivo, o virtual entra — é o último passo.
  const semNada = compila('#include <vector>\n', {});
  assert.ok(/struct\s+vector/.test(semNada.text));
});
