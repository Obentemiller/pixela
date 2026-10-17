import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TEXT_FUNCTION_NAMES, TEXT_CONSTANTS } from '../../js/runner.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * js/text.js é um script clássico (se pendura em `window`), como os demais
 * módulos de runtime. Para testá-lo em Node, carregamos com um `window` falso —
 * o mesmo truque de um `new Function('window', src)`.
 */
function carregarTextEngine() {
  const src = readFileSync(join(RAIZ, 'js', 'text.js'), 'utf8');
  const sb = {};
  new Function('window', src)(sb);
  assert.ok(sb.TextEngine, 'js/text.js precisa definir window.TextEngine');
  return sb.TextEngine;
}

const T = carregarTextEngine();

test('a fonte vetorial tem os glifos esperados e nenhum vazio além do espaço', () => {
  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (const c of letras) {
    assert.ok(T.FONT_DEFS[c], `falta o glifo "${c}"`);
    assert.ok(T.FONT_DEFS[c].length > 0, `glifo "${c}" está vazio`);
  }
  assert.equal(T.FONT_DEFS[' '], '', 'o espaço é o único glifo sem traço');
  // A tabela é gerada a partir do src/pixela_text.hpp — se alguém editar uma,
  // tem que editar a outra. Âncora em dois glifos conhecidos:
  assert.equal(T.FONT_DEFS['A'], '002640 1333');
  assert.equal(T.FONT_DEFS['0'], '103041453616050110 1135');
});

test('os acentos do português estão decompostos em (letra base, acento)', () => {
  const esperado = {
    0xC0: ['A', 2], 0xC1: ['A', 1], 0xC3: ['A', 4], 0xC7: ['C', 6],
    0xC9: ['E', 1], 0xCD: ['I', 1], 0xD1: ['N', 4], 0xD3: ['O', 1],
    0xD5: ['O', 4], 0xDC: ['U', 5],
  };
  for (const [cp, [base, acento]] of Object.entries(esperado)) {
    const achado = T.DECOMPOSE.find((d) => d[0] === Number(cp));
    assert.ok(achado, `falta a decomposição de U+${Number(cp).toString(16).toUpperCase()}`);
    assert.equal(achado[1], base, `U+${Number(cp).toString(16)}: letra base`);
    assert.equal(achado[2], acento, `U+${Number(cp).toString(16)}: acento`);
  }
  // Os 8 traços de acento (A_NONE + acute/grave/circ/tilde/diaer/cedil/ring)
  assert.equal(T.ACCENT_DEFS.length, 8);
  assert.equal(T.ACCENT_DEFS[0], '', 'A_NONE não tem traço');
});

test('SIGNATURES cobre todas as funções da api, com aridade e retorno coerentes', () => {
  const nomes = Object.keys(T.SIGNATURES);
  assert.equal(nomes.length, 45, 'a superfície pública de letreiro tem 45 funções');

  for (const nome of nomes) {
    assert.ok(nome.startsWith('pix_text'), `${nome} deveria começar com pix_text`);
    const [params, ret] = T.SIGNATURES[nome];
    const fn = T.api[nome];
    assert.equal(typeof fn, 'function', `api.${nome} não existe`);
    assert.equal(fn.length, params.length,
      `${nome}: api recebe ${fn.length} argumento(s) mas SIGNATURES declara ${params.length}`);
    for (const p of params) assert.ok(['S', 'I', 'D'].includes(p), `${nome}: tipo de arg "${p}" inválido`);
    assert.ok(['I', 'D', 'V'].includes(ret), `${nome}: retorno "${ret}" inválido`);
  }
});

test('a lista de fallback do Runner é idêntica a SIGNATURES', () => {
  // js/runner.js não consegue importar js/text.js (script clássico), então
  // mantém uma lista para o caso de o arquivo não estar carregado. Este teste
  // existe para a duplicata não divergir em silêncio.
  assert.deepEqual(
    [...TEXT_FUNCTION_NAMES].sort(),
    Object.keys(T.SIGNATURES).sort(),
    'TEXT_FUNCTION_NAMES (runner.js) e TextEngine.SIGNATURES (text.js) divergiram'
  );
});

