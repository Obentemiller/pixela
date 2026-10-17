/**
 * tests/conceito/t2/runner.mjs — E1 do T2: parse -> unparse -> g++.
 *
 * O que se mede, em tres perguntas independentes:
 *
 *   1. FIDELIDADE   o que o `unparse` devolve ainda e C++ que o g++ aceita?
 *                   A fixture original e aceite (sao as 120 `parse-valid`); se
 *                   o unparse produz algo que o g++ rejeita, o unparse QUEBROU
 *                   um fonte bom.
 *
 *   2. IDEMPOTENCIA `unparse(unparse(ast))` == `unparse(ast)`?
 *                   `docs/ast.md` §1.4 promete que round-trip e identidade.
 *                   Se o unparse nao e um ponto fixo, a segunda passada muda o
 *                   terceira, e nao ha "a forma final".
 *
 *   3. PERDA        o unparse perdeu alguma coisa do original? Medido por
 *                   contagem de tokens, nao por semantica: token que o lexer
 *                   original tinha e o unparse nao tem.
 *
 * As tres sao DADO CRUD (regra 4). A classificacao e um passo a parte.
 */
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Lexer } from '../../../js/cpp/lexer.js';
import { Parser } from '../../../js/cpp/parser.js';
import { Preprocessor } from '../../../js/cpp/preprocessor.js';
import { unparse as unparseDoRepo } from '../../../js/cpp/ast.js';
import { TIMEOUT_MS, STD, tmpRaiz, limpaTmp, versoes } from '../t1/runner.mjs';

export { tmpRaiz, limpaTmp, versoes, TIMEOUT_MS, STD };

/**
 * O `unparse` que este bloco usa.
 *
 * `T2B_AST` aponta para um `ast.js` ALTERNATIVO — a copia patcheada em
 * `/tmp/t2b/js/cpp/`. Sem esta variavel, e o `ast.js` do repo.
 *
 * Existe porque o patch do T2b vive numa COPIA (`js/cpp/**` e LEITURA), e o
 * unparse e a unica coisa que muda: o `parser.js` e identico nas duas copias,
 * por isso o resto do pipeline continua a vir do repo.
 */
const CAMINHO_AST = process.env.T2B_AST ?? null;
export const UNPARSE_DE = CAMINHO_AST ?? 'js/cpp/ast.js (repo)';

let _unparse = unparseDoRepo;
if (CAMINHO_AST) {
  const mod = await import(CAMINHO_AST.startsWith('/') ? CAMINHO_AST : `file://${CAMINHO_AST}`);
  _unparse = mod.unparse;
}
export const unparse = (...a) => _unparse(...a);

/** Normaliza o stderr do g++: tira o caminho temporario, mantem os newlines. */
function limpa(msg) {
  return String(msg ?? '')
    .split('\n')
    .map((l) => l.replace(/\/tmp\/[^\s:)]+/g, '<TMP>').replace(/^g\+\+:\s*/, '')
      .replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n+$/, '');
}

/**
 * g++ -fsyntax-only sobre um texto qualquer.
 *
 * `noDisco` faz o g++ correr sobre o FICHEIRO REAL, no caminho real. E
 * obrigatorio para os fontes do projeto: `src/examples/mesh3d.cpp` inclui
 * `../pixela.hpp`, que e relativo ao FICHEIRO. Copiado para um diretorio
 * temporario, o include deixa de resolver e o g++ responde
 * `fatal error: ../pixela.hpp: Arquivo ou diretório inexistente` — o veredito
 * passa a ser sobre nada.
 */
