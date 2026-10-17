/**
 * tests/unit/preprocessor.test.js — TDD do pré-processador.
 *
 * O pré-processador é token-based: o lexer é a única fonte de tokens.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Preprocessor, splitMacroArgs } from '../../js/cpp/preprocessor.js';
import { CASOS } from './preprocessor-cases.mjs';

function pp(src, opts = {}) {
  return new Preprocessor(opts).process(src, 't.cpp');
}

/**
 * Normaliza para comparar a SEQUÊNCIA DE TOKENS, não a forma do texto.
 * Quebras de linha e espaços entre tokens são irrelevantes para o
 * pré-processador (que é token-based); o que importa é quais tokens
 * sobrevivem e em que ordem.
 */
function normalizar(s) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------- corpus

test('preprocessor: corpus completo', async (t) => {
  assert.ok(CASOS.length >= 60, `corpus tem ${CASOS.length} casos, exigido >= 60`);

  const falhas = [];
  let passou = 0;

  for (const c of CASOS) {
    const opts = {};
    if (c.includes) opts.includes = c.includes;
    if (c.definidos) opts.predefined = c.definidos;

    let r;
    try {
      r = new Preprocessor(opts).process(c.src, 't.cpp');
    } catch (e) {
      falhas.push(`${c.nome}: LEVANTOU ${e.constructor.name}: ${e.message}`);
      continue;
    }

    const esperado = normalizar(c.esperado);
    const obtido = normalizar(r.text);
    if (esperado !== obtido) {
      falhas.push(`${c.nome}\n    src:      ${JSON.stringify(c.src)}\n    esperado: ${JSON.stringify(esperado)}\n    real:     ${JSON.stringify(obtido)}`);
      continue;
    }
    if (c.diagnosticos !== undefined && r.diagnostics.length !== c.diagnosticos) {
      falhas.push(`${c.nome}: diagnosticos esperado=${c.diagnosticos} real=${r.diagnostics.length} (${JSON.stringify(r.diagnostics.map((d) => d.message))})`);
      continue;
    }
    passou++;
  }

  await t.test(`${passou}/${CASOS.length} casos do corpus`, () => {
    assert.equal(falhas.length, 0, `\n  ` + falhas.join('\n  '));
  });
});

test('preprocessor: o corpus tem pelo menos 60 casos', () => {
  assert.ok(CASOS.length >= 60, `corpus tem ${CASOS.length}, exigido >= 60`);
});

// ---------------------------------------------------------------- contrato

test('preprocessor: nunca lança para nenhuma entrada', () => {
  for (const c of CASOS) {
    const opts = {};
    if (c.includes) opts.includes = c.includes;
    assert.doesNotThrow(() => new Preprocessor(opts).process(c.src, 't.cpp'), c.nome);
  }
});

test('preprocessor: devolve tokens sem diretivas residuais', () => {
  const r = pp('#define N 7\n#if 1\nint x = N;\n#endif\n');
  for (const t of r.tokens) {
    assert.notEqual(t.type, 'hash', `token 'hash' residual: ${JSON.stringify(t.value)}`);
  }
});

test('preprocessor: process é repetível (não guarda estado entre chamadas)', () => {
  const a = pp('#define N 7\nint x = N;');
  const b = pp('int x = N;');
  assert.match(a.text, /int x = 7;/);
  // a segunda chamada tem um Preprocessor novo, então N não existe
  assert.match(b.text, /int x = N;/);
});

test('preprocessor: o mesmo Preprocessor pode reusar (estado limpo)', () => {
  const p = new Preprocessor({});
  const a = p.process('#define N 7\nint x = N;', 'a.cpp');
  const b = p.process('int x = N;', 'b.cpp');
  assert.match(a.text, /int x = 7;/);
  assert.match(b.text, /int x = N;/, 'macro N não deveria sobreviver entre chamadas');
});

// ---------------------------------------------------------------- includes

test('preprocessor: include de arquivo real (includes)', () => {
  const r = pp('#include "meu.h"\nint x;', { includes: { 'meu.h': 'int f();\n' } });
  assert.match(r.text, /int f\(\);/);
  assert.equal(r.diagnostics.length, 0);
});

test('preprocessor: include aninhado de três níveis', () => {
  const r = pp('#include <a.h>\nint x;', {
    includes: { 'a.h': '#include <b.h>', 'b.h': '#include <c.h>', 'c.h': 'int profundo();' },
  });
  assert.match(r.text, /int profundo\(\);/);
  assert.equal(r.diagnostics.length, 0);
});

test('preprocessor: include circular gera diagnóstico com a cadeia', () => {
  const r = pp('#include <a.h>\nint x;', {
    includes: { 'a.h': '#include <b.h>', 'b.h': '#include <a.h>' },
  });
  assert.ok(r.diagnostics.length > 0, 'esperava diagnóstico de ciclo');
  assert.match(r.diagnostics[0].message, /circular/i);
  assert.match(r.diagnostics[0].message, /a\.h/);
  assert.match(r.diagnostics[0].message, /b\.h/);
});

