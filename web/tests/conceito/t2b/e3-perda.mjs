/**
 * tests/conceito/t2b/e3-perda.mjs — E3 do T2b (reescrito).
 *
 * Detector de perda de tokens em TODOS os casos que o nosso parser aceita,
 * independente do veredito do g++ no unparse.
 *
 * Para cada caso com parse limpo:
 *   1. lexar o fonte ORIGINAL -> multiconjunto de tokens (valor -> contagem)
 *   2. unparse do AST -> lexar o resultado -> multiconjunto de tokens
 *   3. comparar multiconjuntos
 *
 * Regras de classificacao:
 *   - `class` perdido com `typename` ganho = normalizacao legítima
 *     (template<typename T> e template<class T> sao equivalentes).
 *   - Qualquer outra diferenca e perda REAL.
 *   - Categorias: ponto-e-virgula (ClassDecl), seta (trailing return),
 *     conteudo (chaves/colchetes que somam), outro.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Lexer } from '../../../js/cpp/lexer.js';
import { Parser } from '../../../js/cpp/parser.js';
import { Preprocessor } from '../../../js/cpp/preprocessor.js';
import { unparse } from '../../../js/cpp/ast.js';
import { limpaTmp } from '../t2/runner.mjs';
import { gerarGramatica } from '../t1/corpus-gramatica.mjs';

const RAIZ = '/home/vtbentemiller/Documentos/pixela-main/web';
const SEMENTE = 20261016;

function fixtures() {
  const dir = `${RAIZ}/tests/fixtures/parse-valid`;
  return readdirSync(dir).filter(f => f.endsWith('.cpp')).sort().map(f => ({
    nome: `fix__${f.replace(/\.cpp$/, '')}`, pop: 'fixture',
    fonte: readFileSync(`${dir}/${f}`, 'utf8'),
  }));
}
function projeto() {
  const dir = `${RAIZ}/src`; const alvos = ['examples/mesh3d.cpp','examples/particles.cpp','shaders/volumetric.cpp'];
  const achei = [];
  for (const rel of alvos) try { achei.push({ nome: `proj__${rel.replace(/[/.]/g,'_')}`, pop: 'projeto', fonte: readFileSync(`${dir}/${rel}`, 'utf8') }); } catch {}
  return achei;
}

const fix = fixtures(); const pro = projeto(); const gra = gerarGramatica(3000, SEMENTE).map(c => ({ nome: c.nome, pop: 'gramatica', fonte: c.fonte }));
const casos = [...fix, ...pro, ...gra];

function multiconjunto(src) {
  const m = new Map();
  for (const t of new Lexer(src, 'x.cpp').tokenize().tokens) {
    if (t.type === 'eof' || t.value === '' || t.type === 'comment') continue;
    const v = String(t.value);
    m.set(v, (m.get(v) || 0) + 1);
  }
  return m;
}

function diferencas(orig, sai) {
  const perdas = [], ganhos = [];
  const m2 = new Map(sai);
  for (const [v, c] of orig) { const s = m2.get(v) || 0; if (c > s) perdas.push({ token: v, perde: c - s }); }
  for (const [v, c] of sai) { if (!orig.has(v)) ganhos.push({ token: v, ganha: c }); }
  return { perdas, ganhos };
}

/** Remove normalizacao legitimada: class <-> typename em parametros de template. */
function normaliza(perdas, ganhos) {
  let skipClass = Math.min(perdas.filter(p => p.token === 'class').length,
                         ganhos.filter(g => g.token === 'typename').length);
  const perdas2 = [];
  for (const p of perdas) {
    if (p.token === 'class' && skipClass > 0) { skipClass--; continue; }
    perdas2.push(p);
  }
  let skipTypename = Math.min(perdas.filter(p => p.token === 'class').length,
                              ganhos.filter(g => g.token === 'typename').length);
  const ganhos2 = [];
  for (const g of ganhos) {
    if (g.token === 'typename' && skipTypename > 0) { skipTypename--; continue; }
    ganhos2.push(g);
  }
  return { perdas: perdas2, ganhos: ganhos2 };
}

function categoriaDe(perda) {
  const t = perda.token;
  if (t === ';') return 'ponto-e-virgula';
  if (t === '->') return 'seta-trailing-return';
  if (t === '{' || t === '}' || t === '[' || t === ']') return 'chaves-conteudo';
  return `outro:${t}`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const aceitos = [];
  const comPerda = [];
  const categorias = new Map();

  for (const c of casos) {
    try {
      const pp = new Preprocessor({}).process(c.fonte, c.nome);
      const lex = new Lexer(pp.text, c.nome).tokenize();
      const r = new Parser(lex.tokens, { file: c.nome }).parse();
      const erros = [...(lex.diagnostics ?? []), ...(r.diagnostics ?? [])].filter(x => x.severity === 'error');
      if (erros.length > 0) continue;
      const u = unparse(r.ast);
      const diff = diferencas(multiconjunto(c.fonte), multiconjunto(u));
      const { perdas, ganhos } = normaliza(diff.perdas, diff.ganhos);
      if (perdas.length > 0 || ganhos.length > 0) {
        const cats = [...new Set([...perdas.map(categoriaDe), ...ganhos.map(g => `ganho:${g.token}`)])];
        for (const cat of cats) categorias.set(cat, (categorias.get(cat) || 0) + 1);
        comPerda.push({ nome: c.nome, pop: c.pop, categorias: cats, perdas, ganhos,
          tokensOrig: multiconjunto(c.fonte).size, tokensSai: multiconjunto(u).size,
          reprodutor: c.fonte.split('\n').filter(l => !l.startsWith('//!')).join(' ').trim().slice(0, 90) });
      }
      aceitos.push(c);
    } catch { /* excecao do parser: nao conta como "aceita" */ }
  }

  const reprodutores = {};
  for (const cat of categorias.keys()) {
    const cands = comPerda.filter(c => c.categorias.includes(cat)).sort((a, b) => a.tokensOrig - b.tokensOrig);
    if (cands.length) reprodutores[cat] = cands[0];
  }

  const saida = {
    aceitosTotal: aceitos.length,
    comPerdaTotal: comPerda.length,
    taxaPerda: comPerda.length / aceitos.length,
    categorias: Object.fromEntries([...categorias].map(([k, v]) => [k, v])),
    reprodutores,
    exemplos: comPerda.slice(0, 12),
  };
  writeFileSync(`${RAIZ}/reports/conceito/t2b-e3-perda.json`, `${JSON.stringify(saida, null, 1)}\n`);

  console.log('=== T2b E3: perda de tokens (apos normalizacao class<->typename) ===');
  console.log(`casos que nosso parser aceita: ${saida.aceitosTotal}`);
  console.log(`com perda REAL de tokens: ${saida.comPerdaTotal} (${(100*saida.taxaPerda).toFixed(1)}%)`);
  console.log('');
  console.log('categorias de perda real:');
  for (const [cat, n] of [...categorias].sort((a,b) => b[1]-a[1])) {
    const r = reprodutores[cat];
    console.log(`  ${String(n).padStart(5)}  ${cat}`);
    if (r) console.log(`      reprodutor (${r.tokensOrig} tok): ${r.reprodutor}`);
  }
  console.log('');
  console.log('gravado: reports/conceito/t2b-e3-perda.json');
  limpaTmp();
}
