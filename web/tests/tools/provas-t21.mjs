/**
 * provas-t21.mjs — as três provas literais exigidas pela ordem.
 *
 * 1. src/pixela.hpp linhas 255-262 (Vec3: operator+ / operator- / operator*)
 * 2. src/pixela.hpp linha 111 (Color{255, 255, 255})
 * 3. src/pixela.hpp linhas 439-442 (std::min({...}) / std::max({...}))
 *
 * Cada trecho é copiado do arquivo real (`sed -n A,Bp`) e parseado isolado.
 * Uso: node tests/tools/provas-t21.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Lexer } from '../../js/cpp/lexer.js';
import { Parser } from '../../js/cpp/parser.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, '../..');

/** Extrai as linhas [a, b] (1-based, inclusivo) de um arquivo. */
export function linhas(arq, a, b) {
  const txt = readFileSync(resolve(raiz, arq), 'utf8').split('\n');
  return txt.slice(a - 1, b).join('\n');
}

export const PROVAS = [
  // P1: as três linhas de operador + o cabeçalho de `cross` (que abre corpo e
  // não fecha dentro da faixa). O wrapper fecha o que a faixa deixa aberto.
  { id: 'P1', arq: 'src/pixela.hpp', a: 257, b: 262,
    rotulo: 'Vec3 operator+ / operator- / operator* (retorno por chaves)',
    abre: 'struct Vec3 {\n', fecha: '    };\n};\n' },
  // P2: linha do mem-initializer `: cellColor_(..., Color{255,255,255})`.
  // O wrapper fornece a lista de inicialização de membro que dá contexto.
  // P2: construtor `Canvas` completo — assinatura (107) mais a lista de
  // mem-inicializadores (108-111), incluindo `Color{255, 255, 255}`.
  { id: 'P2', arq: 'src/pixela.hpp', a: 107, b: 111,
    rotulo: 'Color{255, 255, 255} como argumento de construtor',
    abre: 'struct Canvas {\n', fecha: '    int cols_;\n};\n' },
  // P3: statements de corpo de função, com `std::min({...})` / `std::max({...})`.
  { id: 'P3', arq: 'src/pixela.hpp', a: 439, b: 442,
    rotulo: 'std::min({p0.sx, p1.sx, p2.sx}) — initializer-list como argumento',
    abre: 'int f(Proj &p0, Proj &p1, Proj &p2) {\n', fecha: '    return 0;\n}\n' },
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = [];
  let falhas = 0;
  for (const p of PROVAS) {
    const trecho = linhas(p.arq, p.a, p.b);
    const fonte = `${p.abre}${trecho}\n${p.fecha}`;
    const lex = new Lexer(fonte, p.arq).tokenize();
    const r = new Parser(lex.tokens, { file: p.arq }).parse();
    const ok = r.diagnostics.length === 0;
    if (!ok) falhas++;
    out.push(`### ${p.id} — ${p.rotulo}`);
    out.push('');
    out.push(`Arquivo: \`${p.arq}\` linhas ${p.a}–${p.b}`);
    out.push('');
    out.push('```cpp');
    out.push(trecho);
    out.push('```');
    out.push('');
    out.push('Envoltado para dar contexto sintático:');
    out.push('');
    out.push('```cpp');
    out.push(fonte.trimEnd());
    out.push('```');
    out.push('');
    out.push(`- nº de diagnósticos: **${r.diagnostics.length}**`);
    for (const d of r.diagnostics.slice(0, 5)) {
      out.push(`- ${d.code} @${d.loc.line}:${d.loc.column} ${d.message}`);
    }
    out.push('');
  }
  out.push(`**${PROVAS.length - falhas}/${PROVAS.length} provas com 0 diagnósticos.**`);
  console.log(out.join('\n'));
  process.exitCode = falhas === 0 ? 0 : 1;
}