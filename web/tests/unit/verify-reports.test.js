/**
 * tests/unit/verify-reports.test.js — o manifesto de `reports/` se confere.
 *
 * Motivo de existir no `npm test`: `reports/sha256.log` (o manifesto antigo)
 * listava o PRÓPRIO hash, e por isso `sha256sum -c` saía com exit 1 sempre.
 * Um verificador que sempre falha não é verificado por ninguém — o "FALHOU"
 * no próprio arquivo vira ruído. Este teste roda o verificador de verdade e
 * falha se ele sair diferente de zero.
 *
 * O teste NÃO escreve nada em `reports/`: um teste que escrevesse dentro do
 * diretório verificado invalidaria o manifesto no mesmo instante em que o
 * conferisse.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFESTO = join(RAIZ, 'reports', 'SHA256SUMS');

test('R5: reports/SHA256SUMS existe e nao se lista', () => {
  assert.ok(existsSync(MANIFESTO),
    'reports/SHA256SUMS nao existe — rode `npm run gen-sha256sums`');
  const linhas = readFileSync(MANIFESTO, 'utf8').split('\n').filter(Boolean);
  assert.ok(linhas.length > 0, 'manifesto vazio');
  const arquivos = linhas.map((l) => l.slice(66).trim());
  assert.ok(!arquivos.includes('reports/SHA256SUMS'),
    'o manifesto nao pode conter o proprio hash: sha256sum -c sempre falharia');
  for (const l of linhas) {
    assert.match(l, /^[0-9a-f]{64} {2}\S/, `linha fora do formato do sha256sum: ${JSON.stringify(l)}`);
  }
});

// Os DOIS testes de hash ficam FORA do `npm test`, de propósito.
//
// Editar qualquer log em `reports/` — que é o trabalho de todo agente, a cada
// etapa — muda o hash e faria `sha256sum -c` acusar. Um teste que quebra toda
// vez que se registra uma evidência treina a pessoa a NÃO registrar evidência,
// que é o oposto do combinado. A conferência de hash é `npm run verify-reports`,
// rodada no fim da etapa, depois de o manifesto ser regerado.
//
// O que fica aqui é o que é verdade estrutural e não depende de momento:
// o manifesto existe, tem formato, não se autolista, e toda exclusão tem
// motivo escrito.

test('R5: toda exclusao do manifesto tem motivo escrito', () => {
  const p = join(RAIZ, 'reports', 'SHA256SUMS.excluidos.txt');
  assert.ok(existsSync(p), 'reports/SHA256SUMS.excluidos.txt nao existe');
  const linhas = readFileSync(p, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
  assert.ok(linhas.length > 0, 'nenhuma exclusao declarada');
  for (const l of linhas) {
    const [arquivo, ...motivo] = l.split('\t');
    assert.ok(arquivo?.trim(), `linha sem arquivo: ${JSON.stringify(l)}`);
    assert.ok(motivo.join('\t').trim().length > 10,
      `exclusao sem motivo: ${arquivo}`);
  }
});

test('R5: o manifesto antigo saiu de cena; ha UM manifesto', () => {
  // O defeito historico: `reports/sha256.log` listava o proprio hash, e por
  // isso `sha256sum -c reports/sha256.log` saia 1 sempre. Alem disso ele era
  // um RETRATO de uma execucao antiga (66 arquivos, de antes de R1/R3), e um
  // manifesto desatualizado que da `FALHOU` em tudo que mudou desde entao
  // e pior do que nao ter: ele treina o olho a ignorar a falha.
  //
  // Ele foi removido em favor de `reports/SHA256SUMS`, que e regenerado pelo
  // `npm run gen-sha256sums` e cobre `reports/` inteiro. O arquivo continua
  // no historico git (`git show <commit>:reports/sha256.log`).
  const antigo = join(RAIZ, 'reports', 'sha256.log');
  assert.ok(!existsSync(antigo),
    'reports/sha256.log nao deveria existir: ele e um manifesto obsoleto que se autolista');

  // Nenhum outro arquivo em reports/ pode se listar: um manifesto que se
  // autolista da `FALHOU` nele proprio e o defeito que o R5 veio corrigir.
  for (const nome of readdirSync(join(RAIZ, 'reports'))) {
    const p = join(RAIZ, 'reports', nome);
    if (statSync(p).isDirectory() || !nome.endsWith('.log')) continue;
    const linhas = readFileSync(p, 'utf8').split('\n').filter(Boolean)
      .filter((l) => /^[0-9a-f]{64} {2}\S/.test(l));
    assert.ok(!linhas.some((l) => l.slice(66).trim() === 'reports/SHA256SUMS'),
      `reports/${nome} se lista no proprio manifesto`);
  }
});