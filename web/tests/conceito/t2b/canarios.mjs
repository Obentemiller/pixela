/**
 * tests/conceito/t2b/canarios.mjs — E0 do T2b.
 *
 * A ordem diz: "5 validos + 5 invalidos com veredito esperado (g++ e nosso
 * parser) no INICIO e a cada 1000 casos; qualquer divergencia aborta".
 *
 * ------------------------------------------------------------ por que existem
 *
 * O patch do T2b mexe SÓ no `unparse`. Se mexer em mais alguma coisa, o
 * corpus do T2 muda de pop e o "antes x depois" deixa de comparar a mesma
 * coisa. Um canario que detecta isso e umarede de seguranca de 10 pontos que
 * custa milissegundos.
 *
 * Os verditos EXPECTADOS nao sao palpite: foram medidos no `parser.js` de
 * HEAD antes do patch, e o log esta em `reports/conceito/t2b-e0-canarios.log`.
 *
 * O veredito do g++ e uma segunda Expected: se o g++ mudar de veredito, o
 * ORACULO mudou e nenhum resultado do bloco vale.
 *
 * --------------------------------------------------------------- o que aborta
 *
 * Qualquer divergencia. Nao ha "poucas" divergencias: um canario e um
 * indicador binario, e a sua utilidade esta em nao tolerar meio-termo.
 */
import { gppTexto, desparse, limpaTmp } from '../t2/runner.mjs';

/**
 * `nosso`: o que o parser de HEAD faz hoje (medido).
 *   `ok`     = aceita, 0 diagnosticos de erro
 *   `rejeita` = acusa
 */
export const CANARIOS = [
  // ---------------------------------------------------------- 5 VALIDOS
  { id: 'v1-struct', valido: true, src: 'struct S { int x; };\n', gpp: true, nosso: 'ok' },
  { id: 'v2-enum', valido: true, src: 'enum E { A, B };\n', gpp: true, nosso: 'ok' },
  { id: 'v3-template-tipo', valido: true, src: 'template<class T = int> struct S { T x; };\n', gpp: true, nosso: 'ok' },
  { id: 'v4-template-sem-default', valido: true, src: 'template<class T> struct S { T x; };\n', gpp: true, nosso: 'ok' },
  { id: 'v5-template-valor', valido: true, src: 'template<int N = 3> struct S { int a[N]; };\n', gpp: true, nosso: 'ok' },
  // ---------------------------------------------------------- 5 INVALIDOS
  // Quatro destes sao bugs CONHECIDOS do parser (S7(d) / posicao): o parser
  // aceita. E por isso que servem de canario — se um dia passarem a rejeitar,
  // isso e uma MUDANCA que o patch nao pode ter feito.
  { id: 'i1-duplo-tipo', valido: false, src: 'int int x;\n', gpp: false, nosso: 'ok' },
  { id: 'i2-typedef-sem-nome', valido: false, src: 'typedef int;\n', gpp: false, nosso: 'ok' },
  { id: 'i3-enum-sem-corpo', valido: false, src: 'enum E\n', gpp: false, nosso: 'ok' },
  { id: 'i4-extern-sem-tipo', valido: false, src: 'extern;\n', gpp: false, nosso: 'rejeita' },
  { id: 'i5-colchete-em-expr', valido: false, src: 'int x = [1];\n', gpp: false, nosso: 'ok' },
];

/**
 * Corre os canarios contra o `unparse` importado pelo processo.
 *
 * `veredito` e o texto que o `unparse` devolve; compara-se com o esperado
 * pelo round-trip: para um VALIDO o unparse tem de produzir algo que o g++
 * aceita (ou, para o `i5`, o veredito que HEAD produz — o objectivo e
 * detectar MUDANCA, nao corrigir).
 *
 * Aqui a razao de ser mais simples do que parece: o patch so pode mudar o
 * UNPARSE, e o unparse so e observavel pelo texto. Por isso o canario mede
 * duas coisas: (1) o veredito do PARSER, que nao pode mudar; (2) o texto do
 * unparse, que e o que o patch mexe.
 */
export async function correCanarios(opts = {}) {
  const { rotulo = 'canarios', importarUnparse = null } = opts;
  const linhas = [];
  let divergencias = 0;

  for (const c of CANARIOS) {
    // (1) o veredito do PARSER — o patch nao lhe pode tocar
    const d = desparse(c.src, `${c.id}-p`);
    const nossoAtual = d.erros === 0 ? 'ok' : 'rejeita';
    const parserOk = nossoAtual === c.nosso;

    // (2) o veredito do g++ na original — o oraculo nao pode mudar
    const g = await gppTexto(c.src, `${c.id}-g`);
    const gppOk = g.ok === c.gpp;

    // (3) o UNPARSE — aqui e onde o patch actua
    let unparse = null;
    let unparseGpp = null;
    if (importarUnparse && d.ast) {
      unparse = importarUnparse(d.ast);
      const gu = await gppTexto(unparse, `${c.id}-u`);
      unparseGpp = gu.ok;
    }

    if (!parserOk) divergencias++;
    if (!gppOk) divergencias++;
    linhas.push({
      id: c.id, valido: c.valido,
      gppEsperado: c.gpp, gppObtido: g.ok, gppOk,
      parserEsperado: c.nosso, parserObtido: nossoAtual, parserOk,
      unparse, unparseGpp,
    });
  }

  return { rotulo, linhas, divergencias, ok: divergencias === 0 };
}

/** Imprime o resultado e diz se aborta. Devolve `true` se passou. */
export async function exigeCanarios(importarUnparse = null, rotulo = '') {
  const r = await correCanarios({ rotulo, importarUnparse });
  const marca = r.ok ? 'OK' : 'ABORTAR';
  console.log(`  [canarios${rotulo ? ` ${rotulo}` : ''}] ${marca}  (${r.linhas.length} canarios, ${r.divergencias} divergencias)`);
  for (const l of r.linhas) {
    if (!l.gppOk || !l.parserOk) {
      console.log(`      ${l.id}: gpp esperado=${l.gppEsperado} obtido=${l.gppObtido}; parser esperado=${l.parserEsperado} obtido=${l.parserObtido}`);
    }
  }
  return r.ok;
}
