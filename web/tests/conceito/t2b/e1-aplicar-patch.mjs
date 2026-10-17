/**
 * tests/conceito/t2b/e1-aplicar-patch.mjs — E1 do T2b.
 *
 * Copia `js/cpp/` para `/tmp/t2b/js/cpp` e aplica UMA correccao: `ClassDecl` e
 * `TemplateDecl` deixarem de omitting o `;` final.
 *
 * ------------------------------------------------------------- o escopo
 *
 * A ordem diz "patch SO para ClassDecl/EnumDecl/TemplateDecl emitirem ';'".
 * MEDIDO antes de aplicar: **`EnumDecl` JA emite o `;`** (ast.js:841), e as
 * tres variantes de `enum` passam todas. O patch sao, na verdade, **dois** nos
 * e nao tres. Aplicar um terceiro seria mexer no que ja esta certo.
 *
 * Nenhuma outra edicao. O patch vive na COPIA; `js/cpp/**` do repo fica em
 * `chmod a-w` e nao e tocado.
 *
 * --------------------------------------------------- o que NAO esta no patch
 *
 * Dois bugs de unparse medidos que SAO deste no mas estao FORA do escopo
 * pedido. Ficam registados, nao corrigidos:
 *
 *   - `enum class E : int { X };` -> `enum class E {X};`   o `: int` some
 *   - `union U { int x; };`        -> `int x; ;`           o `union` desaparece
 *
 * Corrigi-los seria alargar o patch para alem do que a ordem autoriza, e a
 * mudanca no numero de quebras deixaria de ser atribuivel a UMA correccao.
 */
import { cpSync, chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const RAIZ = new URL('../../../', import.meta.url).pathname;
const DESTINO = join(tmpdir(), 't2b', 'js', 'cpp');

/** Destrava uma arvore entrada a entrada (o `chmod -R a-w` do repo propaga-se). */
function destrava(p) {
  try { chmodSync(p, 0o755); } catch { /* ja desbloqueado */ }
  let itens = [];
  try { itens = readdirSync(p, { withFileTypes: true }); } catch { return; }
  for (const d of itens) {
    const q = join(p, d.name);
    if (d.isDirectory()) destrava(q);
    else { try { chmodSync(q, 0o644); } catch { /* bloqueado */ } }
  }
}

/** Copia `js/cpp` para `/tmp/t2b/js/cpp` e devolve o caminho. */
export function copiaCpp(forcar = false) {
  if (forcar) rmSync(join(tmpdir(), 't2b'), { recursive: true, force: true });
  mkdirSync(DESTINO, { recursive: true });
  for (const f of readdirSync(join(RAIZ, 'js', 'cpp'), { withFileTypes: true })) {
    // `js/cpp/` tem sub-directorios (`ast/`, `worker/`). `cpSync` de um
    // directorio precisa de `recursive`, e sem isso levanta EISDIR.
    cpSync(join(RAIZ, 'js', 'cpp', f.name), join(DESTINO, f.name), { recursive: true });
  }
  destrava(join(tmpdir(), 't2b'));
  return DESTINO;
}

/**
 * A correccao. Cada substituicao e por texto EXACTO, e falha alto se o
 * original nao bater — um patch que casa com o texto errado e silenciosamente
 * inutil.
 */
const SUBS = [
  {
    no: 'ClassDecl',
    de: "      return `${spec ? `${spec} ` : ''}${d.name ?? ''}${bases} {${d.members.map(memberTexto).join('')}}`;",
    para: "      return `${spec ? `${spec} ` : ''}${d.name ?? ''}${bases} {${d.members.map(memberTexto).join('')}};`;",
  },
  {
    no: 'TemplateDecl',
    de: "      return `template<${d.params.map((p) => `typename ${declaradorTexto(p)}`).join(', ')}> ${declTexto(d.decl)}`;",
    para: "      return `template<${d.params.map((p) => `typename ${declaradorTexto(p)}`).join(', ')}> ${declTexto(d.decl)};`;",
  },
];

/** Aplica o patch e devolve `{destino, mudancas, aplicado}`. */
export function aplicaPatch(destino = DESTINO) {
  const caminho = join(destino, 'ast.js');
  let txt = readFileSync(caminho, 'utf8');
  const original = txt;
  const mudancas = [];
  for (const s of SUBS) {
    if (!txt.includes(s.de)) {
      throw new Error(`PATCH NAO APLICOU (${s.no}): o texto original nao foi encontrado em ${caminho}.\n`
        + `Procurado: ${s.de}\nIsto normalmente significa que ast.js mudou desde o T2b foi escrito.`);
    }
    if (txt.includes(s.para)) { mudancas.push({ no: s.no, aplicada: false, nota: 'ja estava aplicado' }); continue; }
    txt = txt.replace(s.de, s.para);
    mudancas.push({ no: s.no, aplicada: true });
  }
  if (txt !== original) writeFileSync(caminho, txt);
  return { destino, mudancas, aplicado: txt !== original };
}

/** O diff unificado, para `reports/conceito/t2b-patch.diff`. */
export function diffDoPatch() {
  const a = readFileSync(join(RAIZ, 'js', 'cpp', 'ast.js'), 'utf8').split('\n');
  const b = readFileSync(join(DESTINO, 'ast.js'), 'utf8').split('\n');
  const out = [
    '--- a/js/cpp/ast.js',
    '+++ b/js/cpp/ast.js',
    '@@ T2b: ClassDecl e TemplateDecl passam a emitir o `;` final @@',
  ];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    out.push(`-  ${a[i] ?? ''}`);
    out.push(`+  ${b[i] ?? ''}`);
  }
  return out.join('\n') + '\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== T2b E1 — copia e patch ===');
  console.log(`origem: ${RAIZ}js/cpp`);
  const dest = copiaCpp(true);
  console.log(`copia : ${dest}`);
  console.log('');
  const r = aplicaPatch(dest);
  for (const m of r.mudancas) {
    console.log(`  ${m.aplicada ? 'APLICADO' : (m.nota ?? 'ignorado')}  ${m.no}`);
  }
  console.log('');
  const d = diffDoPatch();
  writeFileSync(`${RAIZ}reports/conceito/t2b-patch.diff`, d);
  console.log('diff gravado: reports/conceito/t2b-patch.diff');
  console.log('');
  console.log(d.trimEnd());
}
