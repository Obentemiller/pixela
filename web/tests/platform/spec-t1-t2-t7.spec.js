import { test, expect } from '@playwright/test';

const BASE = 'http://127.0.0.1:8080';
const FIX = '/tests/platform/fixtures';

function watch(page) {
  const csp = [];
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      const t = m.text();
      if (/Content Security Policy|Refused to/i.test(t)) csp.push(m.type() + ': ' + t);
      else errors.push(m.type() + ': ' + t);
    }
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  return { csp, errors };
}

async function runFixture(page, file) {
  await page.goto(BASE + FIX + '/' + file, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__done === true, null, { timeout: 30000 });
  return page.evaluate(() => window.__report);
}

test.describe('T1 — Worker de módulo executa new Function sob o CSP real', () => {
  test('T1', async ({ page }) => {
    const seen = watch(page);
    const r = await runFixture(page, 't1.html');
    const cspText = await page.textContent('#out');

    console.log('=== T1 CONSOLE DA PAGINA ===\n' + cspText);
    console.log('=== T1 CSP VIOLATIONS ===\n' + (seen.csp.join('\n') || '(nenhuma)'));
    console.log('=== T1 OUTROS ERROS DE CONSOLE ===\n' + (seen.errors.join('\n') || '(nenhum)'));
    console.log('=== T1 REPORT ===\n' + JSON.stringify(r, null, 2));

    expect(r, 'worker deve responder').not.toEqual({ ok: false, stage: 'timeout' });
    expect(r.ok, 'new Function deve funcionar no Worker; msg real: ' + r.message).toBe(true);
    expect(r.stage).toBe('newFunction');
    expect(r.value).toBe(2);
    expect(seen.csp, 'não deve haver violação de CSP: ' + seen.csp.join(' | ')).toHaveLength(0);
  });
});

test.describe('T2 (controle) — new Function na thread principal', () => {
  test('T2', async ({ page }) => {
    const seen = watch(page);
    const r = await runFixture(page, 't2.html');
    const cspText = await page.textContent('#out');

    console.log('=== T2 CONSOLE DA PAGINA ===\n' + cspText);
    console.log('=== T2 MENSAGEM REAL DO NAVEGADOR === name=' + r.name + ' message=' + r.message);
    console.log('=== T2 blocked=' + r.blocked);
    console.log('=== T2 CSP VIOLATIONS ===\n' + (seen.csp.join('\n') || '(nenhuma)'));

    // Registra o comportamento real; a decisão de plataforma depende deste número.
    if (r.blocked) {
      expect(['EvalError', 'SyntaxError', 'TypeError']).toContain(r.name);
    } else {
      expect(r.value).toBe(2);
    }
  });
});

test.describe('T7 — GitHub Pages: crossOriginIsolated e SharedArrayBuffer', () => {
  test('T7', async ({ page }) => {
    const seen = watch(page);
    await page.goto(BASE + FIX + '/t7.html', { waitUntil: 'load' });
    const printed = await page.textContent('#out');
    const r = await page.evaluate(() => ({
      crossOriginIsolated: self.crossOriginIsolated,
      typeofSharedArrayBuffer: typeof SharedArrayBuffer,
      origin: location.origin,
    }));

    console.log('=== T7 IMPRESSO NA PAGINA ===\n' + printed);
    console.log('=== T7 typeof SharedArrayBuffer === ' + r.typeofSharedArrayBuffer);
    console.log('=== T7 crossOriginIsolated === ' + r.crossOriginIsolated);
    console.log('=== T7 origin === ' + r.origin);
    console.log('=== T7 CSP VIOLATIONS ===\n' + (seen.csp.join('\n') || '(nenhuma)'));

    expect(typeof r.typeofSharedArrayBuffer).toBe('string');
    expect(r.origin).toBe(BASE);
  });
});