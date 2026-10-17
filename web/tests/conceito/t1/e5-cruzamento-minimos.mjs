/**
 * tests/conceito/t1/e5-cruzamento-minimos.mjs — quantos clusters sao NOVOS?
 *
 * ---------------------------------------------------------------------------
 * TENTANTA ERRADA, E PORQUE ERRADA
 *
 * A primeira versao cruzou por SUBSEQUENCIA de tokens: o minimo seria "a mesma
 * construcao" da fixture se os tokens do minimo aparecessem, pela mesma
 * ordem, nos tokens da fixture. Deu 20 de 20 "novos", o que eobviously
 * errado: `int int * p ;` E o bug `42-inv-int-com-int` (`int int x ;`).
 *
 * A razao do erro: subsequencia exige que o minimo esteja CONTIDO na fixture.
 * Aqui e o contrario — o minimo tem tokens A MAIS (`*`, `p`). O criterio
 * estava invertido.
 *
 * ---------------------------------------------------------------------------
 * O CRITERIO CERTO
 *
 * A ASSINATURA DA MENSAGEM DO g++, normalizada (nomes e numeros para `X`/`N`).
 *
 *     `int int * p ;`  ->  "two or more data types in declaration of 'p'"
 *     `int int x ;`    ->  "two or more data types in declaration of 'x'"
 *     normalizado: os dois dao  "two or more data types in declaration of 'X'"
 *
 * Duas construcoes que o compilador acusa com a MESMA frase sao a mesma
 * construcao, para efeitos de catalogar. E um teste objetivo: nao depende de
 * eu julgar se "parecem o mesmo bug".
 *
 * AFRONDA ASSUMIDA: mensagens genericas podem agrupar construcoes diferentes.
 * `expected unqualified-id before 'int'` e a maior delas. O numero de "novos"
 * e por isso um MINIMO: se agrupar demais, o numero de novos e MENOR, nunca
 * maior.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { CATALOGO, ROTULO_GRUPO } from './catalogo.mjs';

const RAIZ = new URL('../../../', import.meta.url).pathname;

/** Normaliza uma mensagem do g++ para assinatura. */
export function assinatura(msg) {
  if (msg === null || msg === undefined) return '(g++ aceita)';
  return String(msg)
    .replace(/‘[^’]*’/g, 'X')
    .replace(/'[^']*'/g, 'X')
    .replace(/“[^”]*”/g, 'X')
    .replace(/\b\d+\b/g, 'N')
    .replace(/\s+/g, ' ')
    .trim();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // as assinaturas do catalogo, medidas por `e5-cruzamento.mjs`
  const cruz = JSON.parse(readFileSync(`${RAIZ}reports/conceito/t1-e5-cruzamento.json`, 'utf8'));
  const assinaturasCatalogo = [];
  for (const [grupo, lista] of Object.entries(cruz)) {
    for (const c of lista) {
      if (!c.achou) continue;
      assinaturasCatalogo.push({
        grupo: ROTULO_GRUPO[grupo] ?? grupo,
        nome: c.nome,
        assinatura: assinatura(c.gMsg),
      });
    }
  }

  const min = JSON.parse(readFileSync(`${RAIZ}reports/conceito/t1-e4-minimos.json`, 'utf8'));
  const linhas = [];
  for (const m of min.minimizados) {
    if (m.erro) { linhas.push({ cluster: m.chave, n: m.n, erro: m.erro }); continue; }
    const a = assinatura(m.gMsg);
    const bate = assinaturasCatalogo.filter((c) => c.assinatura === a);
    linhas.push({
      quadrante: m.q, nCasos: m.n, nTokens: m.nTokens, chamadas: m.chamadas,
      minimo: m.fonte.trim(), gMsg: m.gMsg, assinatura: a,
      catalogo: bate.map((c) => `${c.grupo} / ${c.nome}`),
      novo: bate.length === 0,
    });
  }

  const novos = linhas.filter((l) => l.novo);
  console.log('=== T1 E5 — clusters minimizados x catalogo conhecido ===');
  console.log('criterio: assinatura normalizada da mensagem do g++');
  console.log('');
  for (const l of linhas) {
    if (l.erro) { console.log(`  ERRO    ${l.cluster}`); continue; }
    const marca = l.novo ? 'NOVO   ' : 'conhec.';
    console.log(`  ${marca} ${String(l.nCasos).padStart(4)} casos  ${String(l.nTokens).padStart(2)} tok  ${l.minimo.slice(0, 44)}`);
    if (l.novo) console.log(`          msg: ${l.assinatura.slice(0, 70)}`);
    else console.log(`          = ${l.catalogo.join(' | ')}`);
  }

  const totalCasos = linhas.reduce((a, l) => a + (l.nCasos ?? 0), 0);
  const coberto = linhas.filter((l) => !l.novo).reduce((a, l) => a + l.nCasos, 0);
  console.log('');
  console.log(`minimos analisados: ${linhas.length}`);
  console.log(`NOVOS (assinatura sem entrada correspondente): ${novos.length}`);
  console.log(`conhecidos: ${linhas.length - novos.length}`);
  console.log('');
  console.log(`os ${linhas.length} maiores clusters cobrem ${totalCasos} casos`);
  console.log(`os ASSINATURAS ja catalogadas cobrem ${coberto} (${(100 * coberto / totalCasos).toFixed(1)}%)`);
  console.log(`os NOVOS cobrem ${totalCasos - coberto} (${(100 * (totalCasos - coberto) / totalCasos).toFixed(1)}%)`);

  writeFileSync(`${RAIZ}reports/conceito/t1-e5-novos.json`,
    `${JSON.stringify({ clustersAnalisados: linhas.length, novos: novos.length, linhas }, null, 1)}\n`);
  writeFileSync('/tmp/opencode/t1-e5-novos.json',
    readFileSync(`${RAIZ}reports/conceito/t1-e5-novos.json`, 'utf8'));
  console.log('');
  console.log('gravado: reports/conceito/t1-e5-novos.json');
}
