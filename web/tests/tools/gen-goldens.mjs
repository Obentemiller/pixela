#!/usr/bin/env node
/**
 * gen-goldens.mjs — gera os goldens do AST.
 *
 * Cada golden é um par `.cpp` / `.json` em `tests/golden/ast/`.
 *
 * O `.json` é a AST **sem** `loc` e sem `locEnd`: posições mudam quando o
 * arquivo é reformatado, e um golden que quebra por causa de coluna não
 * informa nada sobre o parser. O que o golden fixa é a FORMA da árvore.
 *
 * A verdade é o próprio parser — mas isso não torna o golden inútil: ele
 * congela a decisão, e qualquer mudança deliberada de formato aparece como
 * diff explícito no `git diff`, que é o ponto.
 *
 * Uso: node tests/tools/gen-goldens.mjs [--check]
 *   --check não escreve: compara e sai com 1 se algo divergir.
 */
import { readdirSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lexer } from '../../js/cpp/lexer.js';
import { Parser } from '../../js/cpp/parser.js';
import { unparse } from '../../js/cpp/ast.js';
import { CASOS } from './golden-casos.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SAIDA = join(RAIZ, 'tests', 'golden', 'ast');
const CHECK = process.argv.includes('--check');

// ------------------------------------------------------------------ fontes

/**
 * Cada caso exercita uma construção específica. Manter um por construção
 * faz o diff do golden dizer QUAL construção mudou, em vez de "alguma
 * coisa no arquivo 47".
 */


// ------------------------------------------------------------------ geracao

/** Remove loc/locEnd para o golden: posição não é forma. */
function semLoc(no) {
  if (no === null || typeof no !== 'object') return no;
  if (Array.isArray(no)) return no.map(semLoc);
  const out = {};
  for (const k of Object.keys(no)) {
    if (k === 'loc' || k === 'locEnd') continue;
    out[k] = semLoc(no[k]);
  }
  return out;
}

mkdirSync(SAIDA, { recursive: true });
const nomes = Object.keys(CASOS).sort();
let divergentes = 0;
let comErro = 0;

const linhas = [];
linhas.push(`=== gen-goldens: ${nomes.length} casos, modo ${CHECK ? 'check' : 'escrita'} ===`);

for (const nome of nomes) {
  const src = CASOS[nome];
  const lex = new Lexer(src, `${nome}.cpp`).tokenize();
  const r = new Parser(lex.tokens, { file: `${nome}.cpp` }).parse();

  if (lex.diagnostics.length > 0 || r.diagnostics.length > 0) {
    comErro++;
    linhas.push(`DIAG     ${nome}: ${[...lex.diagnostics, ...r.diagnostics]
      .map((d) => `${d.code} ${d.message}`).join('; ')}`);
    continue;
  }

  const ast = semLoc(r.ast);
  const json = JSON.stringify(ast, null, 2);
  const texto = unparse(r.ast);
  const base = join(SAIDA, nome);

  if (CHECK) {
    const cpp = `${readFileSync(`${base}.cpp`, 'utf8')}`;
    const js = readFileSync(`${base}.json`, 'utf8');
    if (cpp !== `${src}\n`) {
      divergentes++;
      linhas.push(`DIFERE   ${nome}.cpp: o fonte mudou`);
    }
    if (js !== `${json}\n`) {
      divergentes++;
      linhas.push(`DIFERE   ${nome}.json: a AST mudou`);
    }
    continue;
  }

  writeFileSync(`${base}.cpp`, `${src}\n`);
  writeFileSync(`${base}.json`, `${json}\n`);
  writeFileSync(`${base}.txt`, `${texto}\n`);
  linhas.push(`escrito  ${nome}.json (${json.length} bytes, unparse ${texto.length})`);
}

linhas.push('');
linhas.push(`goldens: ${nomes.length}   com diagnóstico: ${comErro}   divergentes: ${divergentes}`);
const relatorio = linhas.join('\n');
console.log(relatorio);
writeFileSync(join(RAIZ, 'reports', 'gen-goldens.log'), `${relatorio}\n`);

process.exit(divergentes === 0 && comErro === 0 ? 0 : 1);