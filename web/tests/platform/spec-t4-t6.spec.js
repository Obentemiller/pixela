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

test.describe('T4 — laço infinito no Worker é mortal via terminate()', () => {
  test('T4', async ({ page }) => {
    const seen = watch(page);
    await page.goto(BASE + FIX + '/t4.html', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__done === true, null, { timeout: 30000 });
    const r = await page.evaluate(() => window.__report);
    const printed = await page.textContent('#out');

    console.log('=== T4 CONSOLE DA PAGINA ===\n' + printed);
    console.log('=== T4 REPORT ===\n' + JSON.stringify(r, null, 2));
    console.log('=== T4 CSP VIOLATIONS ===\n' + (seen.csp.join('\n') || '(nenhuma)'));

    // 1. o principal NONDEVE travar: responded within timeout
    expect(r.principalVivo, 'principal travou — terminate() nao matou').toBe(true);
    // 2. houve ticks durante os 2s do laço
    expect(r.ticksDurante, 'zero ticks = pagina travada').toBeGreaterThan(0);
    // 3. depois do terminate o principal segue vivo
    expect(r.ticksDepois, 'principal parou apos terminate()').toBeGreaterThan(0);
    // 4. um novo Worker responde
    expect(r.aposTerminate.novoWorkerRespondeu).toBe(true);
    expect(seen.csp).toHaveLength(0);
  });
});

test.describe('T6 — postMessage com ArrayBuffer transferível (Worker → principal)', () => {
  test('T6', async ({ page }) => {
    const seen = watch(page);
    await page.goto(BASE + FIX + '/t6.html', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__done === true, null, { timeout: 30000 });
    const r = await page.evaluate(() => window.__report);
    const printed = await page.textContent('#out');

    console.log('=== T6 CONSOLE DA PAGINA ===\n' + printed);
    console.log('=== T6 REPORT ===\n' + JSON.stringify(r, null, 2));

    expect(r.erro).toBeUndefined();
    expect(r.msgs, 'nenhuma mensagem recebida').toBeGreaterThan(100);
    expect(r.msgsPorSegundo, 'taxa ficou muito abaixo do alvo').toBeGreaterThan(30);
    expect(r.latenciaMediaMs).toBeGreaterThan(0);
    expect(r.latenciaP95Ms).toBeGreaterThan(0);
    expect(seen.csp).toHaveLength(0);
  });
});