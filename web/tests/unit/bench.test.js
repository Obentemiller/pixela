/**
 * tests/unit/bench.test.js — benchmarks.
 *
 * Metas:
 *   - lexer >= 5 MB/s de fonte
 *   - pixela.hpp preprocessado < 10 ms
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { Lexer } from '../../js/cpp/lexer.js';
import { Preprocessor } from '../../js/cpp/preprocessor.js';

const MB = 1024 * 1024;

function fonteSintetica(aproxMB) {
  const linhas = [
    '#include <vector>',
    '#define LARGURA 320',
    '#define ALTURA 200',
    '',
    'struct Ponto { float x; float y; };',
    '',
    '// Função de exemplo com laços, aritmética e chamadas.',
    'int main() {',
    '    int total = 0;',
    '    for (int y = 0; y < ALTURA; y++) {',
    '        for (int x = 0; x < LARGURA; x++) {',
    '            int v = x * y + 7;',
    '            if (v % 3 == 0) total += v;',
    '            else if (v % 5 == 0) total -= v;',
    '            else total ^= 0xFF;',
    '            total <<= 1;',
    '            total >>= 2;',
    '            const char* s = "linha de texto com escapes \\n e \\t";',
    '            char c = \'A\';',
    '            double d = 3.14e-2;',
    '            total += (int)(d * c);',
    '        }',
    '    }',
    '    return total;',
    '}',
    '',
  ];
  const alvo = Math.ceil(aproxMB * MB);
  const partes = [];
  let tam = 0;
  let n = 0;
  while (tam < alvo) {
    const bloco = linhas.join('\n').replaceAll('ALTURA', String(ALTURA_BASE + n));
    partes.push(bloco);
    tam += bloco.length + 1;
    n++;
  }
  return partes.join('\n');
}

const ALTURA_BASE = 100;

test('benchmark: lexer >= 5 MB/s', () => {
  const fonte = fonteSintetica(5);
  const bytes = Buffer.byteLength(fonte, 'utf8');

  // aquecimento
  for (let i = 0; i < 3; i++) new Lexer(fonte, 'bench.cpp').tokenize();

  const REPS = 5;
  const t0 = process.hrtime.bigint();
  let tokensTotais = 0;
  for (let i = 0; i < REPS; i++) {
    tokensTotais += new Lexer(fonte, 'bench.cpp').tokenize().tokens.length;
  }
  const t1 = process.hrtime.bigint();

  const segundos = Number(t1 - t0) / 1e9;
  const mbPorSeg = (bytes * REPS) / MB / segundos;

  console.log(`[bench.lexer] ${(bytes / MB).toFixed(2)} MB x ${REPS} = ` +
    `${(bytes * REPS / MB).toFixed(2)} MB em ${segundos.toFixed(3)}s ` +
    `= ${mbPorSeg.toFixed(2)} MB/s (${(tokensTotais / REPS / 1e3).toFixed(0)}k tokens)`);

  assert.ok(mbPorSeg >= 5,
    `lexer a ${mbPorSeg.toFixed(2)} MB/s, abaixo da meta de 5 MB/s`);
});

test('benchmark: preprocessar src/pixela.hpp em menos de 10 ms', (t) => {
  const caminho = new URL('../../src/pixela.hpp', import.meta.url);
  if (!existsSync(caminho)) {
    t.skip('src/pixela.hpp não encontrado');
    return;
  }
  const fonte = readFileSync(caminho, 'utf8');

  // aquecimento
  for (let i = 0; i < 5; i++) new Preprocessor({}).process(fonte, 'pixela.hpp');

  const REPS = 20;
  const t0 = process.hrtime.bigint();
  let ultimo;
  for (let i = 0; i < REPS; i++) {
    ultimo = new Preprocessor({}).process(fonte, 'pixela.hpp');
  }
  const t1 = process.hrtime.bigint();

  const msPorExecucao = Number(t1 - t0) / 1e6 / REPS;
  console.log(`[bench.pp] pixela.hpp (${fonte.length} bytes) em ` +
    `${msPorExecucao.toFixed(3)} ms por execução (média de ${REPS}), ` +
    `saída ${ultimo.text.length} bytes, ${ultimo.diagnostics.length} diagnóstico(s)`);

  assert.ok(msPorExecucao < 10,
    `preprocessamento a ${msPorExecucao.toFixed(3)} ms, acima da meta de 10 ms`);
});

test('benchmark: lexar src/pixela.hpp sem diagnóstico de erro', (t) => {
  const caminho = new URL('../../src/pixela.hpp', import.meta.url);
  if (!existsSync(caminho)) { t.skip('src/pixela.hpp não encontrado'); return; }
  const fonte = readFileSync(caminho, 'utf8');
  // modo preprocess: '#' vira token 'hash', não caractere inválido
  const { tokens, diagnostics } = new Lexer(fonte, 'pixela.hpp').tokenize({ mode: 'preprocess' });

  console.log(`[bench.lex-pixela] ${tokens.length} tokens, ${diagnostics.length} diagnóstico(s)`);
  if (diagnostics.length) {
    const linhas = fonte.split('\n');
    for (const d of diagnostics.slice(0, 10)) {
      console.log(`   ${d.loc.line}:${d.loc.column} ${d.code} ${d.message}` +
        `  ${JSON.stringify(linhas[d.loc.line - 1]?.slice(0, 80))}`);
    }
  }
  assert.equal(diagnostics.length, 0,
    `pixela.hpp lexou com ${diagnostics.length} diagnóstico(s)`);
});