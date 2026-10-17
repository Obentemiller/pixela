/**
 * test-platform.mjs — Testes de plataforma para o portão A (A3).
 * 
 * testa T1–T7 conforme o prompt. Roda em Node com Playwright.
 * 
 * Critérios de decisão (todos obrigatórios):
 *   (a) laço infinito é mortal via terminate;
 *   (b) código do usuário sem acesso a DOM;
 *   (c) quadros transferíveis;
 *   (d) sem 'unsafe-eval' no CSP da página.
 * Se T1 passar e T4 passar, a decisão é Worker.
 * Se T1 falhar, avalia-se: Worker com blob → backend de closure compilation → 'unsafe-eval' restrito.
 */

import { chromium, test, expect } from '@playwright/test';

// O CSP do index.html (atualizado com worker-src 'self')
const CSP = `default-src 'none'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; worker-src 'self';`;

// Helper: serve a página por um servidor HTTP simples
async function servePage(pageContent, port = 0) {
  const http = await import('node:http');
  const fs = await import('node:fs');
  const path = await import('node:path');
  
  const htmlPath = path.join('/tmp', 'test-platform-csp.html');
  fs.writeFileSync(htmlPath, pageContent);
  
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/' || req.url === '') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        fs.createReadStream(htmlPath).pipe(res);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });
    
    server.listen(port, () => {
      resolve({ server, url: `http://localhost:${port}/`, path: htmlPath });
    });
  });
}

// T1: Worker de módulo com new Function dentro
async function testT1(page) {
  console.log('=== T1: Worker + new Function ===');
  const result = await page.evaluate(() => {
    // Cria um worker com URL de blob
    const worker = new Worker(new URL('./test-worker-t1.js', import.meta.url), {
      type: 'module',
    });
    
    return new Promise((resolve) => {
      worker.onmessage = (e) => {
        resolve({ success: e.data.success, message: e.data.message });
      };
      worker.onerror = (e) => {
        resolve({ success: false, message: 'Worker error: ' + e.message });
      };
      
      worker.postMessage('start');
    });
  });
  return result;
}