test('preprocessor: include guard evita dupla inclusão', () => {
  const guard = '#ifndef G\n#define G\nint g();\n#endif\n';
  const r = pp('#include <g.h>\n#include <g.h>\n#include <g.h>\nint x;', { includes: { 'g.h': guard } });
  const ocorrencias = (r.text.match(/int g\(\);/g) || []).length;
  assert.equal(ocorrencias, 1, `int g() apareceu ${ocorrencias} vezes`);
});

test('preprocessor: #pragma once evita dupla inclusão', () => {
  const r = pp('#include <o.h>\n#include <o.h>\nint x;', {
    includes: { 'o.h': '#pragma once\nint o();\n' },
  });
  const ocorrencias = (r.text.match(/int o\(\);/g) || []).length;
  assert.equal(ocorrencias, 1, `int o() apareceu ${ocorrencias} vezes`);
});

test('preprocessor: profundidade de include é limitada', () => {
  const includes = {};
  for (let i = 0; i < 300; i++) includes[`h${i}.h`] = `#include <h${i + 1}.h>`;
  includes['h300.h'] = 'int fundo();';
  const r = pp('#include <h0.h>\nint x;', { includes, maxIncludeDepth: 50 });
  assert.ok(r.diagnostics.length > 0, 'esperava diagnóstico de profundidade');
  assert.match(r.diagnostics[0].message, /Profundidade/i);
});

test('preprocessor: header virtual padrão pixela.h está disponível', () => {
  const r = pp('#include <pixela.h>\nint main(){}');
  assert.equal(r.diagnostics.length, 0);
  assert.match(r.text, /pix_width/);
});

test('preprocessor: headers da std são vazios e não dão erro', () => {
  for (const h of ['vector', 'string', 'cmath', 'cstdint', 'iostream']) {
    const r = pp(`#include <${h}>\nint x;`);
    assert.equal(r.diagnostics.length, 0, `#include <${h}> deu ${r.diagnostics.length} diagnóstico(s)`);
  }
});

// ---------------------------------------------------------------- BigInt

test('preprocessor: #if usa BigInt (sem perder precisão acima de 2^53)', () => {
  // Se fosse Number, 9007199254740993 viraria 9007199254740992 e a
  // comparação seria verdadeira por acidente. Com BigInt, o valor exato
  // é diferente, então a comparação é falsa e o bloco é descartado.
  const r = pp('#if 9007199254740993 == 9007199254740992\nint nao;\n#endif\nint sim;');
  assert.doesNotMatch(r.text, /int nao;/);
  assert.match(r.text, /int sim;/);
});

test('preprocessor: #if com valor grande exato', () => {
  const r = pp('#if 4611686018427387904 > 0\nint sim;\n#endif');
  assert.match(r.text, /int sim;/);
});

test('preprocessor: #if com multiplicação grande exata', () => {
  const r = pp('#if 3037000499 * 3037000499 == 9223372030926249001\nint sim;\n#endif');
  assert.match(r.text, /int sim;/);
});

// ---------------------------------------------------------------- splitMacroArgs

test('splitMacroArgs: separa por vírgula de topo', () => {
  assert.deepEqual(splitMacroArgs('a, b, c'), ['a', 'b', 'c']);
});

test('splitMacroArgs: respeita parênteses', () => {
  assert.deepEqual(splitMacroArgs('f(1,2), b'), ['f(1,2)', 'b']);
});

test('splitMacroArgs: respeita strings', () => {
  assert.deepEqual(splitMacroArgs('"a,b", c'), ['"a,b"', 'c']);
});

test('splitMacroArgs: argumento vazio', () => {
  assert.deepEqual(splitMacroArgs('a, , b'), ['a', '', 'b']);
});

// ---------------------------------------------------------------- API

test('preprocessor: process devolve { text, tokens, diagnostics }', () => {
  const r = pp('int x;');
  assert.equal(typeof r.text, 'string');
  assert.ok(Array.isArray(r.tokens));
  assert.ok(Array.isArray(r.diagnostics));
});

test('preprocessor: __COUNTER__ incrementa a cada uso', () => {
  const r = pp('int a = __COUNTER__;\nint b = __COUNTER__;\nint c = __COUNTER__;');
  assert.match(r.text, /int a = 0;/, `obtido: ${r.text}`);
  assert.match(r.text, /int b = 1;/, `obtido: ${r.text}`);
  assert.match(r.text, /int c = 2;/, `obtido: ${r.text}`);
});

test('preprocessor: BigInt preserva precisão acima de 2^53', () => {
  // Com Number (não BigInt), 9007199254740993 viraria 9007199254740992 e a
  // comparação seria verdadeira. Com BigInt os dois são distintos.
  const r = pp('#if 9007199254740993 > 9007199254740992\nint sim;\n#endif');
  assert.match(r.text, /int sim;/, 'BigInt deveria distinguir 2^53 de 2^53+1');
  assert.doesNotMatch(r.text, /int nao;/);
});