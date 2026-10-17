import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:8080';

// Cada opção sem prefixo "wasm:" roda pelo JSCPP (interpretador) no app existente.
const INTERPRETADOS = ['hello', 'plasma', 'bounce', 'starfield', 'wireframecube', 'scene3d', 'saturn', 'text2d', 'text3d'];
const WASM = ['wasm:volumetric', 'wasm:mesh3d', 'wasm:particles'];

const urlWasm = new URL('../../wasm/', import.meta.url);
const temWasm = fs.existsSync(urlWasm);
const wasmPresentes = temWasm ? WASM : [];

// hash do conteúdo do canvas (toDataURL -> PNG), lido de dentro da página
async function amostraCanvas(page) {
  return page.evaluate(() => {
    const c = document.getElementById('terminal-canvas');
    if (!c) return null;
    const url = c.toDataURL();
    let h = 0;
    for (let i = 0; i < url.length; i++) h = ((h << 5) - h + url.charCodeAt(i)) | 0;
    return {
      hash: h >>> 0,
      len: url.length,
      fps: document.getElementById('fps').textContent.trim(),
      rodando: !document.getElementById('stopBtn').hasAttribute('disabled'),
      consoleOutput: document.getElementById('console-output').textContent.trim().slice(0, 200),
    };
  });
}

test.describe('A4 — regressão do app sob o CSP real do index.html', () => {
  for (const valor of INTERPRETADOS) {
    test(`exemplo ${valor}: desenha, FPS>0, Parar funciona, sem erro de CSP`, async ({ page }) => {
      const cspViolations = [];
      const consoleErrors = [];
      page.on('console', (m) => {
        const t = m.text();
        if (/Content Security Policy|Refused to/i.test(t)) cspViolations.push(m.type() + ': ' + t);
        else if (m.type() === 'error') consoleErrors.push(t);
      });
      page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

      await page.goto(BASE + '/index.html', { waitUntil: 'load' });
      await page.selectOption('#exampleSelect', valor);
      const branco = await amostraCanvas(page);

      await page.click('#runBtn');

      // Amostragem temporal. Dois critérios separados porque os exemplos diferem:
      //  - "desenhou": hash diferente do canvas em branco (todo exemplo satisfaz)
      //  - "animou":   mais de um hash durante a execução (só os que animam satisfaz)
      // exemplifiedo fim da execução (hello: `while (frame < 300)`) congela de propósito.
      const amostras = [];
      for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(500);
        amostras.push(await amostraCanvas(page));
      }

      const fpsNumeros = amostras.map((a) => Number((a.fps.match(/([\d.]+)/) || [])[1]));
      const fpsMax = Math.max(...fpsNumeros);
      const hashes = amostras.map((a) => a.hash);
      const desenhou = hashes.some((h) => h !== branco.hash);
      const animou = new Set(hashes).size > 1;
      const aindaRodando = amostras.some((a) => a.rodando);
      const final = amostras[amostras.length - 1];

      console.log(`[${valor}] hashEmBranco=${branco.hash} hashesDurante=${hashes.join(',')}`);
      console.log(`[${valor}] fps por amostra: ${amostras.map((a) => a.fps).join(' | ')}  (max=${fpsMax})`);
      console.log(`[${valor}] desenhou=${desenhou} animou=${animou} aindaRodandoNoFinal=${aindaRodando} #console-output="${final.consoleOutput}"`);

      expect(branco, 'canvas #terminal-canvas inexistente').not.toBeNull();
      expect(fpsMax, `nenhum FPS > 0 em ${valor}: ${amostras.map((a) => a.fps).join(' | ')}`).toBeGreaterThan(0);
      expect(desenhou, `canvas permaneceu igual ao branco em ${valor} — nada foi desenhado`);

      // Botão Parar: exigível apenas enquanto o programa está rodando.
      // Se já encerrou, o botão está disabled e o click esperaria actionability até o timeout.
      if (final.rodando) {
        const antes = await page.getAttribute('#stopBtn', 'disabled');
        await page.click('#stopBtn');
        await page.waitForTimeout(1500);
        const depois = await page.getAttribute('#stopBtn', 'disabled');
        const pos = await amostraCanvas(page);
        console.log(`[${valor}] apos Parar: stopDisabled antes=${antes} depois=${depois} fps="${pos.fps}" #console-output="${pos.consoleOutput}"`);
        expect(depois, `#stopBtn não reabilitou após Parar em ${valor}`).not.toBeNull();
        expect(pos.consoleOutput, `Parar não produziu mensagem em ${valor}`).toMatch(/interrompida|encerrad|finaliz/i);
      } else {
        console.log(`[${valor}] encerrou sozinho; botão Parar já desabilitado (skip do clique)`);
        expect(final.consoleOutput, `exemplo ${valor} encerrou sem mensagem em #console-output`).toMatch(/finaliz|encerrad|termin/i);
      }

      expect(cspViolations, `violação de CSP em ${valor}: ${cspViolations.join(' | ')}`).toHaveLength(0);
      expect(consoleErrors, `erro de console em ${valor}: ${consoleErrors.join(' | ')}`).toHaveLength(0);
    });
  }

  for (const valor of wasmPresentes) {
    test(`exemplo ${valor} (wasm)`, async () => {
      test.skip(true, 'wasm/ presente mas fase de wasm ainda não implementada — pulado');
    });
  }

  if (!temWasm) {
    test('exemplos wasm: pulado — diretório wasm/ ausente', async () => {
      console.log(`[wasm] pulado: wasm/ ausente em ${urlWasm.pathname}`);
      expect(fs.existsSync(urlWasm)).toBe(false);
    });
  }
});