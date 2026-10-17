/**
 * tests/unit/pp-inc.test.js — os 12 casos de `tests/fixtures/pp-inc/`
 * rodam dentro de `npm test`, um `test()` por caso.
 *
 * O diferencial contra o `g++ -E` é `tests/tools/diff-pp-inc.mjs`. Este
 * arquivo é o mesmo conjunto, como `test()` individuais, para que uma
 * regressão de resolução de include apareça em `npm test` e não só quando
 * alguém lembra de rodar a ferramenta.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Preprocessor } from '../../js/cpp/preprocessor.js';
import { Lexer } from '../../js/cpp/lexer.js';
import { mapaIncludes } from '../tools/fs-loader.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = join(RAIZ, 'tests', 'fixtures', 'pp-inc');

const casos = existsSync(BASE) ? readdirSync(BASE).sort() : [];

/**
 * Mapa de includes do caso, com as duas chaves que o Preprocessor aceita.
 *
 * `mapaIncludes` trabalha com caminhos RELATIVOS À RAIZ do repositório — o
 * mesmo formato que o `Preprocessor` usa para `currentFile`. Por isso o
 * caminho do fixture entra inteiro, `tests/fixtures/pp-inc/<caso>/…`, e o
 * `..` é relativo a esse caminho, como no C++.
 */
function mapaDoCaso(nome) {
  const mapa = mapaIncludes(`tests/fixtures/pp-inc/${nome}`);
  for (const [k, v] of Object.entries(mapa)) mapa[`/${k}`] = v;
  return mapa;
}

test('existem pelo menos 12 casos de include relativo', () => {
  assert.ok(casos.length >= 12, `só ${casos.length} casos em tests/fixtures/pp-inc/`);
});

test('`resolve()` é a regra: `..` é relativo ao includer, não à raiz', async () => {
  const { resolve } = await import('../../js/cpp/preprocessor.js');
  assert.equal(resolve('src/examples/mesh3d.cpp', '../pixela.hpp'), 'src/pixela.hpp');
  assert.equal(resolve('src/examples/mesh3d.cpp', '../pixela_wasm_bridge.hpp'),
    'src/pixela_wasm_bridge.hpp');
  // base = `a/b/c`; dois `..` sobem para `a`, e `e/f.hpp` entra a partir dai.
  assert.equal(resolve('a/b/c/d.cpp', '../../e/f.hpp'), 'a/e/f.hpp');
  assert.equal(resolve('a/b/c/d.cpp', '../e/f.hpp'), 'a/b/e/f.hpp');
  assert.equal(resolve('a/b/c.cpp', './d.h'), 'a/b/d.h');
  assert.equal(resolve('x.cpp', 'y.h'), 'y.h');
  // `..` que escapa da raiz não resolve: vira erro de include, não caminho
  // absoluto.
  assert.equal(resolve('x.cpp', '../y.h'), '');
});

