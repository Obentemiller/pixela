/**
 * tests/conceito/t1/runner.mjs — E1 do T1.
 *
 * Para um ficheiro .cpp, roda DOIS julgamentos independentes:
 *   - NOSSO: Preprocessor -> Lexer -> Parser (import direto de js/cpp/)
 *   - g++:   `g++ -fsyntax-only -std=c++17`
 *
 * E devolve DADO CRUD (regra 4): o veredito e a PRIMEIRA LINHA do erro do
 * g++, mais o código de saída. A CLASSIFICACAO e um passo separado (E3) e
 * nao vive aqui — se fosse aqui, o dado e a interpretacao misturavam-se e a
 * soma por categoria nao podia ser conferida contra o total.
 *
 * Timeout de 5 s por caso, com paralelismo. O timeout conta como
 * "indeterminado", nunca como veredito: um g++ que travou nao diz nada sobre
 * a sintaxe.
 */
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Lexer } from '../../../js/cpp/lexer.js';
import { Parser } from '../../../js/cpp/parser.js';
import { Preprocessor } from '../../../js/cpp/preprocessor.js';

export const STD = '-std=c++17';
export const TIMEOUT_MS = 5000;

/** Diretorio de trabalho, fora do repo: nada do T1 escreve no repo. */
let TMP = null;
export function tmpRaiz() {
  if (!TMP) TMP = mkdtempSync(join(tmpdir(), 't1-'));
  return TMP;
}
export function limpaTmp() {
  if (TMP) { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* ja removido */ } TMP = null; }
}

/**
 * NOSSO: Preprocessor -> Lexer -> Parser.
 *
 * A armadilha do `.tokens`: `new Lexer(src, f).tokenize()` devolve o OBJETO
 * `{tokens, diagnostics}`. Passar esse objeto ao Parser devolve AST vazia com
 * ZERO diagnosticos, sem excecao. Tem de ser `lexResultado.tokens`.
 */
export function nosso(src, nome = 't.cpp') {
  const t0 = process.hrtime.bigint();
  try {
    const pp = new Preprocessor({}).process(src, nome);
    const lex = new Lexer(pp.text, nome).tokenize();
    const r = new Parser(lex.tokens, { file: nome }).parse();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const todos = [...(lex.diagnostics ?? []), ...(r.diagnostics ?? [])];
    const erros = todos.filter((d) => d.severity === 'error');
    return {
      alvo: 'nosso',
      ok: erros.length === 0,
      nErros: erros.length,
      // primeira linha de erro do NOSSO tambem, para comparar com o g++
      erro1: erros.length ? `${erros[0].loc.line}:${erros[0].loc.column} ${erros[0].message}` : null,
      todos: erros.map((d) => `${d.loc.line}:${d.loc.column} ${d.message}`),
      timeout: false,
      ms,
    };
  } catch (e) {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    return {
      alvo: 'nosso',
      ok: false, nErros: -1, erro1: `EXCEPCAO: ${e.message}`,
      todos: [`EXCEPCAO: ${e.message}`], timeout: false, lancou: true, ms,
    };
  }
}

/**
 * g++ -fsyntax-only -std=c++17. Devolve exit, stderr e a PRIMEIRA LINHA de
 * erro — que e o dado cru de que a classificacao depende.
 */
/**
 * Normaliza o stderr do g++ para o DADO CRU ser REPRODUZIVEL (regra 3).
 *
 * O g++ escreve o CAMINHO temporario nas mensagens (`/tmp/t1-XXXX/...`), e o
 * diretorio temporario muda a cada execucao. Sem tirar o caminho, duas
 * execucoes do mesmo corpus dao sha256 diferentes — foi o que se viu na 1a
 * verificacao do E2.
 *
 * Os NEWLINES sao PRESERVADOS de proposito: o diagnostico do g++ tem quatro
 * linhas (mensagem, fonte, cursor, nota) e so a primeira e o dado. Achatar
 * tudo num so paragrafo mistura a mensagem com a linha de fonte e com o
 * cursor, e a classificacao passa a trabalhar sobre ruido.
 */
