/**
 * tests/unit/projeto.test.js — todos os arquivos do projeto devem lexar e
 * preprocessar sem diagnóstico de erro.
 *
 * Cobre: src/pixela.hpp, src/pixela_wasm_bridge.hpp, src/examples/*.cpp,
 * src/shaders/*.cpp e os exemplos extraídos de js/examples.js para
 * tests/fixtures/examples/*.cpp.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Lexer } from '../../js/cpp/lexer.js';
import { Preprocessor } from '../../js/cpp/preprocessor.js';
import { todosHeaders } from '../tools/fs-loader.mjs';

const RAIZ = new URL('../../', import.meta.url).pathname;

function coletar(dir, filtro) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...coletar(p, filtro));
    else if (filtro(nome)) out.push(p);
  }
  return out;
}

/** Todos os .cpp/.hpp/.h do projeto. */
const FONTES_PROJETO = [
  ...coletar(join(RAIZ, 'src'), (n) => /\.(cpp|hpp|h)$/.test(n)),
  ...coletar(join(RAIZ, 'tests', 'fixtures', 'examples'), (n) => n.endsWith('.cpp')),
];

test('projeto: há fontes para testar', () => {
  assert.ok(FONTES_PROJETO.length >= 5,
    `só ${FONTES_PROJETO.length} fontes encontradas em src/ e tests/fixtures/examples/`);
});

for (const caminho of FONTES_PROJETO) {
  const rel = caminho.replace(RAIZ, '');

  test(`projeto: ${rel} lexa sem erro`, () => {
    const fonte = readFileSync(caminho, 'utf8');
    const { tokens, diagnostics } = new Lexer(fonte, rel).tokenize({ mode: 'preprocess' });
    const msgs = diagnostics.map((d) => `${d.loc.line}:${d.loc.column} ${d.message}`);
    assert.deepEqual(msgs, [], `${rel} lexou com ${msgs.length} diagnóstico(s):\n  ` + msgs.slice(0, 10).join('\n  '));
    assert.ok(tokens.length > 0, `${rel} não produziu tokens`);
    assert.equal(tokens.at(-1).type, 'eof', `${rel} não terminou em eof`);
  });

  test(`projeto: ${rel} preprocessa sem erro`, () => {
    const fonte = readFileSync(caminho, 'utf8');
    const pp = new Preprocessor({ includes: todosHeaders() });
    const r = pp.process(fonte, rel);
    const erros = r.diagnostics.filter((d) => d.severity === 'error');
    const msgs = erros.map((d) => `${d.loc?.line}:${d.loc?.column} ${d.message}`);
    assert.deepEqual(msgs, [], `${rel} preprocessou com ${erros.length} erro(s):\n  ` + msgs.slice(0, 10).join('\n  '));
    assert.ok(r.text.length > 0 || fonte.trim() === '', `${rel} produziu saída vazia`);
  });

  test(`projeto: ${rel} saida preprocessada volta a lexar limpa`, () => {
    const fonte = readFileSync(caminho, 'utf8');
    const r = new Preprocessor({ includes: todosHeaders() }).process(fonte, rel);
    const { diagnostics } = new Lexer(r.text, rel).tokenize({ mode: 'preprocess' });
    const msgs = diagnostics.map((d) => `${d.loc.line}:${d.loc.column} ${d.message}`);
    assert.deepEqual(msgs, [],
      `${rel}: a saída preprocessada não relexa limpa (${msgs.length}):\n  ` + msgs.slice(0, 10).join('\n  '));
  });
}

test('projeto: exemplos de js/examples.js foram extraídos para fixtures', () => {
  const dir = join(RAIZ, 'tests', 'fixtures', 'examples');
  assert.ok(existsSync(dir), 'tests/fixtures/examples/ não existe');
  const arquivos = readdirSync(dir).filter((n) => n.endsWith('.cpp'));
  assert.ok(arquivos.length >= 7,
    `só ${arquivos.length} exemplos extraídos, esperado >= 7 (hello, plasma, bounce, starfield, wireframecube, scene3d, saturn)`);
});

test('projeto: src/pixela.hpp preprocessa rápido e sem erro', () => {
  const caminho = join(RAIZ, 'src', 'pixela.hpp');
  if (!existsSync(caminho)) return;
  const fonte = readFileSync(caminho, 'utf8');
  const r = new Preprocessor({ includes: todosHeaders() }).process(fonte, 'pixela.hpp');
  const erros = r.diagnostics.filter((d) => d.severity === 'error');
  assert.deepEqual(erros.map((d) => d.message), []);
});