test('as constantes de fallback do Runner batem com TextEngine.CONSTANTS', () => {
  assert.deepEqual(TEXT_CONSTANTS, T.CONSTANTS);
  assert.deepEqual(T.CONSTANTS, {
    PIX_ALIGN_LEFT: 0, PIX_ALIGN_CENTER: 1, PIX_ALIGN_RIGHT: 2,
    PIX_EDGE_NONE: 0, PIX_EDGE_WRAP: 1, PIX_EDGE_BOUNCE: 2,
    PIX_STYLE_WIRE: 0, PIX_STYLE_SOLID: 1,
  });
});

test('layout: largura cresce com o texto e \\n quebra linha', () => {
  const um = T.layout('A', 1, 1);
  const dois = T.layout('AA', 1, 1);
  assert.ok(dois.width > um.width, '"AA" precisa ser mais largo que "A"');

  const duasLinhas = T.layout('A\nA', 1, 1);
  assert.equal(duasLinhas.lines, 2, 'o \\n abre uma segunda linha');
  assert.ok(duasLinhas.height > um.height, 'duas linhas são mais altas que uma');

  const espacos = T.layout('A A', 1, 1);
  assert.ok(espacos.width > dois.width, 'o espaço ocupa largura');
});

test('layout: acentos não mudam a largura da letra base', () => {
  const sem = T.layout('A', 1, 1);
  const com = T.layout('Á', 1, 1);
  assert.equal(com.width, sem.width, 'o acento é desenhado acima, não alarga a letra');
  assert.equal(com.items.length, 1, '"Á" é um único item de layout');
});

test('layout: glifo desconhecido cai no tofu, não some', () => {
  const L = T.layout('', 1, 1);   // PUA: sem glifo
  assert.equal(L.items.length, 1);
  let tracos = 0;
  T.forEachStroke(L, 1, 1, (pts) => { tracos += pts.length; });
  assert.ok(tracos > 0, 'o tofu precisa desenhar alguma coisa');
});

test('width2D/height2D escalam linearmente com size', () => {
  const o = T.new2D('OLA');
  const w12 = T.width2D({ ...o, size: 12 });
  const w24 = T.width2D({ ...o, size: 24 });
  assert.ok(Math.abs(w24 - w12 * 2) < 1e-9, 'dobrar o size dobra a largura');
  assert.ok(T.height2D({ ...o, size: 12 }) > 0);
});

test('update2D: Wrap atravessa a borda e Bounce inverte o sentido', () => {
  const o = T.new2D('LARGE');
  o.vx = 100; o.edge = 1 /* WRAP */;
  o.x = 90;
  T.update2D(o, 1, 100, 50);
  assert.ok(o.x < 90, 'com Wrap a letreiro reaparece do outro lado');

  const b = T.new2D('LARGE');
  b.vx = -100; b.edge = 2 /* BOUNCE */;
  b.x = 5;
  const vxAntes = b.vx;
  T.update2D(b, 1, 100, 50);
  assert.notEqual(b.vx, vxAntes, 'com Bounce a velocidade inverte de sinal');
});

test('update3D acumula posição, ângulo e fase da onda', () => {
  const o = T.new3D('HI');
  o.vx = 1; o.vz = 2; o.sy = 0.5; o.waveSpeed = 4;
  const antes = { x: o.x, z: o.z, ay: o.ay, fase: o.wavePhase };
  T.update3D(o, 0.5);
  assert.ok(Math.abs(o.x - antes.x - 0.5) < 1e-9, 'posição em X avança vx*dt');
  assert.ok(Math.abs(o.z - antes.z - 1.0) < 1e-9, 'posição em Z avança vz*dt');
  assert.ok(Math.abs(o.ay - antes.ay - 0.25) < 1e-9, 'rotação em Y avança spin*dt');
  assert.ok(Math.abs(o.wavePhase - antes.fase - 2.0) < 1e-9, 'a fase da onda avança waveSpeed*dt');
});