function limpa(msg) {
  return String(msg ?? '')
    .split('\n')
    .map((l) => l.replace(/\/tmp\/[^\s:)]+/g, '<TMP>').replace(/^g\+\+:\s*/, '').replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n+$/, '');
}

export function gpp(src, nome = 't.cpp', raiz = tmpRaiz()) {
  return new Promise((resolve) => {
    // O ficheiro TEM de acabar em `.cpp`: sem extensao o g++ nao reconhece a
    // linguagem, responde `linker input file unused because linking not done`
    // e sai com 0 — parecendo que aprovou um fonte que nunca leu. Foi o que
    // aconteceu na 1a execucao do E2, em 20 717 de 24 971 casos.
    const caminho = join(raiz, nome.endsWith('.cpp') ? nome : `${nome}.cpp`);
    const t0 = process.hrtime.bigint();
    execFile('g++', ['-fsyntax-only', STD, caminho],
      { timeout: TIMEOUT_MS, maxBuffer: 1 << 22 },
      (err, stdout, stderr) => {
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        if (err && err.killed) {
          return resolve({
            alvo: 'gpp', ok: null, exit: null, erro1: null,
            stderr: limpa(stderr), analisou: false, timeout: true, ms,
          });
        }
        const codigo = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
        const stderrLimpo = limpa(stderr);
        const linhas = stderrLimpo.split('\n').map((s) => s.trim()).filter(Boolean);
        // A MENSAGEM e a primeira linha que traz `error:`. As linhas seguintes
        // sao a linha de fonte, o cursor e as notas — dado do compilador que
        // E3 usa para separar sintatico de semantico.
        const idxErro = linhas.findIndex((l) => /(^|\s)error:/.test(l));
        const primeira = idxErro >= 0 ? linhas[idxErro]
          : (linhas.find((l) => /warning:/.test(l)) ?? linhas[0] ?? null);
        resolve({
          alvo: 'gpp',
          ok: codigo === 0,
          exit: codigo,
          // PRIMEIRA LINHA DE ERRO: dado cru, sem interpretar
          erro1: primeira ? limpa(primeira) : null,
          // so a MENSAGEM, sem a posicao: e o que a tabela de padroes usa
          msg: idxErro >= 0 ? linhas[idxErro].replace(/^.*?\berror:\s*/, '') : null,
          stderr: stderrLimpo,
          // O g++ chegou a LER o fonte? Se nao, o veredito nao vale nada.
          analisou: !/linker input file unused/.test(stderrLimpo),
          timeout: false,
          ms,
        });
      });
  });
}

/** Os dois julgamentos de uma fonte. */
export async function julgar(src, nome = 't.cpp', raiz = tmpRaiz()) {
  // O g++ só aceita ficheiros: a fonte tem de estar no disco antes dele correr.
  writeFileSync(join(raiz, nome.endsWith('.cpp') ? nome : `${nome}.cpp`), src);
  const [n, g] = [nosso(src, nome), await gpp(src, nome, raiz)];
  return { nome, fonte: src, nosso: n, gpp: g };
}

/**
 * Roda um corpus com paralelismo. `casos` sao `{nome, fonte}`.
 * Devolve os resultados na MESMA ordem de `casos` — o paralelismo nao pode
 * mexer na ordem, senao o hash de duas execucoes difere.
 */
export async function roda(casos, { conc = 8 } = {}) {
  const res = new Array(casos.length);
  let prox = 0;
  const trab = async () => {
    for (;;) {
      const i = prox++;
      if (i >= casos.length) return;
      res[i] = await julgar(casos[i].fonte, casos[i].nome);
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, casos.length || 1) }, trab));
  return res;
}

/** Versoes do oraculo e da plataforma: regra 3, em todo log. */
export function versoes() {
  return {
    gpp: execFileSync('g++', ['--version'], { encoding: 'utf8' }).split('\n')[0],
    node: process.version,
    plataforma: `${process.platform} ${process.arch}`,
  };
}
