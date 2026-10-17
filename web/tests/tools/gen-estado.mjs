#!/usr/bin/env node
/**
 * gen-estado.mjs — GERA docs/estado.md a partir da execução real.
 *
 * Para cada arquivo de js/cpp/ (recursivo, *.js):
 *   - conta linhas
 *   - roda `node --check`
 *   - tenta `import()` e registra o erro real, se houver
 *   - EXECUTA cada arquivo de teste via TAP e lê `# tests`/`# pass`/`# fail`
 *   - classifica o status a partir dessas medições
 *
 * REGRA DE STATUS (>= 10 testes passando):
 *   funcional       — >= 10 testes passando no módulo
 *   pouco testado   — 1 a 9 testes passando
 *   SEM teste       — 0 testes passando
 *
 * CRITÉRIO DE CONSISTÊNCIA: a soma de `pass` por ARQUIVO DE TESTE deve ser
 * igual ao total de `npm test`. Se divergirem, o script falha.
 *
 * Nada aqui é escrito à mão. Uso: node tests/tools/gen-estado.mjs [--skip-tests]
 */
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CPP_DIR = join(RAIZ, 'js', 'cpp');
const TESTS_DIR = join(RAIZ, 'tests');
const SKIP_TESTS = process.argv.includes('--skip-tests');
const MIN_FUNCIONAL = 10;

function listarJs(dir) {
  const out = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...listarJs(p));
    else if (nome.endsWith('.js')) out.push(p);
  }
  return out.sort();
}

function listarTestes(dir, padrao) {
  const out = [];
  if (!existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) stack.push(p);
      else if (padrao.test(e)) out.push(p);
    }
  }
  return out.sort();
}

function contarLinhas(caminho) {
  return readFileSync(caminho, 'utf8').split('\n').length;
}

function nodeCheck(caminho) {
  try {
    execFileSync(process.execPath, ['--check', caminho], { stdio: 'pipe' });
    return { ok: true, erro: null };
  } catch (e) {
    const saida = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    return { ok: false, erro: saida.split('\n').filter((l) => /error/i.test(l))[0]?.trim() ?? 'erro desconhecido' };
  }
}

async function tentaImport(caminho) {
  try {
    const mod = await import('file://' + caminho);
    return { ok: true, erro: null, exports: Object.keys(mod) };
  } catch (e) {
    return { ok: false, erro: `${e.constructor.name}: ${e.message.split('\n')[0]}`, exports: [] };
  }
}

/**
 * Executa um arquivo de teste com TAP e devolve { tests, pass, fail }.
 * Usa `--test-reporter=tap` para saída contável.
 */
function executarTap(caminho) {
  try {
    const out = execFileSync(process.execPath,
      ['--test', '--test-reporter=tap', caminho],
      { stdio: 'pipe', encoding: 'utf8' });
    return lerTap(out);
  } catch (e) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    return lerTap(out);
  }
}

