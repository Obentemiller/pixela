/**
 * tests/unit/pp-ordem-nomativa.test.js — R6: a ordem NORMATIVA de busca de
 * `#include`, e o fato de que um header virtual NUNCA sombreia um arquivo do
 * disco.
 *
 * A ordem normativa (a do compilador, e a da §4/A1):
 *
 *   `#include "x"`  →  (1) diretório do INCLUDER
 *                     (2) `includeDirs` (o `-I`)
 *                     (3) headers virtuais de sistema
 *
 *   `#include <x>`  →  (1) `includeDirs` (o `-I`)
 *                     (2) headers virtuais de sistema
 *
 * O item (3) de `"x"` é o ponto do R6: o `Preprocessor` tinha o virtual
 * PRIMEIRO, e com isso `#include "pixela.hpp"` do bridge resolvia para o stub
 * virtual (`int pix_width()`) em vez de `src/pixela.hpp` — que é onde está a
 * classe `Canvas`. O efeito era invisível: os arquivos do projeto parseavam
 * "sem diagnóstico" porque a classe real nunca chegava ao parser.
 *
 * Cada teste deste arquivo falha contra o código anterior ao R6. A ordem de
 * escrita foi: teste, rodar, ver falhar, corrigir.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Preprocessor } from '../../js/cpp/preprocessor.js';
import { mapaIncludes } from '../tools/fs-loader.mjs';

const RAIZ = join(import.meta.dirname, '..', '..');

/** Uma instância nova por chamada: o `Preprocessor` guarda estado. */
const compila = (src, includes, opts = {}, como = 'main.cpp') =>
  new Preprocessor({ includes, ...opts }).process(src, como);

// =====================================================================
// (a) O teste que FALHA contra o código anterior ao R6
// =====================================================================

