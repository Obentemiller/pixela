/**
 * tests/conceito/t1/e3-classificar.mjs — a CLASSIFICACAO, depois do dado.
 *
 * Regra 4: aqui nao se olha para fonte nenhuma, so para o dado CRUD gravado
 * pelo E2. E a separacao entre ESTE passo e o E2 e o que permite conferir
 * `soma por categoria == total`.
 *
 * --------------------------------------------------------------- a distincao
 *
 * O veredito do g++ e ACCEPT ou REJECT. Quando rejeita, a pergunta que
 * decide tudo e: o TOKEN SEQUENCIA nao cabe na gramatica, ou e que os NOMES nao
 * resolvem?
 *
 *   SINTATICO  `expected unqualified-id before ',' token`
 *              A sequencia de tokens nao cabe. O parser DEVE rejeitar.
 *
 *   SEMANTICO  `'T' does not name a type`
 *              A sequencia cabe; a resolucao de nomes falha. O parser DEVE
 *              aceitar — nao tem Sema, e rejeitar aqui seria um bug dele.
 *
 * A consequencia pratica e que These are DIFFERENT from each other in
 * `ACEITACAO-SILENCIOSA`: so conta se o g++ rejeitou por SINTATICO.
 * Contar semantico como divergencia seria acusar o parser de um bug de Sema
 * que ele nao tem.
 *
 * ---------------------------------------------------------- o balde honesto
 *
 * Tudo o que nao se classificar vai para `indeterminado`, com contagem
 * visivel. NUNCA se descarta um caso (regra 4). Se o balde for grande, o
 * relatorio tem de dizer isso — e diz.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * SEMANTICO: a sequencia de tokens cabe, mas nomes/tipos nao resolvem.
 * Padroes tirados de `reports/conceito/t1-e3-padroes-gpp.log` e
 * `reports/conceito/t1-e3-indeterminados.log` (212 padroes distintos).
 *
 * CRITERIO: a mensagem descreve um NOME ou um TIPO que nao resolve.
 */
const SEMANTICO = [
  /does not name a type/,
  /does not name a template type/,
  /was not declared in this scope/,
  /has not been declared/,
  /is not a member of/,
  /is not a member function of/,
  /is not a namespace-name/,
  /has no member named/,
  // o catch-all `/named/` que estava no SINTATICO engoliava isto, que e Sema
  /does not have any field named/,
  /does not have any member named/,
  /cannot convert/,
  /could not convert/,
  /invalid initialization of reference/,
  /invalid type argument of unary/,
  /invalid conversion from/,
  /no default argument for/,
  /redeclared as different kind of entity/,
  /redeclaration of/,
  /^duplicate /,
  /conflicting declaration/,
  /conflicting return type/,
  /explicit specialization of non-template/,
  /use of enum .* without previous declaration/,
  /variable or field .* declared void/,
  /declared reference but not initialized/,
  // `C\+` em vez de `C\+\+` foi um typo MEU que deixava 660 casos de fora.
  /ISO C\+\+ forbids declaration of .* with no type/,
  /declaration does not declare anything/,
  /used but never defined/,
  /undefined reference to/,
  /no matching function for call/,
  /ambiguating new declaration/,
  /template argument \d+ is invalid/,
  /template parameter pack cannot have a default/,
  /non-type template parameters of class type only available/,
  /using template type parameter .* after/,
  /return type .* is incomplete/,
  /has incomplete type/,
  /has initializer but incomplete type/,
  /shadows a parameter/,
  /uninitialized /,
  /unused variable/,
  /unused parameter/,
  /dereferencing .* which is of type/,
  /invalid pure specifier/,
];

/**
 * SINTATICO: a sequencia de tokens nao cabe na gramatica.
 *
 * CRITERIO: a mensagem descreve uma EXPECTATIVA ao nivel do TOKEN — o g++ diz
 * que esperava outra coisa, ou que sobrou/faltou token.
 */