export function gppTexto(src, nome = 't.cpp', raiz = tmpRaiz(), { noDisco = null } = {}) {
  return new Promise((resolve) => {
    const caminho = noDisco ?? join(raiz, nome.endsWith('.cpp') ? nome : `${nome}.cpp`);
    if (noDisco === null) writeFileSync(caminho, src);
    execFile('g++', ['-fsyntax-only', STD, caminho],
      { timeout: TIMEOUT_MS, maxBuffer: 1 << 22 },
      (err, stdout, stderr) => {
        if (err && err.killed) {
          return resolve({ ok: null, exit: null, erro1: null, msg: null, timeout: true });
        }
        const codigo = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
        const s = limpa(stderr);
        const linhas = s.split('\n').map((x) => x.trim()).filter(Boolean);
        const i = linhas.findIndex((l) => /(^|\s)error:/.test(l));
        const fatal = linhas.findIndex((l) => /fatal error:/.test(l));
        const idx = fatal >= 0 ? fatal : i;
        return resolve({
          ok: codigo === 0,
          exit: codigo,
          erro1: idx >= 0 ? linhas[idx] : (linhas[0] ?? null),
          msg: idx >= 0 ? linhas[idx].replace(/^.*?(fatal error|error):\s*/, '') : null,
          // o include resolveu? um `fatal error` de include nao e veredito de sintaxe
          includeFalhou: fatal >= 0,
          analisou: !/linker input file unused/.test(s),
          timeout: false,
        });
      });
  });
}

/** Os tokens de um texto, como o lexer os ve. */
export function tokensDe(src) {
  return new Lexer(src, 'x.cpp').tokenize().tokens
    .filter((t) => t.type !== 'eof' && t.value !== '');
}

/** parse -> unparse. Devolve null se o parser nao conseguir. */
export function desparse(src, nome = 't.cpp') {
  try {
    const pp = new Preprocessor({}).process(src, nome);
    const lex = new Lexer(pp.text, nome).tokenize();
    const r = new Parser(lex.tokens, { file: nome }).parse();
    const erros = [...(lex.diagnostics ?? []), ...(r.diagnostics ?? [])]
      .filter((d) => d.severity === 'error');
    return { ast: r.ast, erros: erros.length, erro1: erros[0] ? `${erros[0].loc.line}:${erros[0].loc.column} ${erros[0].message}` : null };
  } catch (e) {
    return { ast: null, erros: -1, erro1: `EXCEPCAO: ${e.message}` };
  }
}

/**
 * O julgamento completo de um fonte. `nome` tem de ser UNICO no processo:
 * todos os casos partilham um diretorio temporario (ver t1/runner.mjs, e o
 * bug de nomes duplicados que ai custou uma execucao inteira).
 */
export async function julgarRoundTrip(src, nome = 't.cpp', { noDisco = null } = {}) {
  const original = await gppTexto(src, nome, tmpRaiz(), { noDisco });
  const d = desparse(src, nome);
  if (!d.ast) {
    return {
      nome, original,
      desparse: null, segunda: null, terceira: null,
      idempotente: null, tokensOrig: tokensDe(src).length, tokensSai: null,
      lancei: true, erroParser: d.erro1,
    };
  }
  const u1 = unparse(d.ast);
  const segunda = await gppTexto(u1, nome);
  // a terceira passada: unparse do AST que veio do texto desparseado
  const d2 = desparse(u1, nome);
  const u2 = d2.ast ? unparse(d2.ast) : null;
  return {
    nome, original,
    desparse: { texto: u1, gpp: segunda },
    segunda, terceira: u2,
    idempotente: u2 === null ? null : u1 === u2,
    tokensOrig: tokensDe(src).length,
    tokensSai: tokensDe(u1).length,
    lancei: false,
    erroParser: d.erro1,
  };
}

export async function roda(casos, { conc = 8 } = {}) {
  const res = new Array(casos.length);
  let prox = 0;
  const trab = async () => {
    for (;;) {
      const i = prox++;
      if (i >= casos.length) return;
      res[i] = await julgarRoundTrip(casos[i].fonte, casos[i].nome, { noDisco: casos[i].noDisco ?? null });
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, casos.length || 1) }, trab));
  return res;
}