for (const nome of casos) {
  const dir = join(BASE, nome);

  // acha o .cpp principal
  const achar = (d, acc = []) => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) achar(p, acc);
      else if (e.endsWith('.cpp')) acc.push(relative(dir, p).split('\\').join('/'));
    }
    return acc;
  };
  const cpps = achar(dir);
  const principal = cpps[0];
  // Casos de ERRO por desenho: o header não existe DE PROPÓSITO, e o teste
  // exige o diagnóstico. Marcados por `esperaErro.txt`.
  const esperaErro = existsSync(join(dir, 'esperaErro.txt'));

  test(`pp-inc ${nome}: ${esperaErro ? 'os includes inválidos dão erro' : 'todos os includes resolvem'}`, () => {
    const PP = `tests/fixtures/pp-inc/${nome}/${principal}`;
    const fonte = readFileSync(join(dir, principal), 'utf8');
    const pp = new Preprocessor({ includes: mapaDoCaso(nome) }).process(fonte, PP);
    const erros = pp.diagnostics.filter((d) => /não encontrado|circular|Profundidade de include/.test(String(d.message)));
    if (esperaErro) {
      assert.ok(erros.length > 0,
        `${nome}: marcado como caso de ERRO, mas todos os includes resolveram`);
      return;
    }
    assert.deepEqual(erros.map((d) => d.message), [],
      `${nome}: ${erros.length} include(s) não resolvido(s)`);
  });

  // ---- O CONTRATO DO CASO (`ESPERA.json`)
  //
  // O teste acima so diz "nao ha erro de include". Isso deixa passar um header
  // que entra DUAS vezes, ou o arquivo ERRADO entrando em lugar do certo — foi
  // exatamente o que o caso13 fez contra o preprocessor de 68ae1b9, que
  // devolvia `int H = 1; int H = 1;` e o teste aproveitava. `ESPERA.json`
  // fecha isso: cada fixture declara o que a saida tem de conter, quantas
  // vezes, e o que NUNCA pode aparecer.
  const espera = existsSync(join(dir, 'ESPERA.json'))
    ? JSON.parse(readFileSync(join(dir, 'ESPERA.json'), 'utf8')) : null;

  test(`pp-inc ${nome}: o contrato do caso (ESPERA.json) e cumprido`, () => {
    assert.ok(espera, `${nome}: sem ESPERA.json — todo caso precisa declarar o contrato`);
    const PP = `tests/fixtures/pp-inc/${nome}/${principal}`;
    const fonte = readFileSync(join(dir, principal), 'utf8');
    const pp = new Preprocessor({ includes: mapaDoCaso(nome) }).process(fonte, PP);

    for (const s of espera.umaVez ?? []) {
      const n = pp.text.split(s).length - 1;
      assert.equal(n, 1, `${nome}: "${s}" apareceu ${n}x, esperado 1x\nsaida: ${pp.text.slice(0, 300)}`);
    }
    for (const [s, n] of Object.entries(espera.contagem ?? {})) {
      const got = pp.text.split(s).length - 1;
      assert.equal(got, n, `${nome}: "${s}" apareceu ${got}x, esperado ${n}x`);
    }
    for (const s of espera.nunca ?? []) {
      assert.ok(!pp.text.includes(s),
        `${nome}: "${s}" NÃO deveria aparecer na saida: ${pp.text.slice(0, 300)}`);
    }
    if (espera.erroObrigatorio) {
      const todos = pp.diagnostics.map((d) => d.message).join(' || ');
      assert.match(todos, new RegExp(espera.erroObrigatorio),
        `${nome}: o diagnóstico não casou /${espera.erroObrigatorio}/; veio: ${todos.slice(0, 300)}`);
    }
  });

  test(`pp-inc ${nome}: a saída pré-processada lexa limpa`, () => {
    const PP = `tests/fixtures/pp-inc/${nome}/${principal}`;
    const fonte = readFileSync(join(dir, principal), 'utf8');
    const pp = new Preprocessor({ includes: mapaDoCaso(nome) }).process(fonte, PP);
    const lex = new Lexer(pp.text, PP).tokenize();
    // num caso de erro por desenho o texto pode estar vazio: o que não pode é
    // o lexer estourar.
    const erros = lex.diagnostics.filter((d) => String(d.code) !== 'E0104');
    assert.deepEqual(erros.map((d) => `${d.loc.line}:${d.loc.column} ${d.message}`), [],
      `${nome}: a saída do pré-processador não lexa`);
    assert.ok(lex.tokens.length > 1, `${nome}: a saída ficou vazia`);
  });

  test(`pp-inc ${nome}: ${esperaErro ? 'o diagnóstico traz a cadeia' : 'as declarações do header chegam na saída'}`, () => {
    if (esperaErro) {
      const PP = `tests/fixtures/pp-inc/${nome}/${principal}`;
      const fonte = readFileSync(join(dir, principal), 'utf8');
      const pp = new Preprocessor({ includes: mapaDoCaso(nome) }).process(fonte, PP);
      const d = pp.diagnostics.find((x) =>
        /não encontrado|circular|Profundidade de include/.test(x.message));
      assert.ok(d, `${nome}: esperado um diagnóstico de include`);
      if (/Profundidade/.test(d.message)) {
        // O limite tem de ser um NÚMERO verificável, e a cadeia tem de dizer
        // até onde o pré-processador chegou.
        assert.ok(/excedida \(200\)/.test(d.message),
          `${nome}: o limite tem de aparecer na mensagem: ${d.message.slice(0, 120)}`);
        assert.ok(/ -> /.test(d.message), `${nome}: a cadeia tem de aparecer`);
      } else if (/circular/.test(d.message)) {
        // A cadeia do ciclo é o que torna o erro acionável.
        assert.ok(/ -> /.test(d.message),
          `${nome}: a cadeia do ciclo tem de mostrar o caminho: ${d.message}`);
      } else {
        assert.ok(/incluído de /.test(d.message),
          `${nome}: a mensagem tem de dizer QUEM incluiu: ${d.message}`);
      }
      assert.ok(Number.isInteger(d.loc?.line) && d.loc.line >= 1,
        `${nome}: a mensagem tem de trazer a linha`);
      return;
    }
    const PP = `tests/fixtures/pp-inc/${nome}/${principal}`;
    const fonte = readFileSync(join(dir, principal), 'utf8');
    const pp = new Preprocessor({ includes: mapaDoCaso(nome) }).process(fonte, PP);
    // Toda declaração `int NOME(...)` ou `int NOME;` de um header incluído
    // tem de aparecer no texto gerado.
    for (const [chave] of Object.entries(mapaDoCaso(nome))) {
      if (chave.startsWith('/')) continue;
      // `chave` é relativa à RAIZ (`tests/fixtures/pp-inc/<caso>/…`), e `dir`
      // é o caminho absoluto do caso — juntar as duas duplica o prefixo.
      const conteudo = readFileSync(join(RAIZ, chave), 'utf8');
      for (const m of conteudo.matchAll(/^\s*(?:int|double|char)\s+(\w+)\s*[;(]/gm)) {
        assert.ok(new RegExp(`\\b${m[1]}\\b`).test(pp.text),
          `${nome}: \`${m[1]}\` de ${chave} não chegou à saída`);
      }
    }
  });
}