test('R6-a: "x" com arquivo local e virtual de MESMO nome -> vence o local', () => {
  // `local/vector` existe no disco; `vector` também é header virtual (P10,
  // prelúdio declarado). Com `"vector"`, a ordem normativa manda procurar o
  // diretório do INCLUDER primeiro: o arquivo do disco tem de ganhar.
  const inc = {
    'local/vector': 'struct VECTOR_DO_DISCO { int do_disco; };\n',
  };
  const pp = compila('#include "vector"\n', inc, {}, 'local/main.cpp');
  const msg = pp.diagnostics.map((d) => d.message).join(' | ');
  assert.equal(msg, '', `"vector" deveria resolver; veio: ${msg}`);
  assert.match(pp.text, /VECTOR_DO_DISCO/,
    `o ARQUIVO DO DISCO tem de vencer o virtual; veio: ${pp.text.slice(0, 200)}`);
  assert.doesNotMatch(pp.text, /namespace std \{ template<class T, class A> struct vector/,
    `o virtual NÃO deveria entrar quando existe arquivo local com o mesmo nome; veio: ${pp.text.slice(0, 200)}`);
});

test('R6-a: "x" com includeDirs e virtual de mesmo nome -> vence o includeDirs', () => {
  const inc = { 'externo/pixela.hpp': 'struct DO_INCLUDE_DIRS { int x; };\n' };
  const pp = compila('#include "pixela.hpp"\n', inc, { includeDirs: ['externo'] });
  assert.match(pp.text, /DO_INCLUDE_DIRS/,
    `o includeDirs tem de vencer o virtual; veio: ${pp.text.slice(0, 200)}`);
});

test('R6-a: <x> com includeDirs e virtual de mesmo nome -> vence o includeDirs', () => {
  const inc = { 'externo/vector': 'struct VECTOR_DO_I { int x; };\n' };
  const pp = compila('#include <vector>\n', inc, { includeDirs: ['externo'] });
  assert.match(pp.text, /VECTOR_DO_I/,
    `para <x>, o includeDirs tem de vir ANTES do virtual; veio: ${pp.text.slice(0, 200)}`);
});

test('R6-a: o virtual ainda é usado quando NADA no disco tem o nome', () => {
  // Reordenar não pode desligar o prelúdio declarado (P10): sem nenhum
  // arquivo, `<vector>` tem de trazer o virtual.
  const pp = compila('#include <vector>\n', {}, {});
  assert.match(pp.text, /namespace std \{ template<class T, class A> struct vector/,
    'sem nada no disco, o virtual tem de entrar');
});

test('R6-a: o virtual ainda é usado para "x" quando NADA no disco tem o nome', () => {
  const pp = compila('#include "vector"\n', {}, {});
  assert.match(pp.text, /namespace std \{ template<class T, class A> struct vector/,
    'sem nada no disco, o virtual tem de entrar também para "x"');
});

// =====================================================================
// (c) Nenhum header virtual pode sombrear um arquivo do projeto
// =====================================================================

test('R6-c: nao existe header virtual chamado `pixela.hpp`', () => {
  // O virtual da API livre é `pixela.h`. Um virtual `pixela.hpp` sombreava
  // `src/pixela.hpp` — o arquivo que contém `class Canvas`, `Vec3`, `Color` e
  // as funções de desenho. Um arquivo real do projeto nunca pode ser
  // sombreado por um stub.
  //
  // A asserção é o ERRO: removido o virtual, `#include "pixela.hpp"` sem
  // nada no disco não tem de resolver para nada. (Uma versão anterior deste
  // teste procurava o texto `Header virtual pixela.hpp` na saída — e passava
  // sempre, porque o pré-processador descarta comentário.)
  const pp = compila('#include "pixela.hpp"\n', {}, {}, 'src/main.cpp');
  const d = pp.diagnostics.find((x) => /não encontrado/.test(x.message));
  assert.ok(d,
    `"pixela.hpp" sem nada no disco tem de dar erro: ainda existe um virtual com esse nome. saida: ${JSON.stringify(pp.text.slice(0, 200))}`);
  assert.equal(pp.text.trim(), '', 'nada pode ter entrado');
});

test('R6-c: `pixela.h` continua sendo o virtual da API livre', () => {
  const pp = compila('#include <pixela.h>\n', {}, {});
  assert.match(pp.text, /int pix_width\(\);/,
    'o virtual `pixela.h` (API livre) tem de continuar valendo');
});

// =====================================================================
// (d) A LISTA DE ARQUIVOS RESOLVIDOS, exposta no resultado
// =====================================================================

test('R6-d: o resultado do pré-processador expõe os arquivos resolvidos', () => {
  const inc = { 'local/vector': 'struct V { int a; };\n' };
  const pp = compila('#include "vector"\n#include "vector"\n', inc, {}, 'local/main.cpp');
  assert.ok(Array.isArray(pp.resolvidos), 'o resultado precisa expor `resolvidos`');
  // Sem guard e sem `pragma once`, incluir duas vezes faz o header entrar
  // DUAS vezes — é o que o compilador faz (fixture caso10), e a lista
  // registra as duas ocorrências, na ordem.
  assert.deepEqual(pp.resolvidos, ['local/vector', 'local/vector'],
    `resolvidos tem de ser a lista de caminhos canônicos resolvidos; veio: ${JSON.stringify(pp.resolvidos)}`);
});

test('R6-d: a lista sai na ordem em que os headers entraram', () => {
  const inc = {
    'src/a.hpp': '#include "b.hpp"\nint A = 1;\n',
    'src/b.hpp': 'int B = 1;\n',
    'src/c.hpp': 'int C = 1;\n',
  };
  const pp = compila('#include "a.hpp"\n#include "c.hpp"\n', inc, {}, 'src/main.cpp');
  assert.deepEqual(pp.resolvidos, ['src/a.hpp', 'src/b.hpp', 'src/c.hpp'],
    'a lista é a ordem PROFONDA (a entra, e o b que ele inclui antes do c)');
});

test('R6-d: um header que não entra (pragma once) não aparece na lista', () => {
  const inc = { 'src/once.hpp': '#pragma once\nint O = 1;\n' };
  const pp = compila('#include "once.hpp"\n#include "once.hpp"\n', inc, {}, 'src/main.cpp');
  assert.deepEqual(pp.resolvidos, ['src/once.hpp']);
});

// ---- O teste que a ordem exigia: o arquivo REAL do projeto entra

test('R6-d: mesh3d.cpp carrega src/pixela_wasm_bridge.hpp e src/pixela.hpp REAL', () => {
  const PP = 'src/examples/mesh3d.cpp';
  assert.ok(existsSync(join(RAIZ, PP)), 'src/examples/mesh3d.cpp tem de existir');
  const fonte = readFileSync(join(RAIZ, PP), 'utf8');
  const pp = new Preprocessor({ includes: mapaIncludes(PP) }).process(fonte, PP);

  const conta = (f) => pp.resolvidos.filter((x) => x === f).length;
  assert.equal(conta('src/pixela_wasm_bridge.hpp'), 1,
    `o bridge tem de entrar 1 vez; resolvidos: ${JSON.stringify(pp.resolvidos)}`);

  // A prova de que é o ARQUIVO REAL e não o stub: só `src/pixela.hpp` tem
  // `class Canvas`. O virtual `pixela.hpp` nunca teve.
  assert.equal(conta('src/pixela.hpp'), 1,
    `src/pixela.hpp tem de entrar 1 vez; resolvidos: ${JSON.stringify(pp.resolvidos)}`);
  assert.match(pp.text, /class\s+Canvas/,
    'o texto tem de conter `class Canvas` — só vem do arquivo real');
  assert.doesNotMatch(pp.text, /int pix_width\(\);[\s\S]{0,80}int pix_height\(\);[\s\S]{0,80}double pix_time\(\);[\s\S]{0,80}void pix_clear\(\);[\s\S]{0,80}void pix_present\(\);/,
    'NENHUM virtual chamado pixela.hpp pode entrar: o texto é a assinatura do stub');

  // E a lista sai para quem quiser conferir.
  console.log('[R6-d] resolvidos de src/examples/mesh3d.cpp:');
  for (const f of pp.resolvidos) console.log(`  ${f}`);
});

test('R6-d: nenhum arquivo resolvido é um virtual (todos existem no disco)', () => {
  const PP = 'src/examples/mesh3d.cpp';
  const pp = new Preprocessor({ includes: mapaIncludes(PP) })
    .process(readFileSync(join(RAIZ, PP), 'utf8'), PP);
  const inexistentes = pp.resolvidos.filter((f) => !existsSync(join(RAIZ, f)));
  assert.deepEqual(inexistentes, [],
    `estes resolvidos não existem no disco (ou seja, são virtuais): ${JSON.stringify(inexistentes)}`);
});