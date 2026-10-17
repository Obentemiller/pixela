/**
 * tests/conceito/t2/e4-causas.mjs — quantas CAUSAS ha, e quao pequenas sao?
 *
 * As 8 mensagens de quebra sao Sintoma. A pergunta que interessa e quantas
 * CAUSAS distintas existem por tras, e qual o menor fonte que reproduz cada
 * uma. Um conserto de 3 linhas que arruma 1413 casos vale muito mais que
 * 1413 consertos de uma linha.
 *
 * O criterio de agrupamento e a FORMA DA SAIDA do unparse, nao a mensagem do
 * g++: `expected X after struct definition` aparece em 1413 casos, mas a
 * pergunta util e "o `;` falta sempre depois do `}`?".
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { unparse } from '../../../js/cpp/ast.js';
import { desparse, gppTexto, limpaTmp } from './runner.mjs';

/** Classifica a SAIDA do unparse por forma, para achar a causa. */
export function formaDaSaida(texto) {
  const t = (texto ?? '').trimEnd();
  if (!t) return 'vazio';
  // `}` seguido de letra/nome sem `;` = declaracao de classe sem ponto e virgula
  if (/\}\s*(?=[A-Za-z_])/.test(t) && !/\};/.test(t)) return 'classe-sem-ponto-e-virgula';
  if (/^auto\s+typeid\s*\(/m.test(t)) return 'tipo-de-retorno-como-typeid';
  if (/\(\s*\*\s*\w+\s*\)\s*\(/.test(t)) return 'declarador-de-funcao-sem-parenteses';
  if (/=\s*\w+\s*\{\s*[^;]*\}\s*;/.test(t)) return 'braced-init-como-typedef';
  if (/=\s*new\s+\w+\s*\(\s*\{/.test(t)) return 'new-com-brace-virado-parenteses';
  if (/typename\s+\w+\.\.\./.test(t)) return 'pack-com-typename';
  if (!t.endsWith(';') && /^(template|struct|class|enum)\b/.test(t)) return 'declaracao-sem-ponto-e-virgula';
  return 'outro';
}

/** O menor fonte que reproduz a quebra, para uma forma de saida. */
const CANDIDATOS = [
  'struct S { int x; };\n',
  'class C { int m(); };\n',
  'enum E { A };\n',
  'template<class T> struct S { T x; };\n',
  'template<class T = int> struct S { T x; };\n',
  'template<int N = 3> struct S { int a[N]; };\n',
  'auto f(int x) -> int { return x; }\n',
  'int (*fp)(int, int);\n',
  'int (*fp)(int, int) = 0;\n',
  'struct S { int a; } g(int x) -> int;\n',
  'struct S { int a; int b; } S s = {1, 2};\n',
  'struct S { int a; int b; } S s = new S({1, 2});\n',
  'struct C { int r; int g; int b; } C c = C {1, 2, 3};\n',
  'struct C { int r; int g; int b; } C f() { return {1, 2, 3}; }\n',
  'template<class... Args> struct S { int n; } S s = {1};\n',
  'int g = 1;\n',
  'int g = 1; struct S { int x; };\n',
  'int g = new int[3]{1, 2, 3};\n',
  'int g = new int(3);\n',
  'void f() { int g = new int[3]{1, 2, 3}; }\n',
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const RAIZ = new URL('../../../', import.meta.url).pathname;
  const j = JSON.parse(readFileSync(`${RAIZ}reports/conceito/t2-e3-quadrantes.json`, 'utf8'));
  const comBug = j.comBug;

  // ---- quantas formas de saida existem no corpus inteiro
  const formas = new Map();
  for (const c of comBug) {
    const f = formaDaSaida(c.texto);
    if (!formas.has(f)) formas.set(f, { forma: f, n: 0, exemplo: c.nome, exemploTexto: c.texto });
    formas.get(f).n++;
  }
  console.log('=== T2 E4 — causas raiz ===');
  console.log(`${comBug.length} casos com bug, agrupados pela FORMA DA SAÍDA do unparse:`);
  console.log('');
  for (const [f, v] of [...formas].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${String(v.n).padStart(5)}  ${f}`);
  }

  // ---- o menor fonte que reproduz CADA forma
  console.log('');
  console.log('menor reproduzível por causa:');
  const causas = [];
  for (const f of [...formas.keys()].sort()) {
    let achado = null;
    for (const cand of CANDIDATOS) {
      const orig = await gppTexto(cand, `e4o-${f}`);
      if (!orig.ok) continue;              // o original tem de ser valido
      const d = desparse(cand);
      if (!d.ast) continue;
      const u = unparse(d.ast);
      if (formaDaSaida(u) !== f) continue;
      const saida = await gppTexto(u, `e4s-${f}`);
      if (saida.ok === false) { achado = { cand, out: u, msg: saida.msg }; break; }
    }
    if (achado) {
      causas.push({ forma: f, n: formas.get(f).n, fonte: achado.cand, saida: achado.out, gpp: achado.msg });
      console.log(`  ${String(formas.get(f).n).padStart(5)} casos  ${f}`);
      console.log(`      fonte: ${achado.cand.trim()}`);
      console.log(`      saida: ${achado.out.trim()}`);
    } else {
      causas.push({ forma: f, n: formas.get(f).n, fonte: null, nota: 'sem reproduzidor entre os candidatos' });
      console.log(`  ${String(formas.get(f).n).padStart(5)} casos  ${f}  -- sem reproduzidor entre os candidatos`);
    }
  }

  // ---- as 2 perdas de tokens e as 2 nao-idempotencias
  console.log('');
  console.log('perdas de tokens e quebras de idempotência (as silenciosas):');
  for (const c of comBug.filter((x) => /tokens|idempot/.test(x.q))) {
    console.log(`  [${c.q}] ${c.nome}`);
    console.log(`      tokens ${c.tokensOrig} -> ${c.tokensSai}`);
    console.log(`      saida: ${String(c.texto).replace(/\n/g, ' ').slice(0, 78)}`);
  }

  writeFileSync(`${RAIZ}reports/conceito/t2-e4-causas.json`,
    `${JSON.stringify({ comBug: comBug.length, formas: [...formas.values()], causas }, null, 1)}\n`);
  writeFileSync('/tmp/opencode/t2-e4-causas.json',
    readFileSync(`${RAIZ}reports/conceito/t2-e4-causas.json`, 'utf8'));
  console.log('');
  console.log('gravado: reports/conceito/t2-e4-causas.json');
  limpaTmp();
}
