import { test, expect } from '@playwright/test';

/**
 * Letreiros 2D e 3D no navegador real, nos DOIS caminhos de execução:
 *   - motor novo: Runner.compileAndRun (js/cpp/* → new Function)
 *   - caminho JSCPP: Interpreter.run (interpretado)
 *
 * Não basta o exemplo não dar erro: conferimos que o letreiro realmente
 * pintou pixels no canvas (interceptamos Pixela.present() e lemos o
 * getImageData), o que pega regressão de fonte vazia, handle quebrado e
 * z-buffer não inicializado — todos eles "rodam sem erro" e não desenham nada.
 */
const EXEMPLOS = ['text2d', 'text3d'];

async function preparar(page, exemplo) {
  await page.goto('/');
  await page.waitForLoadState('load');
  await page.waitForFunction(() => window.Pixela && window.TextEngine && window.Runner && window.Interpreter);
  await page.waitForTimeout(250);
  await page.selectOption('#exampleSelect', exemplo);
  await page.waitForTimeout(250);
  return page.evaluate(() => document.getElementById('code-editor').value);
}

/** roda `driver` até o primeiro present() e devolve os pixels do canvas. */
async function rodarECapturar(page, driver, src) {
  return page.evaluate(
    ({ driver, src }) =>
      new Promise((resolve) => {
        let capturado = null;
        const canvas = document.getElementById('terminal-canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const orig = window.Pixela.present;
        // IMPORTANTE: desenhamos ANTES de ler. present() é quem empacota os
        // pixels em células Braille e escreve no canvas; ler antes disso
        // enxerga o quadro anterior (ou a tela em branco).
        window.Pixela.present = function () {
          const r = orig.apply(this, arguments);
          if (!capturado) {
            capturado = Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
          }
          return r;
        };
        const cb = {
          onLog() {}, onFps() {},
          onError(m) { window.__erro = m; window.__stack = new Error(m).stack; },
          onFinished() {},
        };
        if (driver === 'runner') window.Runner.compileAndRun(src, cb);
        else window.Interpreter.run(src, cb);

        const t0 = Date.now();
        const poll = setInterval(() => {
          if (capturado || window.__erro || Date.now() - t0 > 10000) {
            clearInterval(poll);
            window.Runner.stop();
            window.Interpreter.stop();
            resolve({ pixels: capturado, erro: window.__erro || null, stack: window.__stack || null });
          }
        }, 40);
      }),
    { driver, src }
  );
}

/** conta pixels com brilho (o fundo é preto; o texto é colorido). */
function contarAcesos(pixels) {
  let n = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] > 8 || pixels[i + 1] > 8 || pixels[i + 2] > 8) n++;
  }
  return n;
}

for (const exemplo of EXEMPLOS) {
  test(`${exemplo}: motor novo (codegen) desenha o letreiro`, async ({ page }) => {
    const src = await preparar(page, exemplo);
    const { pixels, erro } = await rodarECapturar(page, 'runner', src);
    expect(erro, `erro no motor novo: ${erro}`).toBeNull();
    expect(pixels, 'nenhum quadro capturado').not.toBeNull();
    const acesos = contarAcesos(pixels);
    console.log(`  ${exemplo} runner: ${acesos} pixels acesos`);
    expect(acesos, 'o letreiro não pintou nada no canvas').toBeGreaterThan(500);
  });

  test(`${exemplo}: caminho JSCPP desenha o letreiro`, async ({ page }) => {
    const src = await preparar(page, exemplo);
    const { pixels, erro } = await rodarECapturar(page, 'interpreter', src);
    expect(erro, `erro no JSCPP: ${erro}`).toBeNull();
    expect(pixels, 'nenhum quadro capturado').not.toBeNull();
    const acesos = contarAcesos(pixels);
    console.log(`  ${exemplo} jscpp : ${acesos} pixels acesos`);
    expect(acesos, 'o letreiro não pintou nada no canvas').toBeGreaterThan(500);
  });

  test(`${exemplo}: os dois motores produzem a mesma imagem`, async ({ page }) => {
    const srcRunner = await preparar(page, exemplo);
    const viaRunner = await rodarECapturar(page, 'runner', srcRunner);
    const srcJscpp = await preparar(page, exemplo);
    const viaJscpp = await rodarECapturar(page, 'interpreter', srcJscpp);

    expect(viaRunner.erro).toBeNull();
    expect(viaJscpp.erro).toBeNull();
    expect(viaRunner.pixels).not.toBeNull();
    expect(viaJscpp.pixels).not.toBeNull();

    let diff = 0;
    const a = viaRunner.pixels, b = viaJscpp.pixels;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) diff++;
    }
    const total = a.length / 4;
    const pct = ((diff / total) * 100).toFixed(2);
    console.log(`  ${exemplo} paridade: ${pct}% diferente (${diff}/${total})`);
    expect(diff / total, `${exemplo}: motores divergiram`).toBeLessThan(0.5);
  });
}

test('as 45 funções de letreiro estão registradas e as constantes valem o esperado', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('load');
  await page.waitForFunction(() => window.TextEngine);

  const info = await page.evaluate(() => {
    const nomes = Object.keys(window.TextEngine.SIGNATURES);
    return {
      total: nomes.length,
      semApi: nomes.filter((n) => typeof window.TextEngine.api[n] !== 'function'),
      constantes: window.TextEngine.CONSTANTS,
    };
  });

  expect(info.total).toBe(45);
  expect(info.semApi).toEqual([]);
  expect(info.constantes).toMatchObject({
    PIX_ALIGN_LEFT: 0, PIX_ALIGN_CENTER: 1, PIX_ALIGN_RIGHT: 2,
    PIX_EDGE_NONE: 0, PIX_EDGE_WRAP: 1, PIX_EDGE_BOUNCE: 2,
    PIX_STYLE_WIRE: 0, PIX_STYLE_SOLID: 1,
  });
});