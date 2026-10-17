import { test, chromium } from '@playwright/test';

test('baseline: versão do navegador e FPS por exemplo', async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  console.log('BROWSER_VERSION=' + browser.version());
  await browser.close();

  // A tabela em si é produzida por tests/e2e/regressao-app.spec.js.
  // Aqui só fixamos a versão do navegador usada como linha de base.
  const b2 = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await b2.newPage();
  await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'load' });
  console.log('USER_AGENT=' + await page.evaluate(() => navigator.userAgent));
  await b2.close();
});