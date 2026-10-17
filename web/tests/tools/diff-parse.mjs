#!/usr/bin/env node
/**
 * tests/tools/diff-parse.mjs — compara o parser contra o g++, por fixture.
 *
 * Regras (da ordem A3 v1):
 *   válido   -> nosso parser: 0 erros.
 *   inválido -> >=1 erro, <=3 se for erro isolado, linha do primeiro erro igual
 *               ou ±1 à do g++ (a diferença de coluna é registrada).
 *
 * Duas defesas que a primeira versão NÃO tinha, e que a faziam mentir:
 *
 *   S2(b) GUARDA DE INFRAESTRUTURA. O texto fedido ao parser é `stub + fixture`.
 *          Um diagnóstico na região do STUB não é divergência do parser: é o
 *          harness medindo o próprio stub. Isso vai para `infra` e FAZ O
 *              HARNESS FALHAR, em vez de virar contagem.
 *
 *   S1(a)   PROVENIÊNCIA. O JSON abre com o root absoluto, `git rev-parse HEAD`
 *          e o `git hash-object` de lexer/preprocessor/parser/ast.js DAQUELA
 *              raiz. Sem isso, v1 e v2 deram resultados quase iguais e eu
 *              escrevi que o parser não tinha mudado — e ele tinha.
 *
 * Uso: node tests/tools/diff-parse.mjs [--root <dir>] [--versao v1]
 * Saída: reports/A3/<versao>/diff-parse.json + diff-parse.log
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  rootDir, raizEfetiva, gppJson, comStub, header, importCpp, cabecalho,
} from './lib/compilers.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..');
const root = rootDir();
const VERSAO = argDe('--versao') ?? 'v1';
function argDe(nome) {
  const i = process.argv.indexOf(nome);
  return i !== -1 ? process.argv[i + 1] : null;
}

const VALID_DIR = join(RAIZ, 'tests', 'fixtures', 'parse-valid');
const INVALID_DIR = join(RAIZ, 'tests', 'fixtures', 'parse-invalid');
const LOG_DIR = join(raizEfetiva(root), 'reports', 'A3', VERSAO);
mkdirSync(LOG_DIR, { recursive: true });

/**
 * A lista de DESCARTADOS vem do `validate-fixtures.mjs` da MESMA versao.
 *
 * Sem isto o harness media os 180 ARQUIVOS ESCRITOS, e nao os 161 que o g++
 * aceitou como corpus. Nos resultados anteriores isso produziu uma
 * reconciliacao impossivel: o JSON dizia `ok: 98`, mas parte desse 98 vinha
 * de fixtures que o g++ REJEITA (descartadas) — ou seja, de um corpus
 * invalido. Um `ok` sobre um fixture que o g++ recusa nao e um `ok`.
 */
const VALIDATE = join(LOG_DIR, 'validate.log');
const descartados = new Set();
if (existsSync(VALIDATE)) {
  for (const l of readFileSync(VALIDATE, 'utf8').split('\n')) {
    if (!l.startsWith('DESCARTADO ')) continue;
    descartados.add(l.slice('DESCARTADO '.length).split(' ')[0]);
  }
}

const CABECALHO = cabecalho(root);
const { Lexer } = await importCpp(root, 'lexer.js');
const { Parser } = await importCpp(root, 'parser.js');

/** Classificações permitidas (ordem A3 v1). "Fora de escopo" SEM E03xx não vale. */
const TIPOS = new Set([
  'ok', 'rejeita-indevidamente', 'aceita-indevidamente', 'multiplos-erros',
  'posicao', 'infra',
]);

const resultados = [];
const infra = [];
let iguais = 0;
let divergentes = 0;
let pulados = 0;

function compara(arquivo, dir, esperaValido) {
  if (descartados.has(arquivo)) { pulados++; return; }
  const fonte = readFileSync(join(dir, arquivo), 'utf8');
  const h = header(fonte);
  const { texto, offsetFixture } = comStub(fonte);

  // ---- g++ (o mesmo texto: stub + fixture)
  const j = gppJson(texto);
  const primeiroGpp = j.erros[0] ?? null;
  const gppLinhaNoTexto = primeiroGpp?.loc?.line ?? null;
  // A linha que o g++ relata é a do TEXTO COMBINADO; converte para a do fixture.
  const gppLinha = gppLinhaNoTexto === null ? null : gppLinhaNoTexto - offsetFixture + 1;
  const gppCol = primeiroGpp?.loc?.column ?? null;

  // ---- nosso parser (mesmo texto)
  const lex = new Lexer(texto, arquivo).tokenize();
  const r = new Parser(lex.tokens, { file: arquivo }).parse();
  const todosErros = r.diagnostics.filter((d) => d.severity === 'error');

  // ---- S2(b): separa stub de fixture
  const naInfra = todosErros.filter((d) => (d.loc?.line ?? 0) < offsetFixture);
  const doFixture = todosErros.filter((d) => (d.loc?.line ?? 0) >= offsetFixture);

  const primeiro = doFixture[0] ?? null;
  const nossaLinha = primeiro?.loc?.line ?? null;
  const nossaCol = primeiro?.loc?.column ?? null;
  const deltaColuna = (gppCol !== null && nossaCol !== null) ? (nossaCol - gppCol) : null;

  // ---- tipo da divergência
  let tipo;
  if (esperaValido) {
    tipo = doFixture.length === 0 ? 'ok' : 'rejeita-indevidamente';
  } else if (doFixture.length === 0) {
    tipo = 'aceita-indevidamente';
  } else if (doFixture.length > 3) {
    tipo = 'multiplos-erros';
  } else if (gppLinha !== null && nossaLinha !== null && Math.abs(nossaLinha - gppLinha) > 1) {
    tipo = 'posicao';
  } else {
    tipo = 'ok';
  }

  const r0 = {
    arquivo, category: h.category, note: h.note, esperaValido,
    gpp: { ok: j.ok, linha: gppLinha, linhaNoTexto: gppLinhaNoTexto, coluna: gppCol, msg: primeiroGpp?.message ?? '' },
    nosso: { erros: doFixture.length, linha: nossaLinha, coluna: nossaCol, deltaColuna,
             msg: primeiro?.message ?? '' },
    tipo,
  };
  resultados.push(r0);
  if (tipo === 'ok') iguais++; else divergentes++;

  if (naInfra.length > 0) {
    infra.push({
      arquivo,
      diagnostics: naInfra.slice(0, 3).map((d) => `${d.loc.line}:${d.loc.column} ${d.message}`),
    });
  }
}

