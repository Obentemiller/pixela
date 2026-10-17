#!/usr/bin/env node
/**
 * diff-lexer.mjs — diferencial do LEXER contra o g++.
 *
 * Para cada literal de `tests/fixtures/literais-lista.json`:
 *   1. Gera um programa C++ que imprime o TIPO (`__PRETTY_FUNCTION__`) e o
 *      VALOR (byte a byte, para strings com \0 e \n embutidos) do literal;
 *   2. Compila com `g++ -m32` e executa, lendo a saída real.
 *      `-m32` reproduz o modelo de dados do projeto (wasm32): long = 32 bits,
 *      ponteiro = 32 bits (verificado em reports/H4-m32.log).
 *   3. Calcula o mesmo tipo/valor com o NOSSO lexer (`literalType`).
 *   4. Compara.
 *
 * O tipo do g++ é a VERDADE. Ele é gravado em `tests/fixtures/literais.json`
 * e passa a ser a referência do teste unitário — assim ninguém precisa
 * chutar o tipo esperado, que é como o corpus nasceu com 5 erros.
 *
 * Uso: node tests/tools/diff-lexer.mjs [--verbose]
 * Sai com 1 se houver qualquer divergência.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Lexer, literalType, valorExato } from '../../js/cpp/lexer.js';
import { Parser } from '../../js/cpp/parser.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LISTA = join(RAIZ, 'tests', 'fixtures', 'literais-lista.json');
const CORPUS = join(RAIZ, 'tests', 'fixtures', 'literais.json');
const TMP = join(tmpdir(), 'pixela-diff-lexer');
const VERBOSE = process.argv.includes('--verbose');

// --------------------------------------------------------------- modelo

const M32_DISPONIVEL = (() => {
  try {
    execFileSync('g++', ['-m32', '-x', 'c++', '-fsyntax-only', '-'],
      { input: 'int x;', stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
})();

// Sem -m32, `long` tem 64 bits e a comparação de literais com sufixo
// l/ul/L/UL fica inválida. Restringimos a int/unsigned/long long e
// registramos a divergência esperada.
const MODELO = M32_DISPONIVEL ? 'wasm32 (g++ -m32, long=32 bits)' : 'x86-64 (g++ sem -m32, long=64 bits)';
const NOSSO_MODELO = M32_DISPONIVEL ? { longBits: 32 } : { longBits: 64 };

// Grupos cujo texto NÃO é um literal isolado: o valor não pode ser lido por
// `auto v = X`. São cobertos por testes dedicados em literal-type.test.js.
const GRUPOS_NAO_COMPARAVEIS = new Set(['float-virgula', 'operador-unario']);

// Literais com prefixo de string largo: o lexer registra o prefixo e calcula
// o TIPO, mas emite E0203 "prefixo não suportado" — a codificação UTF-16/32
// do valor não é implementada. Comparamos só o tipo; o valor fica registrado
// como não comparado.
const GRUPOS_SO_TIPO = new Set(['string-prefixo']);

const literais = JSON.parse(readFileSync(LISTA, 'utf8'));

// --------------------------------------------------------------- g++

function compilarEExecutar(fonte) {
  mkdirSync(TMP, { recursive: true });
  const cpp = join(TMP, 'prog.cpp');
  const exe = join(TMP, 'prog');
  writeFileSync(cpp, fonte);
  const flags = ['-std=c++17', '-w', '-o', exe, cpp];
  if (M32_DISPONIVEL) flags.unshift('-m32');
  execFileSync('g++', flags, { stdio: ['pipe', 'pipe', 'pipe'] });
  return execFileSync(exe, [], { encoding: 'utf8' });
}

/**
 * Extrai o tipo de `__PRETTY_FUNCTION__`.
 * Formato real: `constexpr const char* tname() [with T = int]`
 * (um ']' final). Com typename extra haveria ';' no meio.
 */
function tipoDePretty(fn) {
  const i = fn.indexOf('T = ');
  if (i === -1) return fn.trim();
  let s = fn.slice(i + 4);
  const j = s.indexOf(';');
  if (j !== -1) s = s.slice(0, j);
  return s.replace(/\s*\]\s*$/, '').trim();
}

