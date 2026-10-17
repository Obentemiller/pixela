/**
 * tests/conceito/t3/harness.mjs — E1 do T3: mutar `parser.js` e ver se algum
 * teste nota.
 *
 * ---------------------------------------------------------- o mutante
 *
 * A mutacao acontece numa COPIA em `/tmp`. `js/cpp/**` e LEITURA (regra 6), e
 * mesmo nao sendo, um mutante que corresse no sitio estragaria o repo.
 *
 * -------------------------------------------------------------- o que mata
 *
 * Cada mutante e julgado em duas fases, porque cada fase responde a uma
 * pergunta diferente:
 *
 *   FASE 1 — os testes do PARSER. Se algum falla, o mutante MORREU e morreu
 *            barato. Nao ha nada a perguntar.
 *   FASE 2 — a suite CHEIA. So para os que sobreviveram a fase 1. Sobrevivente
 *            da suite toda e um buraco real: nao ha nenhum teste no projeto
 *            que veja este codigo mudar.
 *
 * E por isso que o "sobrevivente" e o resultado que interessa. A taxa de
 * morte diz quao boa e a suite; CADA sobrevivente diz o que falta.
 *
 * ------------------------------------------------------------ a copia
 *
 * Copia-se `js/`, `tests/unit/` e `tests/tools/` uma UNICA vez. Os testes
 * importam por caminho relativo (`../../js/cpp/parser.js`), por isso basta
 * reescrever `js/cpp/parser.js` da copia por mutante — nao ha uma copia do
 * repo por mutante.
 */
import { chmodSync, cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const RAIZ = new URL('../../../', import.meta.url).pathname;

/**
 * Destrava uma arvore, entrada a entrada.
 *
 * `chmodSync(dir, 0o755, {recursive:true})` NAO SERVE: em Node 22 nao aplica o
 * modo aos ficheiros aninhados e nao da erro. Fica tudo a 444/555 e o
 * primeiro mutante leva EACCES sem nenhuma pista. Percorrer a mao e a unica
 * forma de saber que happened.
 */
function destrava(raiz) {
  const anda = (p) => {
    try { chmodSync(p, 0o755); } catch { /* ja desbloqueado ou sem permissao */ }
    let itens = [];
    try { itens = readdirSync(p, { withFileTypes: true }); } catch { return; }
    for (const d of itens) {
      const q = join(p, d.name);
      if (d.isDirectory()) anda(q);
      else { try { chmodSync(q, 0o644); } catch { /* ficheiro bloqueado */ } }
    }
  };
  anda(raiz);
}

/** Um unico workspace, montado uma vez. */
export function montaWorkspace(nome = 't3') {
  const raiz = join(tmpdir(), `${nome}-${process.pid}`);
  rmSync(raiz, { recursive: true, force: true });
  mkdirSync(raiz, { recursive: true });
  cpSync(join(RAIZ, 'js'), join(raiz, 'js'), { recursive: true });
  cpSync(join(RAIZ, 'tests'), join(raiz, 'tests'), { recursive: true });
  // `js/cpp/**` esta em `chmod -R a-w` enquanto dura a ordem longa, e o
  // `cpSync` HERDA as permissoes. Destravar a COPIA, nunca o original.
  destrava(raiz);
  return raiz;
}

export function limpaWorkspace(raiz) {
  try { rmSync(raiz, { recursive: true, force: true }); } catch { /* ja removido */ }
}

export const PARSER_ORIGINAL = () => readFileSync(join(RAIZ, 'js', 'cpp', 'parser.js'), 'utf8');

/** Escreve o mutante e devolve o sha256 do ficheiro escrito. */
export function aplicaMutante(raiz, fonte) {
  const caminho = join(raiz, 'js', 'cpp', 'parser.js');
  writeFileSync(caminho, fonte);
  return caminho;
}

/** Roda um conjunto de ficheiros de teste e diz quantos falharam. */
export function rodaTestes(raiz, ficheiros, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    execFile(process.execPath, ['--test-reporter=tap', ...ficheiros],
      { cwd: raiz, timeout: timeoutMs, maxBuffer: 1 << 26 },
      (err, stdout) => {
        const s = String(stdout ?? '');
        const num = (re) => { const m = s.match(re); return m ? Number(m[1]) : null; };
        const testes = num(/^# tests (\d+)/m);
        const passou = num(/^# pass (\d+)/m);
        const falhou = num(/^# fail (\d+)/m);
        const nomesFalha = [...s.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1].trim());
        resolve({
          ok: falhou === 0 && testes !== null && testes > 0,
          testes, passou, falhou, nomesFalha,
          // timeout ou crash do runner: NAO e um mutante morto, e um veredito ausente
          semVeredito: testes === null,
          ms: Date.now() - t0,
          stderr: err && !testes ? String(err.message ?? '').slice(0, 200) : null,
        });
      });
  });
}

/**
 * FASE 1: os testes que exercitam o PARSER.
 *
 * Escolhidos por nome, nao por métrica: sao os ficheiros cujo assunto e a
 * construcao da arvore. Incluir o `goldens.test.js` aqui seria razoavel (ele
 * compara a AST inteira), mas entao a fase 1 mediria quase o mesmo que a fase
 * 2 e a taxa de morte da fase 1 nao diria nada sobre o foco.
 */
const DO_PARSER = [
  'parser.test.js', 'parser-type-nome.test.js', 'parser-fuzz.test.js',
  'ast-roundtrip.test.js', 'roundtrip-projeto.test.js', 'preludio.test.js',
];

/** FASE 2: a suite toda. */
export function todosOsTestes(raiz) {
  const dir = join(raiz, 'tests', 'unit');
  return readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort()
    .map((f) => join('tests', 'unit', f));
}

/** Os ficheiros de teste do parser (fase 1). Devolve o que existe mesmo. */
export function ficheirosDoParser(raiz) {
  const existe = new Set(readdirSync(join(raiz, 'tests', 'unit')));
  return DO_PARSER.filter((f) => existe.has(f)).map((f) => join('tests', 'unit', f));
}