for (const f of readdirSync(VALID_DIR).filter((f) => f.endsWith('.cpp')).sort()) {
  compara(f, VALID_DIR, true);
}
for (const f of readdirSync(INVALID_DIR).filter((f) => f.endsWith('.cpp')).sort()) {
  compara(f, INVALID_DIR, false);
}

// ---------------------------------------------------------------- relatório

const porTipo = {};
for (const r of resultados) porTipo[r.tipo] = (porTipo[r.tipo] ?? 0) + 1;

const L = [];
L.push('=== diff-parse ===');
L.push(`versao:        ${VERSAO}`);
L.push(`root (abs):    ${CABECALHO.rootAbsoluto}`);
L.push(`git HEAD:      ${CABECALHO.gitHead}`);
for (const [m, h] of Object.entries(CABECALHO.modulos)) L.push(`  ${m.padEnd(14)} ${h}`);
L.push(`node:          ${CABECALHO.versaoNode}`);
L.push('');
L.push(`corpus: ${resultados.length} processados, ${pulados} descartados pelo validate-fixtures`);
L.push(`total (processados + descartados): ${resultados.length + pulados}`);
L.push(`ok: ${iguais}   divergentes: ${divergentes}`);
L.push('');
L.push('--- por tipo ---');
for (const [t, n] of Object.entries(porTipo).sort()) L.push(`  ${t}: ${n}`);

L.push('');
L.push('--- reconciliacao ---');
{
  const finV = resultados.filter((r) => r.esperaValido);
  const finI = resultados.filter((r) => !r.esperaValido);
  const c = (a, t) => a.filter((r) => r.tipo === t).length;
  L.push(`  válidos  (${finV.length}): ok=${c(finV, 'ok')}  rejeita-indevidamente=${c(finV, 'rejeita-indevidamente')}`);
  L.push(`  inválidos(${finI.length}): ok=${c(finI, 'ok')}  aceita-indevidamente=${c(finI, 'aceita-indevidamente')}  multiplos-erros=${c(finI, 'multiplos-erros')}  posicao=${c(finI, 'posicao')}`);
  L.push(`  descartados: ${pulados}`);
  L.push(`  soma: ${finV.length} + ${finI.length} + ${pulados} = ${finV.length + finI.length + pulados}`);
  L.push(`  ok total = ${c(finV, 'ok')} + ${c(finI, 'ok')} = ${c(finV, 'ok') + c(finI, 'ok')}`);
  if (finV.length + finI.length + pulados !== 180) {
    L.push(`  ATENCAO: a soma nao fecha em 180 (fechou em ${finV.length + finI.length + pulados})`);
  }
}

if (infra.length > 0) {
  L.push('');
  L.push('=== INFRAESTRUTURA: o parser errou o STUB, nao o fixture ===');
  L.push('O stub precisa dar 0 diagnosticos no parser medido. enquanto isso for');
  L.push('verdade, estas contagens NAO medem o parser do fixture.');
  for (const i of infra) {
    L.push(`  ${i.arquivo}`);
    for (const d of i.diagnostics) L.push(`    ${d}`);
  }
}

const divergentesLista = resultados.filter((r) => r.tipo !== 'ok');
if (divergentesLista.length > 0) {
  L.push('');
  L.push(`--- divergentes (${divergentesLista.length}) ---`);
  for (const r of divergentesLista) {
    L.push(`  ${r.arquivo} [${r.tipo}] linha=${r.nosso.linha} coluna=${r.nosso.coluna}`);
    L.push(`    g++:   ${r.gpp.msg}`);
    L.push(`    nosso: ${r.nosso.msg}`);
  }
}

const relatorio = `${L.join('\n')}\n`;
console.log(relatorio);

const saida = {
  cabecalho: CABECALHO,
  versao: VERSAO,
  totais: { processados: resultados.length, descartados: pulados, escritos: resultados.length + pulados,
            ok: iguais, divergentes },
  porTipo,
  infraestrutura: infra,
  resultados,
};
writeFileSync(join(LOG_DIR, 'diff-parse.json'), `${JSON.stringify(saida, null, 2)}\n`);
writeFileSync(join(LOG_DIR, 'diff-parse.log'), relatorio.replace(/\n+$/, '\n'));

// INFRA faz o harness FALHAR: é erro do harness, não do parser.
process.exit(infra.length > 0 ? 2 : divergentes === 0 ? 0 : 1);