test('api: create devolve handle e os setters não inventam handle', () => {
  T.reset();
  const id = T.api.pix_text_create('X');
  assert.equal(typeof id, 'number');
  // handle inexistente não pode lançar — o C++ pode usar id depois de um
  // pix_text_clear_all() e o motor tem de degradar para zero.
  T.api.pix_text_set_pos(999, 1, 2);
  T.api.pix_text_set_size(999, 3);
  T.api.pix_text_draw(999);
  assert.equal(T.api.pix_text_width(999), 0, 'largura de handle inexistente é 0');
  assert.equal(T.api.pix_text3d_width(999), 0);
  T.reset();
  assert.equal(T.api.pix_text_width(id), 0, 'reset() descarta os letreiros');
});

test('install registra as 45 funções e as 8 constantes no runtime do JSCPP', () => {
  // Runtime falso que registra o que install() pediu.
  const registradas = [];
  const definidos = [];
  const rt = {
    intTypeLiteral: 'I', doubleTypeLiteral: 'D', voidTypeLiteral: 'V',
    charTypeLiteral: 'C',
    normalPointerType: (t) => `${t}*`,
    getStringFromCharArray: (v) => String(v && v.v !== undefined ? v.v : v),
    val: (t, v) => ({ t, v }),
    regFunc: (fn, escopo, nome, params, ret) => registradas.push({ nome, params, ret }),
    defVar: (nome) => definidos.push(nome),
  };
  T.install(rt);

  assert.equal(registradas.length, 45, 'install() deve registrar 45 funções');
  assert.deepEqual(
    registradas.map((r) => r.nome).sort(),
    Object.keys(T.SIGNATURES).sort()
  );
  const esperadoRet = (c) => (c === 'D' ? 'D' : c === 'V' ? 'V' : 'I');
  for (const r of registradas) {
    assert.deepEqual(r.params, T.SIGNATURES[r.nome][0].map((c) => (
      c === 'S' ? 'C*' : c === 'D' ? 'D' : 'I'
    )), `${r.nome}: tipos de argumento registrados`);
    assert.equal(r.ret, esperadoRet(T.SIGNATURES[r.nome][1]),
      `${r.nome}: tipo de retorno registrado`);
  }
  assert.equal(definidos.length, 8, 'as 8 constantes PIX_* devem ser definidas');
  assert.deepEqual(definidos.sort(), Object.keys(T.CONSTANTS).sort());
});

test('install: função void retorna val(void, 0) e função int retorna o handle', () => {
  const chamadas = [];
  let capturadaFn = null;
  const rt = {
    intTypeLiteral: 'I', doubleTypeLiteral: 'D', voidTypeLiteral: 'V',
    charTypeLiteral: 'C',
    normalPointerType: (t) => `${t}*`,
    getStringFromCharArray: (v) => String(v && v.v !== undefined ? v.v : v),
    val: (t, v) => { chamadas.push([t, v]); return { t, v }; },
    regFunc: (fn, escopo, nome) => {
      if (nome === 'pix_text_create') capturadaFn = fn;
      if (nome === 'pix_text_set_size') capturadaVoid = fn;
    },
    defVar: () => {},
  };
  let capturadaVoid = null;
  T.install(rt);

  // create("HI") devolve o handle como int.
  T.reset();
  chamadas.length = 0;
  const r = capturadaFn(rt, null, { v: 'HI' });
  assert.equal(r.t, 'I', 'pix_text_create retorna int');
  assert.equal(r.v, 0, 'o primeiro handle é 0');

  // Um setter void devolve val(void, 0) — nunca val(int, undefined), que é o
  // que fazia o JSCPP estourar em "cannot read 'toString' of undefined".
  chamadas.length = 0;
  capturadaVoid(rt, null, { v: 0 }, { v: 20 });
  assert.deepEqual(chamadas, [['V', 0]], 'setter void devolve exatamente val(V, 0)');
});