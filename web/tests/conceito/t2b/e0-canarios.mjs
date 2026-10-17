/**
 * tests/conceito/t2b/e0-canarios.mjs — correr os canarios no estado INICIAL.
 *
 * E0 da ordem T2b. Regra 5: commit a cada etapa, por isso este script existe
 * sozinho e produz o log que fica no repositorio.
 */
import { writeFileSync } from 'node:fs';
import { unparse } from '../../../js/cpp/ast.js';
import { exigeCanarios } from './canarios.mjs';
import { limpaTmp } from '../t2/runner.mjs';

const RAIZ = new URL('../../../', import.meta.url).pathname;

console.log('=== T2b E0 — canarios, no estado INICIAL (HEAD, sem patch) ===');
const ok = await exigeCanarios(unparse, 'inicial');
console.log('');
if (!ok) {
  console.error('ABORTADO: os canarios ja divergem ANTES do patch.');
  console.error('Um patch nao pode ser julgado contra um baseline que ja esta vermelho.');
  process.exit(1);
}
console.log('baseline dos canarios: VERDE. O patch pode ser aplicado.');
limpaTmp();
