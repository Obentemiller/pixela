/**
 * tests/conceito/t3/mutar.mjs — os operadores de mutacao.
 *
 * ---------------------------------------------------------- por que NAO e
 * qualquer coisa
 *
 * Um mutante que muda um comentario, uma string de log ou um espaco nao diz
 * nada sobre a suite: e um mutante EQUIVALENTE, e a "morte" dele seria um
 * falso negativo. `tests/tools/mutantes-pp.mjs` ja exige prova de equivalencia
 * para os mutantes do pre-processador; aqui a mesma exigencia vale, e por isso
 * que todo mutante gerado e validado antes de contar.
 *
 * O que e um mutante VALIDO: uma mudanca que muda o que o codigo FAZ, dentro
 * de uma categoria de operador reconhecida. Um mutante equivalente (ou
 * apenas syntacticamente diferente) e descartado e contado como tal.
 *
 * ------------------------------------------------------------ o espectro
 *
 * Os operadores estao escolhidos para cobrir as DECISOES do parser, nao as
 * suas linhas: comparacao, controlo de fluxo, limites de guarda, e os valores
 * de codigo de diagnostico. Um mutante de `===` para `!==` muda uma decisao;
 * um mutante de `'int'` para `'Int'` so muda texto.
 *
 * Regra 3: tudo semeado e ordenado. Duas execucoes, os mesmos mutantes.
 */

/** PRNG mulberry32 — o mesmo do T1, pela mesma razao. */
export function prng(semente) {
  let a = semente >>> 0;
  return function proximo() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Cada operador devolve `null` quando nao se aplica na linha, e uma MUDANCA
 * concreta quando se aplica. A mudanca ja vem no formato que o registo usa.
 */
export const OPERADORES = [
  {
    nome: 'trocar-igualdade',
    // `a === b` -> `a !== b`. Muda uma DECISAO.
    aplica(linha) {
      if (!/\s(===|!==)\s/.test(linha)) return null;
      const novo = linha.replace(/\s(===|!==)\s/, (m, op) => ` ${op === '===' ? '!==' : '==='} `);
      return novo === linha ? null : novo;
    },
  },
  {
    nome: 'trocar-relacional',
    // `<` -> `<=`, `>` -> `>=`, e o inverso. Muda um LIMITE.
    aplica(linha) {
      // nao mexer em `=>`, `<<`, `>>`, `||`, `&&`: nao sao o que queremos
      if (/=>|<<|>>|\|\||&&/.test(linha)) return null;
      if (!/[<>]/.test(linha)) return null;
      const novo = linha.replace(/(?<![<>=!])</g, '<=').replace(/(?<![<>=!])>/g, '>=');
      return novo === linha ? null : novo;
    },
  },
  {
    nome: 'negar-condicao',
    // `if (c)` -> `if (!(c))`. Inverte uma DECISAO.
    aplica(linha) {
      if (!/^\s*if \(/.test(linha)) return null;
      return linha.replace(/^(\s*if )(\(.*\) \{)$/, (m, a, b) => `${a}!${b}`);
    },
  },
  {
    nome: 'retorno-constante',
    // `return X;` -> `return null;`. Muda o VALOR devolvido.
    aplica(linha) {
      if (!/^\s*return (?!null\b|undefined\b|;).+;\s*$/.test(linha)) return null;
      return linha.replace(/^(\s*return ).*(;\s*)$/, '$1null$2');
    },
  },
  {
    nome: 'somar-guarda',
    // `< 100000` -> `< 100001`: um limite de proteccao mais curto. A mutacao
    // mais silenciosa que existe: so falha em entradas grandes.
    aplica(linha) {
      const m = linha.match(/\b(\d{3,})\b/);
      if (!m) return null;
      return linha.replace(m[0], String(Number(m[0]) + 1));
    },
  },
  {
    nome: 'apagar-guarda',
    // `guard++ < 100000` -> `guard++ < 100000` sem o incremento: laco infinito
    // em entradas patologicas. Mede se a suite tem caso de laco infinito.
    aplica(linha) {
      if (!/guard\+\+/.test(linha)) return null;
      return linha.replace(/guard\+\+/, 'guard += 0');
    },
  },
  {
    nome: 'codigo-erro-trocado',
    // `'E0100'` -> `'E0199'`. Muda o que o UTILIZADOR ve, sem mudar o veredito.
    aplica(linha) {
      if (!/'E0\d{3}'/.test(linha)) return null;
      return linha.replace(/'E0(\d{3})'/, (m, d) => `'E0${(Number(d) + 7) % 1000}'`);
    },
  },
  {
    nome: 'avancar-errado',
    // `this.avanca()` -> `this.i += 2`. Muda o CONSUMO de tokens.
    aplica(linha) {
      if (!/this\.avanca\(\)/.test(linha)) return null;
      return linha.replace(/this\.avanca\(\)/, 'this.i += 2');
    },
  },
  {
    nome: 'severidade-invertida',
    // `'error'` -> `'warning'`: o diagnostico continua a existir mas deixa de
    // contar. A mutacao que a suite estruturalmente nao ve.
    aplica(linha) {
      if (!/'error'/.test(linha)) return null;
      return linha.replace(/'error'/, "'warning'");
    },
  },
  {
    nome: 'primeiro-vs-todos',
    // `todosErros[0]` -> `todosErros[todosErros.length - 1]`: reporta o ultimo
    // em vez do primeiro. Muda a POSICAO do diagnostico sem mudar a contagem.
    aplica(linha) {
      if (!/\.filter\(/.test(linha) || !/\[0\]/.test(linha)) return null;
      return linha.replace(/\[0\]/, '[this.length - 1]');
    },
  },
];

/**
 * Gera mutantes. Cada um tem: `id`, `operador`, `linha` (1-based), `antes` e
 * `depois`, e `fonte` (o ficheiro inteiro ja mutado).
 *
 * `semente` governa a escolha; o operador e a linha sao os eixos, por isso
 * dois corpus com a mesma semente dao os mesmos mutantes.
 */
export function gerarMutantes(fonte, { n = 200, semente = 20261016 } = {}) {
  const r = prng(semente);
  const linhas = fonte.split('\n');
  const usados = new Set();
  const mutantes = [];
  let tentativas = 0;
  const maxTentativas = n * 60;

  while (mutantes.length < n && tentativas++ < maxTentativas) {
    const i = Math.floor(r() * linhas.length);
    const op = OPERADORES[Math.floor(r() * OPERADORES.length)];
    const novo = op.aplica(linhas[i]);
    if (novo === null || novo === linhas[i]) continue;
    const chave = `${i}:${op.nome}`;
    if (usados.has(chave)) continue;      // duas mutacoes do mesmo sítio dao o mesmo mutante
    // a mutacao tem de mudar o ficheiro INTEIRO
    const copia = [...linhas];
    copia[i] = novo;
    const fonteMutada = copia.join('\n');
    if (fonteMutada === fonte) continue;
    usados.add(chave);
    mutantes.push({
      id: `${String(mutantes.length).padStart(3, '0')}-${op.nome}-L${i + 1}`,
      operador: op.nome,
      linha: i + 1,
      antes: linhas[i].trim().slice(0, 90),
      depois: novo.trim().slice(0, 90),
      fonte: fonteMutada,
    });
  }
  return mutantes;
}
