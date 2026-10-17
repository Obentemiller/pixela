/**
 * tests/tools/dump-default-headers.mjs — extrai `DEFAULT_HEADERS` de
 * `js/cpp/preprocessor.js` e parseia CADA header virtual SOZINHO com o
 * parser do root.
 *
 * Motivo (S7g): `parse-project.mjs` dá 0 diagnósticos nos 12 arquivos do
 * projeto, e o prelúdio declarado contém construções que o parser REJEITA
 * (`extern T x;`, `template<class T, class A = int>`). Como é que os dois
 * convivem? Esta ferramenta mede, em vez de supor.
 *
 * Uso: node tests/tools/dump-default-headers.mjs [--root <dir>]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rootDir, importCpp, raizEfetiva } from './lib/compilers.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..');
const root = rootDir();

/**
 * Extrai `DEFAULT_HEADERS` do fonte, sem `eval`.
 *
 * Casa a chave e o literal de cada entrada. O valor é sempre uma string
 * simples (aspas simples ou crase), e a entrada termina numa vírgula no
 * início da linha seguinte — inclusive quando o valor tem várias linhas.
 */
export function extrairDefaultHeaders(fonte) {
  const chave = fonte.indexOf('const DEFAULT_HEADERS = {');
  if (chave === -1) return null;
  const corpo = fonte.slice(chave);
  const out = {};
  // valor com crase: `...`,  com aspas: '...' (pode ter \n e \' escapados)
  const re = /^ {2}'([^']+)': (?:(`[\s\S]*?`)|('(?:\\.|[^'\\])*'))\s*,?\s*$/gm;
  let m;
  while ((m = re.exec(corpo)) !== null) {
    if (m[2] !== undefined) {
      out[m[1]] = m[2].slice(1, -1);
    } else {
      out[m[1]] = m[3].slice(1, -1).replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    }
  }
  return out;
}

const PREP = join(raizEfetiva(root), 'js', 'cpp', 'preprocessor.js');
const headers = extrairDefaultHeaders(readFileSync(PREP, 'utf8'));
if (!headers) {
  console.error(`nao achei DEFAULT_HEADERS em ${PREP}`);
  process.exit(2);
}

const { Lexer } = await importCpp(root, 'lexer.js');
const { Parser } = await importCpp(root, 'parser.js');

const comConteudo = Object.entries(headers).filter(([, t]) => t && t.trim());
const L = [];
L.push('=== DEFAULT_HEADERS parseado SOZINHO com o parser do root ===');
L.push(`root: ${raizEfetiva(root)}`);
L.push(`headers no total: ${Object.keys(headers).length}`);
L.push(`headers com conteudo: ${comConteudo.length}`);
L.push('');

let rejeitados = 0;
const porHeader = {};
for (const [nome, texto] of comConteudo) {
  const l = new Lexer(texto, `virt:${nome}`).tokenize();
  const r = new Parser(l.tokens, { file: `virt:${nome}` }).parse();
  const erros = r.diagnostics.filter((d) => d.severity === 'error');
  if (erros.length) {
    rejeitados++;
    porHeader[nome] = erros.map((d) => `${d.code} ${d.loc.line}:${d.loc.column} ${d.message}`);
  }
}

L.push(`headers REJEITADOS pelo parser: ${rejeitados} de ${comConteudo.length}`);
L.push('');
for (const [nome, erros] of Object.entries(porHeader)) {
  L.push(`### ${nome}`);
  for (const e of erros) L.push(`    ${e}`);
  L.push('');
}

const relatorio = L.join('\n');
console.log(relatorio);
const LOG = join(RAIZ, 'reports', 'A3');
mkdirSync(LOG, { recursive: true });
writeFileSync(join(LOG, 's7g-default-headers-sozinho.log'), relatorio);
process.exit(0);