/**
 * parse-project.mjs — diagnostica os 12 arquivos-fonte do projeto.
 *
 * Para CADA arquivo: nome | nº de diagnósticos | os 3 primeiros
 * (código, linha:coluna, mensagem) | CAUSA RAIZ.
 *
 * "Causa raiz" nunca é "erro de macro": quando o trecho que falha vem de
 * expansão de macro ou de include, o script imprime o texto
 * pós-preprocessamento na linha que falhou, para que a causa seja visível.
 *
 * Uso: node tests/tools/parse-project.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mapaIncludes } from './fs-loader.mjs';
import { Lexer } from '../../js/cpp/lexer.js';
import { Preprocessor } from '../../js/cpp/preprocessor.js';
import { Parser } from '../../js/cpp/parser.js';

const aqui = dirname(fileURLToPath(import.meta.url));
// `../..` a partir de `tests/tools/` é a raiz do REPO. Sem `import.meta.url`
// (quando o módulo é reexportado/embutido), cai para `process.cwd()`.
const raizCand = resolve(aqui, '..', '..');
const raiz = existsSync(resolve(raizCand, 'js/cpp/parser.js')) ? raizCand : process.cwd();

/** Os 12 arquivos do projeto: 2 headers + 3 fontes em src/ + 7 exemplos. */
export const ARQUIVOS = [
  'src/pixela.hpp',
  'src/pixela_wasm_bridge.hpp',
  'src/examples/mesh3d.cpp',
  'src/examples/particles.cpp',
  'src/shaders/volumetric.cpp',
  'tests/fixtures/examples/bounce.cpp',
  'tests/fixtures/examples/hello.cpp',
  'tests/fixtures/examples/plasma.cpp',
  'tests/fixtures/examples/saturn.cpp',
  'tests/fixtures/examples/scene3d.cpp',
  'tests/fixtures/examples/starfield.cpp',
  'tests/fixtures/examples/wireframecube.cpp',
];

/** Pré-processa e parseia um arquivo do projeto. */
export function analisaArquivo(arq) {
  const abs = resolve(raiz, arq);
  if (!existsSync(abs)) {
    return { arq, n: 0, diag: [], causa: `arquivo inexistente`, existe: false, texto: '' };
  }
  const fonte = readFileSync(abs, 'utf8');
  const includes = mapaIncludes(arq);

  // `headers` NÃO é passado: o prelúdio declarado vive em
  // `DEFAULT_HEADERS`, que o `Preprocessor` já aplica. Passar `headers: {}`
  // sobrescreveria o prelúdio com nada.
  const pp = new Preprocessor({ includes }).process(fonte, arq);
  const texto = pp.text;
  const lex = new Lexer(texto, arq).tokenize();
  const r = new Parser(lex.tokens, { file: arq }).parse();
  const diag = r.diagnostics ?? [];
  if (process.env.DEBUG_PP) console.error('[dbg]', arq, 'includes=', JSON.stringify(Object.keys(includes)), 'textoLen=', texto.length, 'n=', diag.length, 'fonteLen=', fonte.length, 'abs=', abs);

  // Causa raiz: a linha que falhou, no texto pós-preprocessamento. Se ela
  // difere da linha correspondente no ARQUIVO FÍSICO, o trecho veio gerado
  // (macro/include) — mostramos as duas para ficar claro.
  let causa = '—';
  if (diag.length > 0) {
    const d0 = diag[0];
    const pos = String(d0.loc.line);
    const gerado = (texto.split('\n')[d0.loc.line - 1] ?? '(fora do texto gerado)').trim();
    const original = (fonte.split('\n').find((l) => l.trim() && !l.trim().startsWith('//')
      && gerado.includes(l.trim().split(/\s+/).pop() ?? '\u0000')) ?? '(não localizado no fonte)').trim();
    causa = `pós-preprocessor \`${pos}: ${gerado.slice(0, 150)}\``
      + (original.startsWith('(não') ? '' : `<br>fonte \`${original.slice(0, 110)}\``);
  }
  return { arq, n: diag.length, diag, causa, existe: true, texto };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = [];
  out.push('| arquivo | nº diag | 3 primeiros (código, linha:col, mensagem) | causa raiz |');
  out.push('|---|---:|---|---|');
  let total = 0;
  let comErro = 0;
  for (const arq of ARQUIVOS) {
    const a = analisaArquivo(arq);
    total += a.n;
    if (a.n > 0) comErro++;
    const tres = a.diag.slice(0, 3)
      .map((d) => `\`${d.code} ${d.loc.line}:${d.loc.column}\` ${d.message}`).join('<br>')
      || '—';
    out.push(`| \`${arq}\` | ${a.n} | ${tres} | ${a.causa} |`);
  }
  out.push('');
  out.push(`**${ARQUIVOS.length - comErro}/${ARQUIVOS.length} arquivos com 0 diagnósticos. Total: ${total}.**`);
  console.log(out.join('\n'));
  process.exitCode = comErro === 0 ? 0 : 1;
}