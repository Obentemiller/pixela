/**
 * tests/tools/gen-sha256sums.mjs — gera `reports/SHA256SUMS`.
 *
 * Por que existe: `reports/sha256.log` (o manifesto antigo) listava o PRÓPRIO
 * hash. Isso faz `sha256sum -c reports/sha256.log` sair com exit 1 sempre, e
 * um verificador que sempre falha não verifica nada: o resultado "FALHOU" no
 * próprio manifesto vira ruído e o olho para de ler.
 *
 * Regras do manifesto:
 *
 *   1. `reports/SHA256SUMS` NÃO entra nele. Um arquivo não pode conter o
 *      hash de si mesmo — o hash muda quando o hash é escrito dentro dele.
 *   2. Todo o resto de `reports/` entra, recursivamente, ordenado por caminho
 *      para que o arquivo seja reprodutível byte a byte.
 *   3. Cada exclusão fica escrita em `reports/SHA256SUMS.excluidos.txt`, com o
 *      motivo. Excluir em silêncio é a forma de esconder uma lacuna.
 *
 * Uso:
 *   node tests/tools/gen-sha256sums.mjs     # gera o manifesto
 *   npm run verify-reports                  # confere o manifesto (exit 0)
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
export const RAIZ = join(AQUI, '..', '..');
const RELATORIOS = join(RAIZ, 'reports');
export const MANIFESTO = join(RELATORIOS, 'SHA256SUMS');
export const EXCLUIDOS = join(RELATORIOS, 'SHA256SUMS.excluidos.txt');

/**
 * Arquivos que NÃO entram no manifesto, com o motivo. Cada linha é
 * `caminho<TAB>motivo` — o motivo é lido por quem tentar conferir.
 *
 * O único item é o próprio manifesto. Não há "logs voláteis" aqui: nenhum log
 * é reescrito por `verify-reports`, que é um verificador PURO (não roda
 * nenhuma das ferramentas). Os logs que contêm `duration_ms` e data/hour
 * (`reports/A0/test-browser.log` e afins) são o registro de uma execução já
 * concluída e versionada; só mudariam se alguém reexecutasse aquela etapa, e
 * nesse caso o manifesto tem de acusar a mudança — é para isso que ele existe.
 */
export const EXCLUSOES = new Map([
  ['reports/SHA256SUMS', 'o próprio manifesto: um arquivo não contém o hash de si mesmo'],
  ['reports/SHA256SUMS.excluidos.txt', 'descreve as exclusões do manifesto; mudou, o manifesto precisa ser regerado'],
  ['reports/verify-reports.log', 'ESCRITO DEPOIS do manifesto: é a evidência de que ele confere, e incluí-la exigiria uma segunda passada. Mesma classe do próprio manifesto'],
  ['reports/A1/r5-verify-reports.log', 'ESCRITO DEPOIS do manifesto: é a evidência de que ele confere (mesma classe do próprio manifesto)'],
]);

/** Todos os arquivos sob `dir`, recursivamente, em ordem de caminho. */
export function andar(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const nome of readdirSync(dir).sort()) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) andar(p, acc);
    else acc.push(p);
  }
  return acc;
}

/** Hash de um arquivo, sem ler tudo na memória de uma vez. */
export function hashArquivo(caminho) {
  const fd = openSync(caminho, 'r');
  try {
    const h = createHash('sha256');
    const buf = Buffer.alloc(1 << 16);
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      h.update(buf.subarray(0, n));
    }
    return h.digest('hex');
  } finally {
    closeSync(fd);
  }
}

/** Linhas do manifesto para o estado atual de `reports/`. */
export function linhasDoManifesto() {
  const todos = andar(RELATORIOS)
    .map((p) => relative(RAIZ, p).split('\\').join('/'))
    .filter((rel) => !EXCLUSOES.has(rel))
    .sort();
  return todos.map((rel) => `${hashArquivo(join(RAIZ, rel))}  ${rel}`);
}

function main() {
  const linhas = linhasDoManifesto();
  writeFileSync(MANIFESTO, `${linhas.join('\n')}\n`);

  const linhasExcl = [
    '# Arquivos de reports/ que NAO entram em reports/SHA256SUMS.',
    '# Motivo em coluna 2, alinhado por TAB. Gerado por tests/tools/gen-sha256sums.mjs.',
    '',
    ...[...EXCLUSOES].map(([f, m]) => `${f}\t${m}`),
    '',
  ];
  writeFileSync(EXCLUIDOS, linhasExcl.join('\n'));

  console.log(`[gen-sha256sums] ${linhas.length} arquivos em reports/SHA256SUMS`);
  console.log(`[gen-sha256sums] ${EXCLUSOES.size} exclusões em reports/SHA256SUMS.excluidos.txt`);

  // A ordem importa: um log criado DEPOIS desta execução não entra no
  // manifesto, e o `verify-reports` vai acusar. Avisar aqui é mais barato que
  // descobrir na conferência.
  const faltando = andar(RELATORIOS)
    .map((p) => relative(RAIZ, p).split('\\').join('/'))
    .filter((rel) => !EXCLUSOES.has(rel))
    .filter((rel) => !linhas.some((l) => l.endsWith(`  ${rel}`)));
  if (faltando.length > 0) {
    console.log(`[gen-sha256sums] ATENCAO: ${faltando.length} arquivo(s) criados durante esta execucao, `);
    console.log('[gen-sha256sums] fora do manifesto. Rode de novo depois de terminar os comandos.');
    for (const f of faltando) console.log(`  ${f}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('gen-sha256sums.mjs')) main();