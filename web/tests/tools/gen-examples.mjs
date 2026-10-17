#!/usr/bin/env node
/**
 * gen-examples.mjs — extrai os exemplos de js/examples.js para
 * tests/fixtures/examples/*.cpp, para que o compilador os processe.
 *
 * Uso: node tests/tools/gen-examples.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORIGEM = join(RAIZ, 'js', 'examples.js');
const DESTINO = join(RAIZ, 'tests', 'fixtures', 'examples');

const fonte = readFileSync(ORIGEM, 'utf8');

// Cada exemplo é `  nome: \`...código...\`,` no objeto EXAMPLES.
const re = /^\s{2}([A-Za-z_][\w]*):\s*`([\s\S]*?)`\s*,?\s*$/gm;

const encontrados = [];
let m;
while ((m = re.exec(fonte)) !== null) {
  encontrados.push({ nome: m[1], codigo: m[2] });
}

if (encontrados.length === 0) {
  console.error('[gen-examples] nenhum exemplo encontrado em js/examples.js');
  process.exit(1);
}

if (existsSync(DESTINO)) {
  for (const f of readdirSync(DESTINO)) rmSync(join(DESTINO, f));
} else {
  mkdirSync(DESTINO, { recursive: true });
}

for (const { nome, codigo } of encontrados) {
  writeFileSync(join(DESTINO, `${nome}.cpp`), codigo.endsWith('\n') ? codigo : codigo + '\n');
}

console.log(`[gen-examples] ${encontrados.length} exemplos extraídos: ` +
  encontrados.map((e) => e.nome).join(', '));
console.log(`[gen-examples] destino: tests/fixtures/examples/`);