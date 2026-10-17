/**
 * tests/conceito/t1/corpus-mutacao.mjs — E2(a): mutacao de token.
 *
 * Parte das 120 fixtures `parse-valid` (todas aceitas pelo g++ por
 * construcao) e produz variantes por mutacao de TOKEN:
 *
 *   apagar      remove um token
 *   trocar      substitui um token por outro do mesmo "tipo" (keyword por
 *               keyword, pontuacao por pontuacao, identificador por outro)
 *   duplicar    repete um token
 *   inserir     insere um token de pontuacao numa posicao valida
 *
 * As quatro operacoes sao EXHAUSTIVAS sobre o vocabulario, nao amostradas:
 * para cada token da fonte, geramos todos os trocar possiveis. E o que torna
 * o corpus reproduzivel — a semente nao governa nada aqui, e isso e de
 * proposito (ver `sementeDoCorpus`, que devolve um valor fixo e explica por
 * que o gerador de gramatica precisa dele e este nao).
 *
 * Regra 3: o corpus e ordenado por nome, e o nome embute a operacao e o
 * indice, para que duas execucoes deem o mesmo sha256.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Lexer } from '../../../js/cpp/lexer.js';

const RAIZ = new URL('../../..', import.meta.url).pathname;
export const VALIDE_DIR = join(RAIZ, 'tests', 'fixtures', 'parse-valid');

/** Vocabulario de troca, por tipo de token. Trocar keyword por keyword. */
const TROCAVEIS = {
  keyword: ['class', 'struct', 'enum', 'const', 'static', 'extern', 'template',
    'typename', 'typedef', 'namespace', 'using', 'inline', 'virtual', 'return',
    'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue'],
  ident: ['x', 'y', 'z', 'foo', 'bar', 'nome'],
  number: ['0', '1', '42'],
  string: ['"x"', '"y"'],
  punct: [';', ',', '{', '}', '(', ')', '[', ']', '=', '*', '&', '<', '>', '::', '+', '-'],
};

/**
 * Nome de ficheiro SEGURO e UNICO para um token.
 *
 * Nao se pode fazer `valor.replace(/[^\w]/g, '')`: `;`, `,` e `*` ficam TODOS
 * com nome vazio, e tres casos com o mesmo nome escrevem no mesmo ficheiro
 * temporario. Sob paralelismo passam a correr uma corrida, e o g++ le o
 * conteudo de outro caso — o veredito passa a ser de outro fonte. Foi o que
 * fez duas execucoes do E2 diferirem sem nenhum campo do resultado diferir.
 *
 * Codificar em hex o code point resolve: e unico, e nunca tem caractere de
 * caminho.
 */
export function nomeDeToken(v) {
  return Array.from(String(v)).map((ch) => ch.codePointAt(0).toString(16)).join('') || 'vazio';
}

export function fontesValidas() {
  return readdirSync(VALIDE_DIR)
    .filter((f) => f.endsWith('.cpp'))
    .sort()
    .map((f) => ({ nome: f.replace(/\.cpp$/, ''), fonte: readFileSync(join(VALIDE_DIR, f), 'utf8') }));
}

/** Tokens com linha/coluna, para reinserir na posicao certa. */
function tokensDe(src, nome) {
  const lex = new Lexer(src, nome).tokenize();
  return lex.tokens
    .map((t, i) => ({ ...t, i }))
    .filter((t) => t.type !== 'eof' && t.value !== '');
}

/** Reconstrói o fonte a partir da lista de tokens. */
function fonteDe(tokens) {
  return tokens.map((t) => (t.comEspaco === false ? String(t.value) : String(t.value))).join(' ')
    .replace(/\s+/g, ' ').trim() + '\n';
}

/**
 * Gera as variantes. Cada caso leva `op` e `i` no nome, para o nome ser
 * unico e estavel.
 */
export function gerarMutacoes({ limite = Infinity } = {}) {
  const casos = [];
  for (const { nome, fonte } of fontesValidas()) {
    const toks = tokensDe(fonte, `${nome}.cpp`);
    for (const t of toks) {
      // --- apagar
      casos.push({
        nome: `${nome}__apagar__${t.i}`,
        op: 'apagar', base: nome, i: t.i,
        fonte: fonteDe(toks.filter((x) => x.i !== t.i)),
      });
      // --- duplicar
      casos.push({
        nome: `${nome}__duplicar__${t.i}`,
        op: 'duplicar', base: nome, i: t.i,
        fonte: fonteDe([...toks.slice(0, t.i + 1), t, ...toks.slice(t.i + 1)]),
      });
      // --- trocar: todos os alvos do mesmo tipo
      for (const alvo of (TROCAVEIS[t.type] ?? [])) {
        if (String(alvo) === String(t.value)) continue;
        const novos = toks.map((x) => (x.i === t.i ? { ...x, value: alvo } : x));
        casos.push({
          nome: `${nome}__trocar__${t.i}__${nomeDeToken(alvo)}`,
          op: 'trocar', base: nome, i: t.i, de: String(t.value), para: String(alvo),
          fonte: fonteDe(novos),
        });
      }
    }
    // --- inserir pontuacao em cada fronteira entre tokens
    for (let k = 0; k <= toks.length; k++) {
      for (const p of [';', ',', '*']) {
        casos.push({
          nome: `${nome}__inserir__${k}__${nomeDeToken(p)}`,
          op: 'inserir', base: nome, i: k, para: p,
          fonte: fonteDe([...toks.slice(0, k), { value: p, type: 'punct' }, ...toks.slice(k)]),
        });
      }
    }
    if (casos.length >= limite) return casos.slice(0, limite);
  }
  return casos;
}
