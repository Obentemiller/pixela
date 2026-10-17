/**
 * tests/tools/lib/compilers.mjs — funções auxiliares para rodar g++ e clang.
 *
 * Usadas por validate-fixtures.mjs, diff-parse.mjs e diff-ast.mjs.
 * Todas aceitam `--root <dir>` e importam js/cpp/{lexer,preprocessor,parser,ast}.js
 * DESSE diretório.
 *
 * NADA aqui compara string de tipo crua: os normalizadores vivem em
 * diff-ast.mjs e comparam {base, constEsq, constDir, ptrDepth, ref, arrayDims}.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
/** Raiz do repositório: `tests/tools/lib/` mais três níveis acima. */
export const RAIZ = pathResolve(AQUI, '..', '..', '..');

/** Lê o diretório raiz do worktree a partir de --root (default: '.'). */
export function rootDir(argv = process.argv) {
  const i = argv.indexOf('--root');
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  return '.';
}

/** Caminho absoluto da raiz efetiva. */
export function raizEfetiva(root = rootDir()) {
  return pathResolve(RAIZ, root);
}

/** `git rev-parse HEAD` da raiz, ou null se não for um repositório. */
export function gitHead(root) {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

/**
 * `git hash-object` de um arquivo da raiz — o identificador do CONTEÚDO, que é
 * o que importa para dizer "este harness mediu aquele código".
 *
 * `git hash-object` sem `--path` não é influenciado por `.gitattributes`, então
 * dois arquivos com o mesmo conteúdo dão o mesmo hash mesmo em worktrees
 * diferentes.
 */
export function gitHashObject(root, caminhoRel) {
  try {
    return execFileSync('git', ['-C', root, 'hash-object', caminhoRel],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    const abs = join(root, caminhoRel);
    if (!existsSync(abs)) return null;
    return execFileSync('git', ['hash-object', '--stdin'], {
      input: readFileSync(abs), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  }
}

/**
 * Cabeçalho de proveniência do harness.
 *
 * Sem isto, A3 v1 e A3 v2 produziram JSON quase idênticos e o relatório
 * escreveu que "o parser não mudou" — afirmação FALSA: `parser.js` e `ast.js`
 * DIFEREM entre 68ae1b9 e o HEAD. O que era verdade é que ambos mediam o
 * **stub**, que nenhum dos dois parsers parseava inteiro. O cabeçalho existe
 * para que isso não possa acontecer de novo em silêncio.
 */
export function cabecalho(root) {
  const raiz = raizEfetiva(root);
  const modulos = {};
  for (const m of ['lexer', 'preprocessor', 'parser', 'ast']) {
    modulos[`${m}.js`] = gitHashObject(raiz, `js/cpp/${m}.js`);
  }
  return {
    rootAbsoluto: raiz,
    gitHead: gitHead(raiz),
    modulos,
    versaoNode: process.version,
  };
}

/** Caminho absoluto para js/cpp/<arquivo> na raiz especificada. */
export function cppPath(root, arquivo) {
  return join(raizEfetiva(root), 'js', 'cpp', arquivo);
}

/** Importa dinamicamente js/cpp/<arquivo> da raiz especificada. */
export async function importCpp(root, arquivo) {
  return import(cppPath(root, arquivo));
}

/** Roda g++ -std=c++17 -fsyntax-only e devolve {ok, stderr}. */
export function gppSyntax(fonte, extra = []) {
  try {
    execFileSync('g++', ['-std=c++17', '-fsyntax-only', ...extra, '-x', 'c++', '-'], {
      input: fonte, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, stderr: '' };
  } catch (e) {
    return { ok: false, stderr: e.stderr ?? String(e) };
  }
}

/**
 * Roda g++ -fdiagnostics-format=json e devolve os diagnósticos normalizados.
 *
 * O g++ entrega UM array JSON; a localização fica em `locations[0].caret.line`,
 * não em `loc.line`.
 */
export function gppJson(fonte, extra = []) {
  try {
    execFileSync('g++', ['-std=c++17', '-fsyntax-only', '-fdiagnostics-format=json', ...extra, '-x', 'c++', '-'], {
      input: fonte, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, erros: [] };
  } catch (e) {
    const stderr = e.stderr ?? String(e);
    let brutos = [];
    try {
      const arr = JSON.parse(stderr.trim());
      brutos = Array.isArray(arr) ? arr : [arr];
    } catch {
      for (const linha of stderr.split('\n')) {
        if (!linha.trim().startsWith('{')) continue;
        try { brutos.push(JSON.parse(linha)); } catch { /* ignora */ }
      }
    }
    return { ok: false, erros: brutos.map(normalizeGpp) };
  }
}

function normalizeGpp(b) {
  const caret = b.locations?.[0]?.caret;
  return {
    severity: b.kind ?? 'error',
    code: b.option ?? null,
    message: b.message ?? '',
    loc: { line: caret?.line ?? null, column: caret?.column ?? null, file: caret?.file ?? null },
  };
}

/** Roda clang++ -Xclang -ast-dump=json e devolve o JSON da AST. */
export function clangAst(fonte, extra = []) {
  try {
    const stdout = execFileSync('clang++',
      ['-std=c++17', '-fsyntax-only', '-Xclang', '-ast-dump=json', ...extra, '-x', 'c++', '-'],
      { input: fonte, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 128 * 1024 * 1024 });
    return { ok: true, ast: JSON.parse(stdout) };
  } catch (e) {
    return { ok: false, stderr: e.stderr ?? String(e) };
  }
}

/**
 * Lê o std-stub.h e concatena antes do fixture.
 *
 * Devolve também `offsetFixture`: a PRIMEIRA linha do fixture. O harness usa
 * esse offset para separar "o parser errou o stub" (INFRA, falha o harness) de
 * "o parser errou o fixture" (divergência de verdade).
 */
export function comStub(fonte) {
  const caminhoStub = join(RAIZ, 'tests', 'fixtures', 'std-stub.h');
  const stub = readFileSync(caminhoStub, 'utf8');
  const linhasStub = stub.split('\n').length;
  return {
    texto: `${stub}\n${fonte}`,
    linhasStub,
    /** Primeira linha (1-based) do fixture no texto combinado. */
    offsetFixture: linhasStub + 1,
    caminhoStub,
  };
}

/** Extrai o cabeçalho `//!` de um fixture. */
export function header(fonte) {
  const h = { expect: null, category: null, note: null };
  for (const linha of fonte.split('\n')) {
    const m = /^[\/][\/]! (\w+): (.+)$/.exec(linha);
    if (m) h[m[1]] = m[2];
    if (!linha.startsWith('//!')) break;
  }
  return h;
}

/** Lista recursiva de arquivos .cpp/.hpp/.h de um diretório, ordenados. */
export function arquivosDe(dir, prefixo = '') {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const nome of readdirSync(dir).sort()) {
    const p = join(dir, nome);
    const rel = prefixo ? `${prefixo}/${nome}` : nome;
    if (statSync(p).isDirectory()) out.push(...arquivosDe(p, rel));
    else if (/\.(cpp|hpp|h|cc|cxx)$/.test(nome)) out.push(rel);
  }
  return out;
}