/**
 * tests/conceito/t2b/e2-minimizar-corrigidos.mjs — minimiza os reprodutores
 * dos casos que o patch do `;` corrigiu (antes UNPARSE-QUEBRA, depois
 * round-trip-inteiro).
 *
 * Usa um ddmin local com o parser ORIGINAL do repo (sem o patch do `;`) e o
 * g++ oracular (com a corrigida extensao .cpp). Preserva o quadrante
 * ACEITACAO-SILENCIOSA (nosso aceita, g++ rejeita): o reprodutor minimo
 * reproduz a falha que o patch corrigiu.
 *
 * Fonte de partida: o texto do unparse depois do patch (disponivel no bruto).
 * Cada minimizado deve caber em <= 8 tokens (critério E2).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gppTexto } from '../t2/runner.mjs';
import { classificaCaso } from '../t1/e3-classificar.mjs';
import { Lexer } from '../../../js/cpp/lexer.js';
import { Parser } from '../../../js/cpp/parser.js';
import { Preprocessor } from '../../../js/cpp/preprocessor.js';

const RAIZ = '/home/vtbentemiller/Documentos/pixela-main/web';

/** Julga um fonte com o parser ORIGINAL do repo (sem o patch do `;`) + g++.
 * O ficheiro e gravado com extensao .cpp para o g++ o ler corretamente. */
async function avalia(fonte, nome) {
  const g = await gppTexto(fonte, `${nome}.cpp`);
  let nOk, nErros, erro1;
  try {
    const pp = new Preprocessor({}).process(fonte, nome);
    const lex = new Lexer(pp.text, nome).tokenize();
    const r = new Parser(lex.tokens, { file: nome }).parse();
    const erros = [...(lex.diagnostics ?? []), ...(r.diagnostics ?? [])].filter((x) => x.severity === 'error');
    nOk = erros.length === 0;
    nErros = erros.length;
    erro1 = erros[0] ? `${erros[0].loc.line}:${erros[0].loc.column} ${erros[0].message}` : null;
  } catch (e) {
    nOk = false;
    nErros = -1;
    erro1 = `EXCEPCAO: ${e.message}`;
  }
  return {
    quadrante: classificaCaso({
      nOk, nErros,
      gOk: g.ok === true, gMsg: g.msg, gErro1: g.erro1,
      gTimeout: g.timeout === true, nLancou: false,
    }),
  };
}

/** ddmin: corta em pedaços de tamanho n, 2, 4, 8... enquanto o quadrante
 * alvo se preserva. Deterministico: ordem dos pedaços e do guarda-chuva sao
 * fixas (indice do token), nunca Math.random. */
async function ddmin(fonteInicial, alvo, { limite = 8, maxChamadas = 400 } = {}) {
  let chamadas = 0;
  let atual = await avalia(fonteInicial, 'dd0');
  chamadas++;
  if (atual.quadrante !== alvo) return { erro: 'o caso inicial nao esta no quadrante pedido', ...atual };

  let tokens = [];
  for (const t of new Lexer(fonteInicial, 'm.cpp').tokenize().tokens) {
    if (t.type !== 'eof' && t.value !== '') tokens.push(t.value);
  }

  for (let n = 2; tokens.length > limite && chamadas < maxChamadas; n *= 2) {
    const pedacos = [];
    const tamanho = Math.ceil(tokens.length / n);
    for (let i = 0; i < tokens.length; i += tamanho) pedacos.push(tokens.slice(i, i + tamanho));
    let reduziu = false;
    for (const pedaco of pedacos) {
      if (chamadas >= maxChamadas) break;
      const resto = tokens.filter((t) => !pedaco.includes(t));
      if (resto.length === 0) continue;
      const cand = await avalia(resto.join(' '), `dd${chamadas}`);
      chamadas++;
      if (cand.quadrante === alvo) { tokens = resto; atual = cand; reduziu = true; break; }
    }
    if (!reduziu) {
      for (const t of [...tokens]) {
        if (chamadas >= maxChamadas) break;
        const resto = tokens.filter((x) => x !== t);
        if (resto.length === 0) continue;
        const cand = await avalia(resto.join(' '), `dd${chamadas}`);
        chamadas++;
        if (cand.quadrante === alvo) { tokens = resto; atual = cand; reduziu = true; break; }
      }
    }
    if (!reduziu && n > tokens.length) break;
  }
  return { ...atual, nTokens: tokens.length, chamadas, fonte: tokens.join(' ') };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const antes = JSON.parse(readFileSync(`${RAIZ}/reports/conceito/t2-e2-bruto.json`, 'utf8'));
  const depois = JSON.parse(readFileSync(`${RAIZ}/reports/conceito/t2b-e2-depois-bruto.json`, 'utf8'));

  const idxA = new Map();
  for (const c of antes.casos) idxA.set(c.nome, c);

  const corrigidos = [];
  for (const c of depois.casos) {
    const a = idxA.get(c.nome);
    if (!a) continue;
    // antes: nosso aceita (parseErros===0), g++ rejeita o unparse (unparseOk===false)
    const qA = a.unparseOk === false && a.parseErros === 0 ? 'ACEITACAO-SILENCIOSA' : 'outro';
    // depois: nosso aceita (parseErros===0) e g++ aceita o unparse (unparseOk===true)
    const qD = c.unparseOk === true && c.parseErros === 0 ? 'round-trip-inteiro' : 'outro';
    if (qA === 'ACEITACAO-SILENCIOSA' && qD === 'round-trip-inteiro') {
      corrigidos.push({ nome: c.nome, pop: c.pop, fonte: a.texto });
    }
  }

  console.log(`casos corrigidos pelo ';': ${corrigidos.length}`);
  const t0 = Date.now();
  const minimizados = [];
  for (const c of corrigidos) {
    const r = await ddmin(c.fonte, 'ACEITACAO-SILENCIOSA', { limite: 8, maxChamadas: 400 });
    minimizados.push({
      nome: c.nome, pop: c.pop, nTokens: r.erro ? null : r.nTokens,
      chamadas: r.chamadas || 0, erro: r.erro, fonte: r.fonte,
    });
    console.log(
      `  ${String(minimizados.length).padStart(2)}/${corrigidos.length} ${c.nome.padEnd(30)} ` +
      (r.erro ? `ERRO: ${r.erro}` : `${r.nTokens} tok, ${r.chamadas || 0} chamadas`) +
      `  ${r.fonte.replace(/\n/g, ' ').trim().slice(0, 60)}`,
    );
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const com8OuMenos = minimizados.filter(m => !m.erro && m.nTokens <= 8).length;

  const saida = {
    corrigidosTotal: corrigidos.length,
    minimizados: minimizados.length,
    com8TokensOuMenos: com8OuMenos,
    segundos: Number(dt),
    minimizadosLista: minimizados,
  };
  writeFileSync(`${RAIZ}/reports/conceito/t2b-e2-minimizados.json`, `${JSON.stringify(saida, null, 1)}\n`);
  console.log('');
  console.log(`minimizados: ${minimizados.length} em ${dt}s`);
  console.log(`com <= 8 tokens: ${com8OuMenos} (E2-reprodutores-8-tokens: ${com8OuMenos >= 1 ? 'PASS' : 'FAIL'})`);
}