const SINTATICO = [
  /^expected .* before/,
  /^expected .* at end of input/,
  /^expected .* at end of member declaration/,
  /^expected .* after struct definition/,
  /^found .* in nested-name-specifier, expected/,
  /^missing terminating .* character/,
  /^stray /,
  /^two or more data types in declaration of/,
  /^(multiple storage classes|multiple data types) in/,
  /^declaration of .* as non-function/,
  /^declaration of .* has no initializer/,
  /^too many initializers for/,
  /^storage class specified for/,
  /^scalar object .* requires one element/,
  // `class 'S' named 'A' does not name a type` cai aqui pelo `named`, mas a
  // regra de SEMANTICO corre ANTES e ganha pelo `does not name a type`.
  /^(class|struct|union|enum) .* named/,
  /^extraneous .* before/,
  /has a different/,
  /not allowed here/,
  /requires a type/,
  /^a .* initializer can only be used for/,
  /label .* within/,
  /^jump to .* crosses/,
  /statement not within/,
  /^braced-init-list cannot be used/,
  /outside class declaration/,
  /return-statement with no value/,
];

/** Classifica a MENSAGEM do g++. `null` quando nao se sabe. */
export function classificaGpp(msg, ok) {
  if (ok) return 'aceita';
  if (msg === null || msg === undefined) return 'indeterminado';
  const m = String(msg);
  for (const re of SEMANTICO) if (re.test(m)) return 'rejeita-semantico';
  for (const re of SINTATICO) if (re.test(m)) return 'rejeita-sintatico';
  return 'indeterminado';
}

/**
 * Quadrante final. A ordem das regras importa: `indeterminado` PRIMEIRO,
 * porque um caso que nao tem veredito confiavel nao pode ser posto em nenhuma
 * quadrante de bug.
 */
export function classificaCaso(c) {
  // --- guarda de infra: sem veredito do g++, nao ha nada a comparar
  if (c.gTimeout) return 'indeterminado-timeout';
  // O g++ chegou a ler o fonte? (o bug da extensao .cpp)
  if (!c.gOk && c.gErro1 && /linker input file unused/.test(c.gErro1)) return 'indeterminado-gpp-nao-leu';
  // o NOSSO lancou excecao: nao e divergencia de gramatica, e um bug nosso
  if (c.nLancou) return 'indeterminado-excecao-nosso';

  const g = classificaGpp(c.gMsg, c.gOk);
  const nOk = c.nOk;

  if (g === 'indeterminado') return 'indeterminado-padrao-desconhecido';
  // o g++ leu o fonte, nao acusou nada, mas disse que analisou: veredito e ACEITA
  if (g === 'aceita') return nOk ? 'ambos-aceitam' : 'FALSA-REJEICAO';
  if (g === 'rejeita-semantico') {
    // O parser aceitou e so os nomes nao resolvem: concordancia de SINTAXE.
    return nOk ? 'concordancia-sintatica' : 'indeterminado-rejeita-semantico';
  }
  // g === 'rejeita-sintatico'
  return nOk ? 'ACEITACAO-SILENCIOSA' : 'ambos-rejeitam';
}

/** Rotulo legivel, com o peso de bug. */
export const ROTULOS = {
  'ambos-aceitam': { titulo: 'Ambos aceitam', bug: false },
  'concordancia-sintatica': { titulo: 'Aceitamos; g++ so reclama de SEMANTICA', bug: false },
  'ambos-rejeitam': { titulo: 'Ambos rejeitam (g++ por sintaxe)', bug: false },
  'ACEITACAO-SILENCIOSA': { titulo: 'ACEITAMOS; g++ rejeita por SINTATICA', bug: true },
  'FALSA-REJEICAO': { titulo: 'Rejeitamos; g++ aceita', bug: true },
  'indeterminado-timeout': { titulo: 'Indeterminado: timeout do g++', bug: false },
  'indeterminado-gpp-nao-leu': { titulo: 'Indeterminado: g++ nao leu o fonte', bug: false },
  'indeterminado-excecao-nosso': { titulo: 'Indeterminado: o NOSSO lancou excecao', bug: false },
  'indeterminado-padrao-desconhecido': { titulo: 'Indeterminado: padrao de mensagem desconhecido', bug: false },
  'indeterminado-rejeita-semantico': { titulo: 'Indeterminado: rejeitamos o que so falha por semantica', bug: false },
};

