/**
 * tests/conceito/t1/corpus-gramatica.mjs — E2(b): gerador gramatical.
 *
 * Produz DECLARACOES a partir de uma gramática, com PRNG semeado. O ponto nao
 * e cobertura de C++ — e cobrir as FORMAS onde o parser tem mais chance de
 * divergir, medidas no P0-2:
 *
 *   - `template<...>` com argumento default (o `default` novo)
 *   - `>` como COMPARACAO dentro de parenteses: `(1>2)`, `template<int N=(3>2)>`
 *   - aninhamento de `<>`: `A<B<C>>`
 *   - `>>` a fechar duas listas
 *   - `(`, `[]` a interagir com o `>` de fechamento
 *
 * REGRA DO VEREDITO: todos os nomes de tipo usados sao DECLARADOS no
 * preambulo. Sem isso o g++ responde `does not name a type`, que e SEMANTICO,
 * e a quadrante "nos rejeitamos / g++ aceita" viraria ruido.
 *
 * REGRA 3: a semente e o numero de casos entram no nome de cada caso, e o
 * corpus sai ordenado. Duas execucoes com a mesma semente dao o mesmo
 * sha256.
 */

/** PRNG mulberry32 — 32 bits de estado, reprodutivel em qualquer node. */
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
 * Preambulo: TODOS os tipos usados pelas regras abaixo. `template<... T1{...}>`
 * nao e C++ valido; sao declaracoes separadas de templates.
 */
export const PREAMBULO = `struct A {}; struct B {}; struct C {};
typedef int I; typedef unsigned U;
template<class T> struct T1 { T x; };
template<class T, int N> struct T2 { T x[N]; };
template<class T, class U> struct T3 { T a; U b; };
using Alias = int;
int g(int); int g(int, int); double g(double);
`;

/** Tipos que o gerador pode usar como PARAMETRO DE TIPO. */
const TIPOS = ['A', 'B', 'C', 'I', 'U', 'Alias', 'T1<int>', 'T2<int,3>', 'T3<int,A>', 'std::vector'];

/** Tipos que o gerador pode usar como PARAMETRO NAO-TIPO (valor). */
const VALORES = ['0', '1', '3', '3+1', '(1>2)', '(3>2)?1:0', '1<<2', 'sizeof(int)'];

/** Expressoes de tipo — o alvo principal: `>` como comparacao e aninhamento. */
const EXPRESSOES_TIPO = [
  'int', 'A', 'Alias', 'T1<int>', 'T2<int,3>', 'T1<T1<int>>', 'T2<int,(3>2)>',
  'T1<A>*', 'T3<int,T1<A>>', 'const A', 'A[4]', 'T1<int>[2]',
];

function escolhe(r, xs) { return xs[Math.floor(r() * xs.length)]; }

function paramTemplate(r) {
  const f = r();
  if (f < 0.25) return `class ${escolhe(r, ['T', 'U', 'V', 'W'])}`;
  if (f < 0.45) return `typename ${escolhe(r, ['T', 'U', 'V', 'W'])}`;
  if (f < 0.60) return `class`;
  if (f < 0.80) return `int ${escolhe(r, ['N', 'M', 'K'])}`;
  if (f < 0.92) return `${escolhe(r, ['unsigned', 'long', 'short'])} ${escolhe(r, ['N', 'M'])}`;
  return `${escolhe(r, ['T', 'V', 'W'])}... ${escolhe(r, ['Args', 'Rest'])}`;
}

function defaultTemplate(r) {
  const f = r();
  if (f < 0.45) return ` = ${escolhe(r, EXPRESSOES_TIPO)}`;
  if (f < 0.85) return ` = ${escolhe(r, VALORES)}`;
  if (f < 0.93) return ` = ${escolhe(r, ['T1<int>', 'T3<int,A>'])}`; // referencia a T anterior
  return ''; // sem default
}

function listaParams(r, min = 1, max = 3) {
  const n = min + Math.floor(r() * (max - min + 1));
  const ps = [];
  for (let k = 0; k < n; k++) ps.push(paramTemplate(r) + defaultTemplate(r));
  return ps.join(', ');
}

/** declarador concreto: `x`, `*p`, `a[3]`, `f(int)`, `f(){}` */
function declarador(r, comInicializador = false) {
  const f = r();
  const nome = escolhe(r, ['x', 'y', 'z', 'p', 'q', 'obj']);
  if (f < 0.18) return nome;
  if (f < 0.34) return `*${nome}`;
  if (f < 0.46) return `${nome}[${Math.floor(r() * 4)}]`;
  if (f < 0.58) return `**${nome}`;
  if (f < 0.70) return `${nome}()`;
  if (f < 0.80) return `${nome}(${escolhe(r, ['int', 'int, int', 'A', 'A*', ''])})`;
  if (f < 0.88) return `${nome}(${escolhe(r, ['int', 'int, int'])}) { return ${escolhe(r, ['0', '1'])}; }`;
  if (f < 0.94) return `&${nome}`;
  return comInicializador ? `${nome} = ${escolhe(r, VALORES)}` : nome;
}

