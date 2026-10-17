/**
 * tests/tools/verify-reports.mjs — confere `reports/SHA256SUMS`.
 *
 * Verificador PURO: não roda nenhuma ferramenta e não reescreve nenhum log.
 * Se regerasse, o manifesto acusaria a própria execução e a conferência não
 * diria nada.
 *
 * Três coisas são conferidas, nesta ordem:
 *   1. `sha256sum -c reports/SHA256SUMS` — o hash de cada arquivo confere.
 *   2. O manifesto NÃO se lista (o defeito que `reports/sha256.log` tinha).
 *   3. Todo arquivo de `reports/` que ficou fora do manifesto tem motivo
 *      escrito em `reports/SHA256SUMS.excluidos.txt`.
 *
 * Sai com exit 0 só se as três passarem.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { andar, RAIZ, MANIFESTO, EXCLUIDOS, EXCLUSOES } from './gen-sha256sums.mjs';

const linhas = [];
const problemas = [];

linhas.push('=== verify-reports ===');
linhas.push(`manifesto: reports/SHA256SUMS (${existsSync(MANIFESTO) ? 'presente' : 'AUSENTE'})`);

// ---- 1) sha256sum -c
if (!existsSync(MANIFESTO)) {
  problemas.push('reports/SHA256SUMS não existe — rode `node tests/tools/gen-sha256sums.mjs`');
} else {
  try {
    const saida = execFileSync('sha256sum', ['-c', MANIFESTO], {
      cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const ruins = saida.split('\n').filter((l) => /FALHOU|NÃO coincide/i.test(l));
    linhas.push(`sha256sum -c: ${saida.split('\n').filter(Boolean).length} arquivos, ${ruins.length} divergentes`);
    for (const r of ruins) linhas.push(`  ${r}`);
    if (ruins.length > 0) {
      // Diagnostico do caso comum: um log criado DEPOIS do manifesto nao esta
      // nele, e o `sha256sum -c` acusa "No such file or directory". Isso nao e
      // corrupcao — e ordem de execucao, e a saida diz qual.
      const nomes = ruins.map((r) => r.split(':')[0].trim());
      const faltando = nomes.filter((n) => n && !existsSync(join(RAIZ, n.split(':')[0])));
      if (faltando.length === ruins.length && faltando.length > 0) {
        linhas.push('  todos os divergentes NAO estao no manifesto: foram criados depois dele.');
        linhas.push('  rode `npm run gen-sha256sums` e conferi de novo.');
      }
      problemas.push(`${ruins.length} arquivo(s) com hash divergente`);
    }
  } catch (e) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    linhas.push('sha256sum -c: FALHOU');
    for (const l of out.split('\n').filter((x) => /FALHOU|NÃO coincide/i.test(x))) linhas.push(`  ${l}`);
    problemas.push('sha256sum -c saiu diferente de zero');
  }
}

// ---- 2) o manifesto nao se lista
const texto = existsSync(MANIFESTO) ? readFileSync(MANIFESTO, 'utf8') : '';
const listados = texto.split('\n').filter(Boolean).map((l) => l.slice(66).trim());
linhas.push(`entradas no manifesto: ${listados.length}`);
const auto = listados.filter((f) => f === 'reports/SHA256SUMS' || f === 'reports/SHA256SUMS.excluidos.txt');
if (auto.length > 0) {
  problemas.push(`o manifesto se lista: ${auto.join(', ')}`);
  linhas.push(`ERRO: o manifesto se lista: ${auto.join(', ')}`);
} else {
  linhas.push('o manifesto nao se lista: ok');
}

// ---- 3) todo arquivo fora do manifesto tem motivo
const naLista = new Set(listados);
const fora = andar(join(RAIZ, 'reports'))
  .map((p) => p.slice(RAIZ.length + 1).split('\\').join('/'))
  .filter((rel) => !naLista.has(rel))
  .sort();
linhas.push(`arquivos de reports/ fora do manifesto: ${fora.length}`);
const motivos = new Map(
  (existsSync(EXCLUIDOS) ? readFileSync(EXCLUIDOS, 'utf8') : '')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [f, ...m] = l.split('\t');
      return [f.trim(), m.join('\t').trim()];
    }),
);
for (const f of fora) {
  const motivo = motivos.get(f);
  if (!motivo) {
    problemas.push(`fora do manifesto sem motivo: ${f}`);
    linhas.push(`ERRO: ${f} fora do manifesto e sem motivo em reports/SHA256SUMS.excluidos.txt`);
  } else {
    linhas.push(`  excluido: ${f} — ${motivo}`);
  }
}

const relatorio = `${linhas.join('\n')}\n`;
console.log(relatorio);
console.log(problemas.length === 0
  ? 'verify-reports: OK (0 problemas)'
  : `verify-reports: ${problemas.length} PROBLEMA(S)`);
for (const p of problemas) console.log(`  - ${p}`);
process.exit(problemas.length === 0 ? 0 : 1);