export function quadrante(c) { return classificaCaso(c); }

// ------------------------------------------------------------------------ CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const RAIZ = new URL('../../../', import.meta.url).pathname;
  const bruto = JSON.parse(readFileSync(`${RAIZ}reports/conceito/t1-e2-bruto.json`, 'utf8'));

  const conta = new Map();
  const porOperacao = new Map();
  const divergentes = [];

  for (const c of bruto.casos) {
    const q = quadrante(c);
    conta.set(q, (conta.get(q) ?? 0) + 1);
    if (!porOperacao.has(c.op)) porOperacao.set(c.op, new Map());
    const m = porOperacao.get(c.op);
    m.set(q, (m.get(q) ?? 0) + 1);
    if (ROTULOS[q]?.bug) divergentes.push({ ...c, q });
  }

  // ---- REGRA 4: a soma por categoria tem de ser o total. Se nao for, PARA.
  const soma = [...conta.values()].reduce((a, b) => a + b, 0);
  const total = bruto.casos.length;
  if (soma !== total) {
    console.error(`REGRA 4 VIOLADA: soma ${soma} != total ${total}. PARANDO.`);
    process.exit(1);
  }

  // orden estavel: bugs primeiro, pelo tamanho
  const ordem = [...conta].sort((a, b) => {
    const ba = ROTULOS[a[0]]?.bug ? 0 : 1, bb = ROTULOS[b[0]]?.bug ? 0 : 1;
    return ba - bb || b[1] - a[1];
  });

  console.log('=== T1 E3 — quadrantes ===');
  console.log(`total: ${total}   (soma por categoria = ${soma})`);
  console.log('');
  console.log('quadrante                                        n        bug');
  for (const [q, n] of ordem) {
    const r = ROTULOS[q] ?? { titulo: q, bug: false };
    console.log(`  ${r.titulo.padEnd(46)} ${String(n).padStart(6)}   ${r.bug ? 'SIM' : '-'}`);
  }

  const bugs = ordem.filter(([q]) => ROTULOS[q]?.bug).reduce((a, [, n]) => a + n, 0);
  const indet = ordem.filter(([q]) => q.startsWith('indeterminado')).reduce((a, [, n]) => a + n, 0);
  console.log('');
  console.log(`divergencias com bug de parser: ${bugs}  (${(100 * bugs / total).toFixed(2)}%)`);
  console.log(`balde "indeterminado": ${indet}  (${(100 * indet / total).toFixed(2)}%)`);

  console.log('');
  console.log('por operacao do corpus:');
  for (const [op, m] of [...porOperacao].sort()) {
    const linha = [...m].sort((a, b) => b[1] - a[1])
      .map(([q, n]) => `${q}=${n}`).join('  ');
    console.log(`  ${op.padEnd(10)} ${linha}`);
  }

  writeFileSync(`${RAIZ}reports/conceito/t1-e3-quadrantes.json`,
    `${JSON.stringify({
      cabeçalho: bruto.cabecalho,
      contagem: Object.fromEntries(ordem),
      soma, total,
      bugs, indeterminados: indet,
      divergentes: divergentes.map((d) => ({
        nome: d.nome, op: d.op, q: d.q, gMsg: d.gMsg, nErro1: d.nErro1, nErros: d.nErros,
      })),
    }, null, 1)}\n`);
  writeFileSync('/tmp/opencode/t1-e3-quadrantes.json',
    readFileSync(`${RAIZ}reports/conceito/t1-e3-quadrantes.json`, 'utf8'));

  console.log('');
  console.log(`divergencias gravadas: reports/conceito/t1-e3-quadrantes.json (${divergentes.length})`);
}