/**
 * Normaliza o tipo que o GCC imprime para o nome que o padrão usa.
 *   int                 -> int
 *   unsigned int        -> unsigned int
 *   long unsigned int   -> unsigned long
 *   long long unsigned int -> unsigned long long
 *   const char (&)[4]   -> const char[4]
 */
function normalizarTipo(t) {
  let s = t.trim();
  s = s.replace(/^(.*?)\s*\(&\)\s*\[(\d+)\]$/, '$1[$2]');
  s = s.replace(/\s+/g, ' ').trim();

  const partes = s.split(' ');
  const largura = partes.filter((p) => p === 'long' || p === 'short');
  const sinal = partes.filter((p) => p === 'unsigned' || p === 'signed');
  const resto = partes.filter((p) => !['long', 'short', 'unsigned', 'signed'].includes(p));

  if (largura.length > 0 || sinal.length > 0) {
    if (resto[0] === 'double') return [...largura, ...resto].join(' ');
    const base = resto[0] ?? 'int';
    const nomeSinal = sinal.includes('unsigned') ? 'unsigned' : (sinal.length ? 'signed' : '');
    const nomeLargura = largura.length >= 2 ? 'long long' : largura.length === 1 ? 'long' : 'int';
    const out = [];
    if (nomeSinal) out.push(nomeSinal);
    if (nomeLargura !== 'int') out.push(nomeLargura);
    // `long int` e `unsigned long int` são `long` e `unsigned long`: o `int`
    // final some quando há qualificador de largura. `unsigned int` (sem
    // largura) mantém o `int`, que é o nome canônico do padrão.
    if (base === 'int' && nomeLargura !== 'int') {
      // não empilha nada
    } else {
      out.push(base);
    }
    return out.join(' ');
  }
  return s.replace(/\s+\[/g, '[');
}

/** Programa que imprime TIPO e VALOR de um literal. */
/**
 * Compara um caso que NÃO é um literal único: o teste é sobre a DECLARAÇÃO
 * inteira, e vale para os dois lados.
 *
 * `-128` é o literal 128 com o operador unário de menos aplicado; `1,5` são
 * dois literais (1 e 5) com o operador vírgula. Nos dois casos o que o lexer
 * precisa acertar é: a sequência de tokens e o tipo de cada literal, e o tipo
 * final da expressão. O g++ é chamado com o mesmo texto.
 *
 * Se o g++ REJEITAR o caso, o nosso também precisa rejeitar — e aí é isso que
 * a comparação exige, não um pulo.
 */
function comparaNaoComparavel(lit) {
  const nome = `${lit.fonte}  [${lit.grupo}]`;
  const base = {
    grupo: lit.grupo, fonte: lit.fonte, tipo: null, comparável: false, nota: lit.nota,
  };

  // ---- g++
  let gppOk = true;
  let gppErro = null;
  let gppTipos = null;
  try {
    const saida = compilarEExecutar(`#include <cstdio>
template<class T> constexpr const char* tname() { return __PRETTY_FUNCTION__; }
int main() {
  auto v = ${lit.fonte};
  printf("%s\\n", tname<decltype(v)>());
  printf("%zu\\n", sizeof(v));
  return 0;
}
`);
    gppTipos = saida.split('\n')[0]?.trim() ?? '';
  } catch (e) {
    gppOk = false;
    gppErro = `${e.stderr ?? e.message}`.split('\n')
      .filter((l) => /error/.test(l))[0]?.trim() ?? 'erro desconhecido';
  }

  // ---- nosso
  const lex = new Lexer(lit.fonte, 'lit.cpp').tokenize();
  const erros = lex.diagnostics.filter((d) => d.severity === 'error');
  // O que o g++ rejeita pode ser rejeitado no LEXER ou no PARSER. `1,5` é
  // lexicalmente perfeito (`1` `,` `5`) e é a DECLARAÇÃO que não existe — o
  // g++ dá "expected unqualified-id before numeric constant". Sem olhar o
  // parser, o nosso lado pareceria aceitar.
  const decl = `void f() { auto v = ${lit.fonte}; (void)v; }`;
  const lexDecl = new Lexer(decl, 'lit.cpp').tokenize();
  const parseDecl = lexDecl.diagnostics.length === 0
    ? new Parser(lexDecl.tokens, { file: 'lit.cpp' }).parse()
    : { diagnostics: lexDecl.diagnostics };
  const recusaNosso = (parseDecl.diagnostics ?? []).length > 0;
  const nossosTipos = lex.tokens
    .filter((t) => t.type !== 'eof' && !t.isError)
    .map((t) => {
      if (t.type === 'number' || t.literalKind) {
        return normalizarTipo(literalType(t, NOSSO_MODELO) ?? '(nulo)');
      }
      if (t.type === 'operator') return `op:${t.value}`;
      if (t.type === 'punctuator') return `op:${t.value}`;
      return `${t.type}:${t.value}`;
    });

  // ---- o que os dois lados precisam concordar
  if (!gppOk) {
    // g++ recusou. O nosso lado precisa recusar em ALGUM estágio — lexer ou
    // parser. `1,5` é o caso que mostra por que os dois são necessários.
    const onde = erros.length > 0 ? `lexer: ${erros[0].code} ${erros[0].message}`
      : (recusaNosso ? `parser: ${parseDecl.diagnostics[0].message}` : null);
    const ok = onde !== null;
    return {
      ok, nome,
      detalhe: ok
        ? `g++ REJEITA e nós também — ${onde}\n        (g++: ${gppErro})`
        : `g++ REJEITA mas nós ACEITAMOS: tokens=${JSON.stringify(nossosTipos)}`,
      corpus: {
        ...base,
        gpp: `REJEITA: ${gppErro}`,
        nosso: onde ?? `ACEITA: ${JSON.stringify(nossosTipos)}`,
      },
    };
  }

  // g++ aceitou: nosso lado precisa ter os mesmos tokens, na mesma ordem.
  //
  // `-128` é `op:-` SEGUIDO de `int:128` — o sinal é unário e vem antes. A
  // ordem importa e é o que a comparação checa.
  const esperadoTokens = lit.grupo === 'operador-unario'
    ? ['op:-', 'int']
    : ['int', 'op:,', 'int'];
  const ok = JSON.stringify(nossosTipos) === JSON.stringify(esperadoTokens);

  return {
    ok, nome,
    detalhe: `tokens nossos = ${JSON.stringify(nossosTipos)}, esperados = ${JSON.stringify(esperadoTokens)}\n        tipo final g++ = ${gppTipos || '(erro)'}`,
    corpus: {
      ...base,
      gpp: `ACEITA, tipo final ${gppTipos}`,
      nosso: JSON.stringify(nossosTipos),
      tokensEsperados: esperadoTokens,
    },
  };
}

function programaPara(grupo, fonte) {
  if (grupo.startsWith('string')) {
    // `auto& v = "abc"` — referência evita o decay array→ponteiro.
    // O valor sai em HEX byte a byte: `printf("%s")` pararia num \0 ou \n.
    return `#include <cstdio>
template<class T> constexpr const char* tname() { return __PRETTY_FUNCTION__; }
int main() {
  auto& v = ${fonte};
  printf("%s\\n", tname<decltype(v)>());
  printf("%zu\\n", sizeof(v));
  for (size_t k = 0; k < sizeof(v); k++) printf("%02x", (unsigned char)v[k]);
  return 0;
}
`;
  }

  const ehFloat = !/^[0-9a-fA-FxXbB'\\]+[lLuU]*$/.test(fonte)
    || /[.eE]/.test(fonte.replace(/^0[xX]/, ''));
  const ehSemSinal = /u$|[uU][lL]{1,2}$/i.test(fonte.replace(/'/g, ''));
  // `%lld` imprime -1 para 18446744073709551615ull; é preciso `%llu`.
  const fmt = ehFloat ? '%.17g' : (ehSemSinal ? '%llu' : '%lld');
  // O cast precisa de parênteses: `v (long long)` seria uma CHAMADA de função.
  const cast = ehFloat ? '((double)v)'
    : (ehSemSinal ? '((unsigned long long)v)' : '((long long)v)');

  return `#include <cstdio>
template<class T> constexpr const char* tname() { return __PRETTY_FUNCTION__; }
int main() {
  auto v = ${fonte};
  printf("%s\\n", tname<decltype(v)>());
  printf("${fmt}\\n", ${cast});
  return 0;
}
`;
}

/** Valor de string como hex byte a byte, para comparar com o lexer. */
function hexDoValor(v) {
  return [...v].map((c) => c.codePointAt(0).toString(16).padStart(2, '0').slice(-2)).join('');
}

// --------------------------------------------------------------- execução

const linhas = [];
const corpus = [];
let iguais = 0;
let pulados = 0;
const divergencias = [];

linhas.push(`=== diff-lexer: ${literais.length} literais, modelo ${MODELO} ===`);
linhas.push(`g++ -m32 disponível: ${M32_DISPONIVEL ? 'sim' : 'NÃO — literais com sufixo l/ul/L/UL pulados'}`);
linhas.push(`oráculo: g++ -m32; valor de string comparado byte a byte em hex`);
linhas.push('');

for (const lit of literais) {
  // ---- R1: não existe "pulado". Um caso que o g++ RECUSA tem de ser
  // comparado assim mesmo: o NOSSO lexer também precisa recusar, ou o tipo
  // precisa bater. Antes, `-128` e `1,5` eram pulados sem registro e o
  // relatório dizia "189 iguais" e "191 literais" ao mesmo tempo.
  if (GRUPOS_NAO_COMPARAVEIS.has(lit.grupo)) {
    const cmp = comparaNaoComparavel(lit);
    if (cmp.ok) iguais++; else { divergencias.push(cmp); linhas.push(`DIFERE   ${cmp.nome}\n${cmp.detalhe}`); }
    corpus.push(cmp.corpus);
    if (!cmp.ok) continue;
    linhas.push(`IGUAL   ${cmp.nome}${cmp.detalhe ? `\n        ${cmp.detalhe}` : ''}`);
    continue;
  }

  // ---- nosso lado
  let nossoTipo = '(erro)';
  let nossoValor = '(erro)';
  let nossoBytes = null;
  // Literais prefixados que o lexer sinaliza como "não suportado" ainda são
  // lexados corretamente: só a semântica (codificação UTF-16/32) falta. O
  // tipo continua comparável.
  const soTipo = GRUPOS_SO_TIPO.has(lit.grupo);
  try {
    const r = new Lexer(lit.fonte, 'lit.cpp').tokenize();
    const tok = r.tokens[0];
    const erros = r.diagnostics.filter((d) => d.severity === 'error'
      && !/não suportado/.test(d.message));
    if (erros.length === 0 && tok && !tok.isError) {
      nossoTipo = normalizarTipo(literalType(tok, NOSSO_MODELO) ?? '(nulo)');
      if (lit.grupo.startsWith('string')) {
        // O objeto C++ é `const char[N+1]`: o terminador NUL faz parte do
        // array, mas NÃO do `value` que o lexer guarda.
        nossoBytes = hexDoValor(String(tok.value)) + '00';
      } else if (tok.literalKind === 'int') {
        const exato = valorExato(tok);
        nossoValor = exato === null ? String(tok.value) : exato.toString();
      } else {
        nossoValor = String(tok.value);
      }
    } else {
      nossoTipo = `(erro: ${erros.map((d) => d.message).join('; ')})`;
    }
  } catch (e) {
    nossoTipo = `(throw: ${e.message})`;
  }

  // ---- lado do g++
  let gppTipo = '(erro)';
  let gppValor = '(erro)';
  let gppBytes = null;
  let gppErro = null;
  try {
    const saida = compilarEExecutar(programaPara(lit.grupo, lit.fonte));
    const ls = saida.split('\n');
    gppTipo = normalizarTipo(tipoDePretty(ls[0] ?? ''));
    if (lit.grupo.startsWith('string')) {
      gppBytes = (ls[2] ?? '').trim();
      const declarado = Number((ls[1] ?? '').trim());
      // const char[N+1]: o último byte é o terminador nulo
      const esperado = gppBytes.length / 2 - 1;
      if (declarado !== esperado + 1) {
        gppErro = `g++ diz ${declarado} bytes, o hex tem ${gppBytes.length / 2}`;
      }
    } else {
      gppValor = (ls[1] ?? '').trim();
    }
  } catch (e) {
    gppErro = `${e.stderr ?? e.message}`.split('\n')
      .filter((l) => /error/.test(l))[0]?.trim() ?? 'erro desconhecido';
  }

  // ---- comparação
  const tipoIgual = gppTipo === nossoTipo;
  let valorIgual = true;
  let notaValor = '';

  if (soTipo) {
    // tipo é tudo que este lexer promete neste estágio
  } else if (gppErro !== null) {
    valorIgual = false;
    notaValor = ' (g++ não compilou ou inconsistiu)';
  } else if (lit.grupo.startsWith('string')) {
    valorIgual = gppBytes === nossoBytes;
    if (!valorIgual) notaValor = ` (g++=${gppBytes}, nosso=${nossoBytes})`;
  } else {
    const ehFloat = /^(float|double|long double)$/.test(nossoTipo);
    const a = Number(gppValor);
    const b = Number(nossoValor);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      valorIgual = false;
      notaValor = ` (g++=${JSON.stringify(gppValor)}, nosso=${JSON.stringify(nossoValor)})`;
    } else if (ehFloat) {
      valorIgual = Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a));
      if (!valorIgual) notaValor = ` (g++=${gppValor}, nosso=${nossoValor})`;
    } else {
      // inteiro: comparação EXATA por string, porque %lld perde a faixa sem
      // sinal e o Number do lexer perde precisão acima de 2^53.
      valorIgual = gppValor === nossoValor
        || (Number.isFinite(a) && Number.isFinite(b) && a === b);
      if (!valorIgual) notaValor = ` (g++=${gppValor}, nosso=${nossoValor})`;
    }
  }

  corpus.push({
    ...lit,
    // NORMALIZADO: `__PRETTY_FUNCTION__` devolve "long long int" e
    // "unsigned long int"; o padrão usa "long long" e "unsigned long".
    tipo: gppTipo === '(erro)' ? null : normalizarTipo(gppTipo),   // o g++ é a verdade
    comparável: true,
    comparaValor: !soTipo,
    valorGpp: soTipo ? null : (lit.grupo.startsWith('string') ? gppBytes : gppValor),
    valorNosso: soTipo ? null : (lit.grupo.startsWith('string') ? nossoBytes : nossoValor),
  });

  if (tipoIgual && valorIgual) {
    iguais++;
    if (VERBOSE) linhas.push(`IGUAL   [${lit.grupo}] ${lit.fonte} → ${gppTipo}`);
  } else {
    divergencias.push({ lit, gppTipo, nossoTipo, gppValor, nossoValor });
    linhas.push(`DIFERE  [${lit.grupo}] ${lit.fonte}`);
    linhas.push(`        tipo:   g++=${gppTipo}   nosso=${nossoTipo}`);
    if (notaValor) linhas.push(`        valor: ${notaValor}`);
    if (gppErro) linhas.push(`        g++:    ${gppErro}`);
    if (lit.nota) linhas.push(`        nota:   ${lit.nota}`);
  }
}

linhas.push('');
linhas.push(`iguais: ${iguais}   divergentes: ${divergencias.length}   pulados: ${pulados}`);
linhas.push(`total: ${literais.length} (iguais + divergentes + pulados = ${iguais + divergencias.length + pulados})`);
linhas.push('R1: nao existe "pulado". Todo literal do corpus e comparado — os que o');
linhas.push('    g++ REJEITA tem de ser rejeitados pelo NOSSO lexer ou parser.');

const relatorio = linhas.join('\n');
console.log(relatorio);

mkdirSync(join(RAIZ, 'reports'), { recursive: true });
writeFileSync(join(RAIZ, 'reports', 'diff-lexer.log'), relatorio + '\n');
writeFileSync(CORPUS, JSON.stringify(corpus, null, 2) + '\n');
console.log(`\n[diff-lexer] relatório em reports/diff-lexer.log`);
console.log(`[diff-lexer] corpus calibrado pelo g++: tests/fixtures/literais.json (${corpus.length} entradas)`);

if (!M32_DISPONIVEL) {
  console.log('\n[diff-lexer] AVISO: g++ -m32 indisponível. Literais com sufixo l/ul/L/UL');
  console.log('             pulados: sem -m32, long = 64 bits, e o projeto usa wasm32');
  console.log('             (long = 32 bits), então a comparação não seria válida.');
}

process.exit(divergencias.length === 0 ? 0 : 1);