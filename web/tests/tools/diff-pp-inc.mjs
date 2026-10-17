#!/usr/bin/env node
/**
 * diff-pp-inc.mjs — diferencial de RESOLUÇÃO DE INCLUDE contra o g++.
 *
 * Para cada diretório de caso em `tests/fixtures/pp-inc/<caso>/`:
 *   1. roda `g++ -E -P -nostdinc -x c++` sobre o `.cpp` principal, com o
 *      diretório do caso na frente de `-I`, e coleta a sequência de TOKENS;
 *   2. roda o nosso `Preprocessor` com o mesmo mapa de includes;
 *   3. compara as duas sequências.
 *
 * O que está em teste é o include RELATIVO AO ARQUIVO QUE INCLUI — que é a
 * regra que a A1 centralizou em `resolve()` (`js/cpp/preprocessor.js`).
 *
 * Uso: node tests/tools/diff-pp-inc.mjs [--verbose]
 * Sai com 1 se qualquer caso divergir.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Preprocessor } from '../../js/cpp/preprocessor.js';
import { mapaIncludes } from './fs-loader.mjs';
import { Lexer } from '../../js/cpp/lexer.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CASOS = join(RAIZ, 'tests', 'fixtures', 'pp-inc');
const VERBOSE = process.argv.includes('--verbose');

/** Sequência de tokens de uma saída de pré-processador. */
function paraTokens(texto) {
  const lex = new Lexer(texto, 'saida.cpp').tokenize();
  return lex.tokens
    .filter((t) => t.type !== 'eof' && t.type !== 'error'
      && !(t.type === 'hash') && String(t.value ?? '').trim() !== '')
    .map((t) => `${t.type}:${t.value}`);
}

/** Arquivos .cpp/.hpp/.h de um diretório, ordenados. */
function arquivosDe(dir, prefixo = '') {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const nome of readdirSync(dir).sort()) {
    const p = join(dir, nome);
    const rel = prefixo ? `${prefixo}/${nome}` : nome;
    if (nome.includes('.')) {
      if (/\.(cpp|hpp|h|cc|cxx)$/.test(nome)) out.push(rel);
    } else {
      out.push(...arquivosDe(p, rel));
    }
  }
  return out;
}

const casos = existsSync(CASOS) ? readdirSync(CASOS).sort() : [];
const linhas = [];
const divergentes = [];
const desvios = [];
let total = 0;
let iguais = 0;