function lerTap(out) {
  const tests = (out.match(/^# tests (\d+)/m) ?? [])[1];
  const pass = (out.match(/^# pass (\d+)/m) ?? [])[1];
  const fail = (out.match(/^# fail (\d+)/m) ?? [])[1];
  const cancelled = (out.match(/^# cancelled (\d+)/m) ?? [])[1];
  const skipped = (out.match(/^# skipped (\d+)/m) ?? [])[1];
  return {
    tests: Number(tests ?? 0),
    pass: Number(pass ?? 0),
    fail: Number(fail ?? 0),
    cancelled: Number(cancelled ?? 0),
    skipped: Number(skipped ?? 0),
  };
}

/**
 * Executa todos os arquivos de teste Node de uma vez só (`npm test` equivalente)
 * e devolve o total para a verificação de consistência.
 */
function totalDeTodosOsTestes() {
  const todos = listarTestes(TESTS_DIR, /\.test\.js$/);
  if (todos.length === 0) return { tests: 0, pass: 0, fail: 0 };
  try {
    const out = execFileSync(process.execPath, ['--test', ...todos],
      { stdio: 'pipe', encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    return lerTap(out);
  } catch (e) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    return lerTap(out);
  }
}

/**
 * Executa as suítes Playwright (browser) e devolve { passa, falha } por arquivo.
 * Requer servidor estático em 127.0.0.1:8080.
 */
function executarBrowser(arquivosBrowser) {
  const resultado = new Map();
  let servidorOk = false;
  if (arquivosBrowser.length > 0) {
    try {
      execFileSync('curl', ['-s', '-o', '/dev/null', '-f', 'http://127.0.0.1:8080/index.html'],
        { stdio: 'pipe' });
      servidorOk = true;
    } catch { servidorOk = false; }
  }

  for (const p of arquivosBrowser) {
    if (!servidorOk) {
      resultado.set(p, { passa: 0, falha: 0, erro: 'servidor estático não está no ar (rode `npm run serve`)' });
      continue;
    }
    try {
      const out = execFileSync('npx', ['playwright', 'test', relative(TESTS_DIR, p), '--reporter=list'],
        { stdio: 'pipe', encoding: 'utf8', cwd: RAIZ });
      resultado.set(p, { passa: (out.match(/^\s+✓/gm) || []).length, falha: 0, erro: null });
    } catch (e) {
      const out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
      resultado.set(p, {
        passa: (out.match(/^\s+✓/gm) || []).length,
        falha: (out.match(/^\s+✘/gm) || []).length,
        erro: 'erro ao rodar',
      });
    }
  }
  return resultado;
}

function classificar({ check, imp, passando, usaSelf }) {
  if (!check.ok) return 'QUEBRADO (não passa node --check)';
  if (!imp.ok && !(usaSelf && /self is not defined/.test(imp.erro ?? ''))) {
    return 'QUEBRADO (não importa em Node)';
  }
  if (passando >= MIN_FUNCIONAL) return `funcional (${passando} testes passando)${usaSelf ? ' [módulo de Worker: usa self]' : ''}`;
  if (passando >= 1) return `pouco testado (${passando} de ${MIN_FUNCIONAL} testes passando)${usaSelf ? ' [módulo de Worker: usa self]' : ''}`;
  return `SEM teste automatizado${usaSelf ? ' [módulo de Worker: usa self]' : ''}`;
}

// ---------------------------------------------------------------- execução

const arquivos = listarJs(CPP_DIR);
const mapaModulos = JSON.parse(readFileSync(join(RAIZ, 'tests/tools/module-map.json'), 'utf8'));
const arquivosUnit = listarTestes(TESTS_DIR, /\.test\.js$/);
const arquivosBrowser = listarTestes(TESTS_DIR, /\.spec\.js$/);

// VERIFICAÇÃO DO MAPA — o gen-estado FALHA (exit != 0) se:
//   (a) algum arquivo de teste no disco não estiver no module-map.json
//   (b) o module-map.json citar arquivo inexistente
// Isso fecha a lacuna apontada na seção 1 da ordem: a verificação de
// consistência não detecta teste novo ausente do mapa (a soma ainda bateria).
{
  const noDisco = new Set();
  for (const p of [...arquivosUnit, ...arquivosBrowser]) noDisco.add(relative(RAIZ, p));

  const mapeados = new Set();
  for (const [mod, lista] of Object.entries(mapaModulos)) {
    if (mod.startsWith('_')) continue; // chaves de documentação
    for (const a of lista) {
      if (!existsSync(join(RAIZ, a))) {
        console.error(`[gen-estado] ERRO: module-map.json cita arquivo inexistente: ${mod} -> ${a}`);
        process.exitCode = 1;
      }
      mapeados.add(a);
    }
  }

  const foraDoMapa = [...noDisco].filter((a) => !mapeados.has(a)).sort();
  if (foraDoMapa.length > 0) {
    console.error(`[gen-estado] ERRO: ${foraDoMapa.length} arquivo(s) de teste no disco NÃO estão no module-map.json:`);
    for (const a of foraDoMapa) console.error(`[gen-estado]   ${a}`);
    console.error(`[gen-estado] Adicione-os a tests/tools/module-map.json (dono: integracao).`);
    process.exitCode = 1;
  } else {
    console.error(`[gen-estado] MAPA OK: ${noDisco.size} arquivo(s) de teste, todos no module-map.json`);
  }
}

// 1. executa as suítes
let suites = new Map(); // caminho -> {tests, pass, fail, cancelled, skipped}
let suitesBrowser = new Map();
let totalGeral = { tests: 0, pass: 0, fail: 0 };

if (!SKIP_TESTS) {
  console.error(`[gen-estado] executando ${arquivosUnit.length} arquivo(s) de teste Node…`);
  for (const p of arquivosUnit) {
    const r = executarTap(p);
    suites.set(p, r);
    console.error(`[gen-estado]   ${relative(RAIZ, p)}: ${r.pass} passam, ${r.fail} falham (de ${r.tests})`);
  }
  totalGeral = totalDeTodosOsTestes();
  console.error(`[gen-estado] TOTAL (node --test ${arquivosUnit.length} arquivos): ${totalGeral.pass} passam, ${totalGeral.fail} falham (de ${totalGeral.tests})`);

  console.error(`[gen-estado] executando ${arquivosBrowser.length} arquivo(s) de teste browser…`);
  suitesBrowser = executarBrowser(arquivosBrowser);
  for (const [p, r] of suitesBrowser) {
    console.error(`[gen-estado]   ${relative(RAIZ, p)}: ${r.passa} passam${r.erro ? ' (' + r.erro + ')' : ''}`);
  }
}

// 2. Verificação de consistência: soma por ARQUIVO (Node) == total de `npm test`.
// Os testes browser (`.spec.js`) rodam via Playwright e são reportados à parte;
// não entram na comparação, que é Node-vs-Node.
let somaPorArquivo = 0;
for (const p of arquivosUnit) {
  const r = suites.get(p);
  if (r) somaPorArquivo += r.pass;
}
let somaBrowser = 0;
for (const p of arquivosBrowser) {
  const r = suitesBrowser.get(p);
  if (r && !r.erro) somaBrowser += r.passa;
}
const divergencia = somaPorArquivo - totalGeral.pass;
if (!SKIP_TESTS && divergencia !== 0) {
  console.error(`[gen-estado] ERRO DE CONSISTÊNCIA: soma por arquivo = ${somaPorArquivo}, total = ${totalGeral.pass} (divergência ${divergencia})`);
  console.error(`[gen-estado] Isso significa que um teste foi executado mais de uma vez ou que o module-map está errado.`);
  process.exitCode = 1;
} else {
  console.error(`[gen-estado] CONSISTÊNCIA: soma por arquivo (Node) = ${somaPorArquivo} == total = ${totalGeral.pass} ✓`);
  console.error(`[gen-estado] (browser à parte: ${somaBrowser} passam)`);
}

// 3. monta a tabela por módulo
const tabela = [];
for (const abs of arquivos) {
  const rel = relative(RAIZ, abs);
  const nome = relative(CPP_DIR, abs).replace(/\.js$/, '');
  const nLinhas = contarLinhas(abs);
  const check = nodeCheck(abs);
  const imp = await tentaImport(abs);
  const arquivosTeste = (mapaModulos[nome] ?? [])
    .filter((a) => existsSync(join(RAIZ, a)));
  const usaSelf = readFileSync(abs, 'utf8').includes('self.');

  let passando = 0, falhando = 0, semRodar = [];
  for (const at of arquivosTeste) {
    const absTeste = join(RAIZ, at);
    // Testes Node (.test.js) e browser (.spec.js) ambos contam para o módulo.
    const rNode = suites.get(absTeste);
    const rBrowser = suitesBrowser.get(absTeste);
    if (rNode) {
      passando += rNode.pass;
      falhando += rNode.fail;
    } else if (rBrowser) {
      if (rBrowser.erro) { semRodar.push(at + ' (' + rBrowser.erro + ')'); continue; }
      passando += rBrowser.passa;
      falhando += rBrowser.falha;
    } else {
      semRodar.push(at + ' (não executado)');
    }
  }

  const status = classificar({ check, imp, passando, usaSelf });
  tabela.push({ nome, rel, nLinhas, check, imp, arquivosTeste, usaSelf, passando, falhando, semRodar, status });
}

// ---------------------------------------------------------------- relatório

const L = [];
L.push('# Estado de `js/cpp/` — gerado por `tests/tools/gen-estado.mjs`');
L.push('');
L.push('> **Não edite este arquivo à mão.** Regenerar com `npm run gen-estado`.');
L.push(`> Gerado em ${new Date().toISOString()}`);
L.push('');
L.push('## Regra de status');
L.push('');
L.push(`- **funcional** — \`>= ${MIN_FUNCIONAL}\` testes automatizados PASSANDO no módulo`);
L.push(`- **pouco testado** — de 1 a ${MIN_FUNCIONAL - 1} testes passando`);
L.push('- **SEM teste automatizado** — 0 testes passando');
L.push('- **QUEBRADO** — falha em `node --check` ou no `import()`');
L.push('');
L.push('A contagem vem da **execução real** das suítes (`node --test --test-reporter=tap`),');
L.push('não de uma contagem de referências no código. O mapeamento módulo→testes');
L.push('está em `tests/tools/module-map.json` (mantido à mão e revisado).');
L.push('');
L.push('## Tabela');
L.push('');
L.push('| Arquivo | Linhas | `node --check` | Importa em Node | Testes executados | Passaram | Status |');
L.push('|---|---:|---|---|---:|---:|---|');
for (const t of tabela) {
  const impCol = t.imp.ok ? 'ok' : (t.usaSelf ? 'n/a (self)' : 'FALHOU');
  L.push(`| \`${t.rel}\` | ${t.nLinhas} | ${t.check.ok ? 'ok' : 'FALHOU'} | ${impCol} | ${t.arquivosTeste.length} arquivo(s) | ${t.passando} | ${t.status} |`);
}
L.push('');

// Resumo de consistência
L.push('## Consistência');
L.push('');
L.push(`- Soma de \`pass\` por **arquivo de teste** (Node): ${somaPorArquivo}`);
L.push(`- Total de \`node --test\` (todos os arquivos): ${totalGeral.pass}`);
L.push(`- Divergência: ${divergencia} ${divergencia === 0 ? '✓' : '✗'}`);
L.push(`- Testes browser (Playwright, à parte): ${somaBrowser} passam`);
L.push('');

L.push('## Detalhes por arquivo');
L.push('');
for (const t of tabela) {
  L.push(`### \`${t.rel}\``);
  L.push('');
  L.push(`- **Linhas:** ${t.nLinhas}`);
  L.push(`- **node --check:** ${t.check.ok ? 'ok (exit 0)' : 'FALHOU — ' + t.check.erro}`);
  L.push(`- **import em Node:** ${t.imp.ok
    ? 'ok — exports: `' + t.imp.exports.join('`, `') + '`'
    : (t.usaSelf ? 'não aplicável — usa `self`, roda em Worker (' + t.imp.erro + ')' : 'FALHOU — ' + t.imp.erro)}`);
  L.push(`- **Arquivos de teste no mapa:** ${t.arquivosTeste.length ? t.arquivosTeste.map((a) => '`' + a + '`').join(', ') : '(nenhum)'}`);
  L.push(`- **Testes passando / falhando:** ${t.passando} / ${t.falhando}`);
  if (t.semRodar.length) L.push(`- **Não executados:** ${t.semRodar.join(', ')}`);
  L.push(`- **Status:** ${t.status}`);
  L.push('');
}

const out = join(RAIZ, 'docs', 'estado.md');
writeFileSync(out, L.join('\n'));
console.log(L.join('\n'));
console.log(`\n[gen-estado] escrito em ${relative(RAIZ, out)} (${tabela.length} arquivos)`);