function especificadores(r) {
  const f = r();
  if (f < 0.30) return 'int';
  if (f < 0.45) return `const ${escolhe(r, ['int', 'A', 'I'])}`;
  if (f < 0.58) return `static ${escolhe(r, ['int', 'unsigned', 'double'])}`;
  if (f < 0.70) return `extern ${escolhe(r, ['int', 'A', 'I'])}`;
  if (f < 0.80) return `${escolhe(r, ['A', 'B', 'C'])}`;
  if (f < 0.88) return `struct ${escolhe(r, ['D', 'E'])}`;
  if (f < 0.94) return `auto`;
  return `${escolhe(r, ['int', 'A', 'I'])}*`;
}

/** O CORPO da regra — cada ramo existe por um motivo medido. */
function declaracao(r) {
  const f = r();
  const nome = declarador(r, true);

  // --- template com default: o bug do P0-2 e o seu entorno
  if (f < 0.34) {
    const params = listaParams(r);
    return `template<${params}> struct ${escolhe(r, ['S', 'V', 'W'])} { ${escolhe(r, TIPOS)} ${declarador(r)}; };`;
  }
  // --- template de funcao
  if (f < 0.42) {
    return `template<${listaParams(r)}> ${escolhe(r, ['int', 'void', 'A'])} fn${Math.floor(r() * 9)}(${declarador(r)}) { return ${escolhe(r, VALORES)}; }`;
  }
  // --- template<><> explicito
  if (f < 0.46) {
    return `template<> struct ${escolhe(r, ['S', 'V'])} { int ${declarador(r)}; };`;
  }
  // --- declaracao simples
  if (f < 0.66) return `${especificadores(r)} ${nome};`;
  // --- funcao
  if (f < 0.76) return `${especificadores(r)} fn${Math.floor(r() * 9)}(${escolhe(r, ['int', 'int a', 'int a, int b', 'A v', ''])}) { ${escolhe(r, ['return 0;', 'return 1;', ''])} }`;
  // --- enum
  if (f < 0.82) return `enum ${escolhe(r, ['E', 'F'])} { ${escolhe(r, ['A0', 'B1', 'C2'])} };`;
  // --- enum class, com base
  if (f < 0.86) return `enum class ${escolhe(r, ['G', 'H'])}${r() < 0.5 ? ' : int' : ''} { ${escolhe(r, ['X', 'Y'])} };`;
  // --- struct
  if (f < 0.91) return `struct ${escolhe(r, ['P', 'Q'])} { ${especificadores(r)} ${declarador(r)}; };`;
  // --- typedef
  if (f < 0.94) return `typedef ${escolhe(r, ['int', 'A', 'I', 'T1<int>'])} ${escolhe(r, ['MeuTipo', 'Outro', 'T3'])};`;
  // --- using
  if (f < 0.96) return `using ${escolhe(r, ['Alias1', 'Alias2'])} = ${escolhe(r, EXPRESSOES_TIPO)};`;
  // --- namespace
  if (f < 0.97) return `namespace ${escolhe(r, ['ns1', 'ns2'])} { ${especificadores(r)} ${declarador(r)}; }`;
  // --- template com `>` como comparacao DENTRO de parenteses no default
  if (f < 0.99) return `template<int N = (${Math.floor(r() * 4)}>${Math.floor(r() * 4)})> struct R { int a[N]; };`;
  // --- chamada com init-list
  return `${especificadores(r)} ${declarador(r)} = {${Math.floor(r() * 3)}, ${Math.floor(r() * 3)}};`;
}

/**
 * Gera `n` casos. O preambulo e anexado a todos para que o veredito do g++
 * seja SINTATICO.
 */
export function gerarGramatica(n, semente = 20261016) {
  const r = prng(semente);
  const casos = [];
  for (let i = 0; i < n; i++) {
    const corpo = declaracao(r);
    casos.push({
      nome: `gram__${String(i).padStart(5, '0')}__s${semente}`,
      op: 'gramatica', seed: semente, i,
      fonte: `${PREAMBULO}${corpo}\n`,
      // so para inspecao; nao entra na classificacao
      regra: corpo,
    });
  }
  return casos;
}
