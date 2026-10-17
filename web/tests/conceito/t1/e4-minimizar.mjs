/**
 * tests/conceito/t1/e4-minimizar.mjs — ddmin por tokens, ate <= 8 tokens.
 *
 * Uma divergencia so interessa com um REPRODUTOR MINIMO. `int f(int a) { int
 * b = c * 3; return b; }` com um token trocado nao diz nada; os 6 tokens que
 * bastam para a reproduzir dizem.
 *
 * O ddmin e o classico de Zeller: remove MEADIOS, e se a propriedade
 * sobreviver, aceita a remocao e repete. Mede-se aqui a propriedade
 *
 *     o caso continua no MESMO quadrante de bug
 *
 * e nao "da alguma divergencia" — assim a minimizacao nao pode migrar um
 * caso de ACEITACAO-SILENCIOSA para FALSA-REJEICAO e reportar como se fosse
 * a mesma coisa.
 *
 * Regra 3: ddmin e DETERMINISTA quando a lista de remocoes e sempre a mesma.
 * Aqui a ordem e a do indice do token, e nada depende de `Math.random`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Lexer } from '../../../js/cpp/lexer.js';
import { classificaCaso, ROTULOS } from './e3-classificar.mjs';
import { julgar } from './runner.mjs';

/** Reconstrói o fonte a partir de indices de token. */
function fonteDe(base, indices) {
  const toks = tokensDe(base);
  return toks.filter((_, i) => indices.includes(i)).map((t) => t.value).join(' ') + '\n';
}

let CACHE = null;
function tokensDe(src) {
  if (!CACHE) CACHE = new Map();
  if (CACHE.has(src)) return CACHE.get(src);
  const t = new Lexer(src, 'm.cpp').tokenize().tokens
    .filter((x) => x.type !== 'eof' && x.value !== '');
  CACHE.set(src, t);
  return t;
}

/** Avalia um candidato: qual quadrante ele cai? */
async function avalia(fonte, nome) {
  const r = await julgar(fonte, nome);
  return {
    fonte,
    quadrante: classificaCaso({
      nOk: r.nosso.ok, nErros: r.nosso.nErros,
      gOk: r.gpp.ok, gMsg: r.gpp.msg, gErro1: r.gpp.erro1,
      gTimeout: r.gpp.timeout, nLancou: r.nosso.lancou === true,
    }),
    gMsg: r.gpp.msg,
    nErro1: r.nosso.erro1,
    nErros: r.nosso.nErros,
  };
}

/**
 * ddmin. `alvo` e o quadrante que a minimizacao tem de PRESERVAR.
 * Corta em `n = 2, 4, 8…` como no artigo original; cada corte e testado.
 */
export async function ddmin(fonteInicial, alvo, { limite = 8, maxChamadas = 400 } = {}) {
  let chamadas = 0;
  let atual = await avalia(fonteInicial, `dd0`);
  chamadas++;
  if (atual.quadrante !== alvo) return { erro: 'o caso inicial nao esta no quadrante pedido', ...atual };

  let tokens = tokensDe(fonteInicial).map((_, i) => i);

  for (let n = 2; tokens.length > limite && chamadas < maxChamadas; n *= 2) {
    const pedacos = [];
    const tamanho = Math.ceil(tokens.length / n);
    for (let i = 0; i < tokens.length; i += tamanho) pedacos.push(tokens.slice(i, i + tamanho));
    let reduziu = false;
    for (const pedaco of pedacos) {
      if (chamadas >= maxChamadas) break;
      const resto = tokens.filter((t) => !pedaco.includes(t));
      if (resto.length === 0) continue;
      const cand = await avalia(fonteDe(fonteInicial, resto), `dd${chamadas}`);
      chamadas++;
      if (cand.quadrante === alvo) {
        tokens = resto; atual = cand; reduziu = true; break;
      }
    }
    if (!reduziu) {
      // ultima tentativa: cada token isolado
      for (const t of [...tokens]) {
        if (chamadas >= maxChamadas) break;
        const resto = tokens.filter((x) => x !== t);
        if (resto.length === 0) continue;
        const cand = await avalia(fonteDe(fonteInicial, resto), `dd${chamadas}`);
        chamadas++;
        if (cand.quadrante === alvo) { tokens = resto; atual = cand; reduziu = true; break; }
      }
    }
    if (!reduziu && n > tokens.length) break;
  }
  return { ...atual, nTokens: tokens.length, chamadas };
}