// T2: new Function na thread principal (controle - deve falhar com CSP atual)
async function testT2(page) {
  console.log('=== T2: new Function na thread principal (controle) ===');
  const result = await page.evaluate(() => {
    try {
      // Isso deve falhar porque o CSP da página restringe eval
      const result = new Function('return 1+1')();
      return { success: true, value: result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  return result;
}

// T3: iframe sandbox herda CSP
async function testT3(page) {
  console.log('=== T3: iframe sandbox ===');
  const result = await page.evaluate(() => {
    // Cria iframe sandboxed
    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-scripts';
    document.body.appendChild(iframe);
    
    return new Promise((resolve) => {
      iframe.onload = () => {
        try {
          // Tenta eval dentro do iframe
          const frameDoc = iframe.contentDocument || iframe.contentWindow.document;
          const result = frameDoc.defaultView.eval('1+1');
          resolve({ success: true, value: result });
        } catch (e) {
          resolve({ success: false, error: e.message });
        } finally {
          document.body.removeChild(iframe);
        }
      };
    });
  });
  return result;
}

// T4: Laço infinito no Worker - terminate mata
async function testT4(page) {
  console.log('=== T4: Laço infinito no Worker + terminate ===');
  const result = await page.evaluate(() => {
    return new Promise((resolve) => {
      const worker = new Worker(new URL('./test-worker-t4.js', import.meta.url), {
        type: 'module',
      });
      
      let resolved = false;
      setTimeout(() => {
        if (!resolved) {
          worker.terminate();
          resolve({ timedOut: true, message: 'Timeout reached, worker terminated' });
        }
      }, 3000);
      
      worker.onmessage = (e) => {
        if (e.data.type === 'heartbeat') {
          // Worker está vivo, não terminamos ainda
        }
        if (e.data.type === 'done') {
          resolved = true;
          resolve({ success: true, message: 'Worker finished normally' });
        }
      };
      
      worker.postMessage('start infinite loop');
    });
  });
  return result;
}

// T5: Laço infinito no iframe sandbox - página principal trava?
async function testT5(page) {
  console.log('=== T5: Laço infinito no iframe sandbox ===');
  const result = await page.evaluate(() => {
    return new Promise((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.sandbox = 'allow-scripts';
      document.body.appendChild(iframe);
      
      iframe.onload = () => {
        // Inicia laço infinito no iframe
        iframe.contentWindow.postMessage('start infinite loop', '*');
        
        // Aguarda 3 segundos e verifica se a page principal travou
        setTimeout(() => {
          const mainStillAlive = !document.hidden && document.visibilityState === 'visible';
          document.body.removeChild(iframe);
          resolve({ mainAlive: mainStillAlive, iframeRemoved: true });
        }, 3500);
      };
    });
  });
  return result;
}

// T6: postMessage com ArrayBuffer transferível
async function testT6() {
  console.log('=== T6: postMessage transferível ===');
  return new Promise((resolve) => {
    if (!self.Worker) {
      resolve({ skipped: true, reason: 'No Worker support' });
      return;
    }
    
    const worker = new Worker(new URL('./test-worker-t6.js', import.meta.url), {
      type: 'module',
    });
    
    let dataReceived = false;
    worker.onmessage = (e) => {
      dataReceived = true;
      resolve({ success: e.data.success, transferred: e.data.transferred });
    };
    
    worker.onerror = (e) => {
      resolve({ success: false, error: e.message });
    };
    
    worker.postMessage('start', [new ArrayBuffer(4)]); // transferível
  });
}

// T7: SharedArrayBuffer indisponível (GitHub Pages)
async function testT7() {
  console.log('=== T7: crossOriginIsolated / SharedArrayBuffer ===');
  const result = await new Promise((resolve) => {
    const coi = self.crossOriginIsolated || false;
    const sb = self.SharedArrayBuffer || false;
    resolve({ crossOriginIsolated: coi, SharedArrayBuffer: sb, gitHubPagesSafe: !coi && !sb });
  });
  return result;
}

async function runTests() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    // Aplicar o CSP
    httpCredentials: {},
    // DisablehttpsErrors: true,
  });
  
  // Adicionar o CSP meta tag (já está no index.html, mas vamos garantir)
  const page = await context.newPage();
  await page.setContent(`
    <!DOCTYPE html>
    <html><head><meta http-equiv="Content-Security-Policy" content="${CSP}"></head><body></body></html>
  `);
  
  console.log('=== Testes de Plataforma ===\n');
  
  // T1
  const t1 = await testT1(page);
  console.log(`T1 - Worker + new Function: ${t1.success ? 'PASSOU' : 'FALHOU'} - ${t1.message}`);
  
  // T2
  const t2 = await testT2(page);
  console.log(`T2 - new Function thread principal: ${t2.success ? 'EXECUTOU' : 'BLOCOU'} - ${t2.error || t2.value}`);
  
  // T3
  const t3 = await testT3(page);
  console.log(`T3 - iframe sandbox eval: ${t3.success ? 'SUCESSO' : 'BLOQUEADO'} - ${t3.error || t3.value}`);
  
  // T4
  const t4 = await testT4(page);
  console.log(`T4 - Laço infinito + terminate: ${t4.success ? 'MORTO' : 'VIVO'} - ${t4.message}`);
  
  // T5 - só no navegador, pular por enquanto
  console.log('T5 - Laço infinito iframe: (teste visual, pular automação)');
  
  // T6
  const t6 = await testT6();
  console.log(`T6 - postMessage transferível: ${t6.skipped ? 'PULADO' : t6.success ? 'SUCESSO' : 'FALHOU'} - ${t6.transferred ? 'transferido' : ''}`);
  
  // T7
  const t7 = await testT7();
  console.log(`T7 - crossOriginIsolated/SA: CORS=${t7.crossOriginIsolated}, SA=${t7.SharedArrayBuffer}, gitHubPagesSafe=${t7.gitHubPagesSafe}`);
  
  await browser.close();
  
  // Resumo da decisão
  console.log('\n=== Decisão de Plataforma ===');
  const t1passed = t1.success;
  const t4passed = t4.success || t4.timedOut;
  
  if (t1passed && t4passed) {
    console.log('✅ DECISÃO: Usar Worker (new Worker com type="module")');
    console.log('   - T1 passa: Worker aceita new Function');
    console.log('   - T4 passa: Laço infinito é mortal via terminate()');
  } else if (!t1passed) {
    console.log('⚠️ DECISÃO: Worker com nova Function falhou');
    console.log('   - Avaliar alternativa: backend de closure compilation sem eval');
    console.log('   - Se também falhar: adicionar \'unsafe-eval\' restrito');
  } else {
    console.log('⚠️ DECISÃO: Índice misto - revisar');
  }
  
  // T7 é crítica para GitHub Pages
  if (!t7.gitHubPagesSafe) {
    console.log('⚠️ Aviso: SharedArrayBuffer disponível — GitHub Pages pode bloquear');
    console.log('   - Necessário COOP/COEP ou remover SAB do código');
  }
  
  await browser.close();
}

runTests().catch(console.error);