for (const caso of casos) {
  const dir = join(CASOS, caso);
  const principal = arquivosDe(dir).find((f) => f.endsWith('.cpp'));
  if (!principal) {
    divergentes.push(`${caso}: sem .cpp principal`);
    linhas.push(`SEM-MAIN ${caso}`);
    continue;
  }
  const fonte = readFileSync(join(dir, principal), 'utf8');

  // O caso é de ERRO por desenho? Aí os DOIS lados precisam recusar, e o que
  // se compara é a CONCLUSÃO (erro/não-erro), não a lista de tokens.
  const esperaErro = existsSync(join(dir, 'esperaErro.txt'));
  // `DESVIO.txt`: a diferença com o g++ é intencional e documentada (ver
  // docs/ast.md). O caso é listado, com o texto do desvio, e NÃO conta como
  // divergência — mas também não pode sumir do relatório.
  const desvio = existsSync(join(dir, 'DESVIO.txt'))
    ? readFileSync(join(dir, 'DESVIO.txt'), 'utf8').trim() : null;
  const nossaIncludes = arquivosDe(dir).filter((f) => !f.endsWith('RESPOSTA.txt'));
  const incluiArquivosDeTeste = nossaIncludes.length > 0;

  // (1) g++
  let gppOk = true;
  let gppErro = null;
  let esperado = null;
  try {
    const bruto = execFileSync('g++', [
      '-E', '-P', '-nostdinc', '-x', 'c++', `-I${dir}`, join(dir, principal),
    ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    esperado = paraTokens(bruto);
  } catch (e) {
    gppOk = false;
    gppErro = `${e.stderr ?? e.message}`.split('\n')
      .filter((l) => /error|fatal/.test(l))[0]?.trim() ?? 'erro desconhecido';
  }

  // (2) nosso
  //
  // As chaves do mapa são os CAMINHOS CANÔNICOS relativos à raiz — o mesmo
  // formato que `mapaIncludes` produz e que o `Preprocessor` usa para
  // `currentFile`. Antes este bloco montava um mapa com chaves CURTAS
  // (`h.h`, `/h.h`), e isso mudava o comportamento do preprocessor: com
  // chaves curtas, o preprocessor antigo (68ae1b9) resolvia `caso13`
  // corretamente porque a terceira tentativa de canonicalização produzia
  // exatamente a chave curta. Com chaves de caminho completo, o mesmo
  // preprocessor NÃO resolve — e é essa a diferença que o R7 mede.
  //
  // Ou seja: o comparador estava usando um formato de chave que mascara o
  // bug. O teste `pp-inc.test.js` sempre usou `mapaIncludes` (chaves
  // completas) e por isso acusava; o diferencial não.
  const mapa = mapaIncludes(`tests/fixtures/pp-inc/${caso}`);
  for (const [k, v] of Object.entries(mapa)) mapa[`/${k}`] = v;
  // O `currentFile` tem de ser o caminho CANÔNICO completo (relativo à raiz),
  // porque é ele que o `Preprocessor` usa para resolver `..` relativo ao
  // includer. Com um nome curto (`main.cpp`), o `resolve` não tem como
  // produzir as chaves do mapa.
  const pp = new Preprocessor({ includes: mapa })
    .process(fonte, join('tests', 'fixtures', 'pp-inc', caso, principal));
  const obtido = paraTokens(pp.text);

  if (desvio) {
    total++;
    // Um desvio declarado é uma DIFERENÇA ACEITA. Ele sai na linha própria,
    // fora das contagens de OK, e o texto do desvio vai junto para que a
    // justificativa fique no log, não só no código.
    desvios.push(caso);
    linhas.push(`DESVIO   ${caso}`);
    for (const l of desvio.split('\n')) linhas.push(`    ${l}`);
    continue;
  }

  const nossoOk = pp.diagnostics.filter((d) => /não encontrado|circular|Profundidade/.test(d.message)).length === 0;

  total++;
  if (esperaErro) {
    // Os DOIS lados precisam recusar.
    const concordam = gppOk === false && nossoOk === false;
    if (concordam) {
      iguais++;
      linhas.push(`OK       ${caso} (ERRO por desenho; os dois recusaram)`);
      if (VERBOSE) linhas.push(`    g++:  ${gppErro}\n    nosso: ${pp.diagnostics.map((d) => d.message).join('; ')}`);
    } else {
      divergentes.push(caso);
      linhas.push(`DIFERE   ${caso} — caso de ERRO, mas g++ ok=${gppOk} e nosso ok=${nossoOk}`);
      if (VERBOSE) linhas.push(`    g++:  ${gppErro ?? '(aceitou)'}\n    nosso: ${pp.diagnostics.map((d) => d.message).join('; ') || '(aceitou)'}`);
    }
    continue;
  }

  if (!gppOk) {
    // O g++ recusou um caso que NÃO é de erro por desenho: a fixture está
    // errada (include que nem o g++ acha). Não é divergência do compilador.
    linhas.push(`FIXTURE  ${caso} — g++ recusou: ${gppErro}`);
    continue;
  }

  const bate = JSON.stringify(esperado) === JSON.stringify(obtido);
  if (bate) {
    iguais++;
    linhas.push(`OK       ${caso} (${esperado.length} tokens)`);
  } else {
    divergentes.push(caso);
    linhas.push(`DIFERE   ${caso}  g++=${esperado.length} tokens, nosso=${obtido.length}`);
    if (VERBOSE) {
      for (let i = 0; i < Math.max(esperado.length, obtido.length); i++) {
        if (esperado[i] !== obtido[i]) {
          linhas.push(`    primeiro diferença na posição ${i}:`);
          linhas.push(`      g++  : ${esperado[i] ?? '(fim)'}`);
          linhas.push(`      nosso: ${obtido[i] ?? '(fim)'}`);
          break;
        }
      }
      linhas.push(`    texto do nosso: ${JSON.stringify(pp.text.slice(0, 300))}`);
    }
  }
}

linhas.unshift(`[diff-pp-inc] ${casos.length} casos, ${iguais} iguais, ${divergentes.length} divergentes, ${desvios.length} desvios declarados`);
const relatorio = `${linhas.join('\n')}\n`;
console.log(relatorio);
mkdirSync(join(RAIZ, 'reports'), { recursive: true });
writeFileSync(join(RAIZ, 'reports', 'diff-pp-inc.log'), relatorio);
process.exit(divergentes.length === 0 && iguais + desvios.length > 0 ? 0 : 1);