/** Assinatura de um caso: o que o agrupa, e nao o nome do ficheiro. */
export function assinatura(c) {
  const q = c.quadrante;
  const g = (c.gMsg ?? '').replace(/‘[^’]*’/g, 'X').replace(/\b\d+\b/g, 'N');
  return `${q} :: ${g}`;
}

// ------------------------------------------------------------------------ CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const RAIZ = new URL('../../../', import.meta.url).pathname;
  const bruto = JSON.parse(readFileSync(`${RAIZ}reports/conceito/t1-e2-bruto.json`, 'utf8'));
  const fontes = new Map();
  // reconstroi as fontes: o E2 grava o veredito, nao o fonte
  const { gerarMutacoes } = await import('./corpus-mutacao.mjs');
  const { gerarGramatica } = await import('./corpus-gramatica.mjs');
  for (const c of [...gerarMutacoes(), ...gerarGramatica(3000, 20261016)]) fontes.set(c.nome, c.fonte);

  const divergentes = bruto.casos.filter((c) => ROTULOS[classificaCaso(c)]?.bug);
  console.log(`divergencias: ${divergentes.length}`);

  // agrupa por assinatura
  const grupos = new Map();
  for (const c of divergentes) {
    const q = classificaCaso(c);
    const g = (c.gMsg ?? '').replace(/‘[^’]*’/g, 'X').replace(/\b\d+\b/g, 'N');
    const chave = `${q} :: ${g}`;
    if (!grupos.has(chave)) grupos.set(chave, { chave, q, gMsg: c.gMsg, n: 0, exemplo: c.nome });
    grupos.get(chave).n++;
  }
  const ordenados = [...grupos.values()].sort((a, b) => b.n - a.n);
  /** FALSA-REJEICAO nao tem mensagem do g++; a seta do parser identifica-a. */
  const rotuloDoPrimeiro = (g) => {
    const c = divergentes.find((x) => classificaCaso(x) === g.q && (x.gMsg ?? null) === g.gMsg);
    return c?.nErro1 ?? '(desconhecido)';
  };
  console.log(`clusters por assinatura: ${ordenados.length}`);
  console.log('');
  console.log('os 20 maiores clusters:');
  for (const g of ordenados.slice(0, 20)) {
    // FALSA-REJEICAO nao tem `gMsg`: o g++ ACEITA, logo nao ha mensagem. A
    // assinatura dessas e a seta do parser, que o E3 ja extrai.
    const desc = g.gMsg === null ? `(g++ aceita; nosso: ${rotuloDoPrimeiro(g)})` : g.gMsg;
    console.log(`  ${String(g.n).padStart(5)}  ${g.q.padEnd(22)} ${desc.slice(0, 62)}`);
  }

  // minimiza UM representante de cada um dos maiores clusters
  const ALVO = Number(process.env.T1_MIN_CLUSTERS ?? 20);
  console.log('');
  console.log(`minimizando o representante de ${Math.min(ALVO, ordenados.length)} clusters...`);
  const minimizados = [];
  const t0 = Date.now();
  for (const g of ordenados.slice(0, ALVO)) {
    const fonte = fontes.get(g.exemplo);
    if (fonte === undefined) { console.log(`  ${g.chave.slice(0, 40)}: fonte nao reconstruida`); continue; }
    const r = await ddmin(fonte, g.q);
    minimizados.push({ ...g, ...r });
    const marca = r.erro ? 'ERRO' : `${r.nTokens} tok, ${r.chamadas} chamadas`;
    console.log(`  ${String(g.n).padStart(5)} casos -> ${String(marca).padEnd(22)} ${r.fonte.replace(/\n/g, ' ').trim().slice(0, 60)}`);
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('');
  console.log(`minimizacao: ${minimizados.length} clusters em ${dt}s`);

  writeFileSync(`${RAIZ}reports/conceito/t1-e4-minimos.json`,
    `${JSON.stringify({ clusters: ordenados.length, minimizados }, null, 1)}\n`);
  writeFileSync('/tmp/opencode/t1-e4-minimos.json',
    readFileSync(`${RAIZ}reports/conceito/t1-e4-minimos.json`, 'utf8'));
  console.log('gravado: reports/conceito/t1-e4-minimos.json');
}
