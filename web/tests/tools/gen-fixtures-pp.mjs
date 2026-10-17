#!/usr/bin/env node
/**
 * gen-fixtures-pp.mjs — gera o corpus de testes diferenciais em
 * tests/fixtures/pp/. Cada fixture exercita um aspecto do pré-processador.
 *
 * Uso: node tests/tools/gen-fixtures-pp.mjs
 */
import { writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DESTINO = join(RAIZ, 'tests', 'fixtures', 'pp');

const F = {};

// ---------------------------------------------------------- sem diretivas
F['01-passthrough-simples.cpp'] = 'int x = 1;\n';
F['02-passthrough-multiplas-linhas.cpp'] = 'int a;\nint b;\nfloat c = 1.5f;\n';
F['03-passthrough-vazio.cpp'] = '';
F['04-passthrough-apenas-comentarios.cpp'] = '// nada aqui\n/* nem aqui */\n';

// ---------------------------------------------------------- #define objeto
F['10-define-objeto-simples.cpp'] = '#define N 7\nint x = N;\n';
F['11-define-objeto-sem-valor.cpp'] = '#define FLAG\nint x = 1;\n';
F['12-define-multiplas-vezes.cpp'] = '#define N 7\nint a = N;\nint b = N;\nint c = N;\n';
F['13-define-redefine.cpp'] = '#define N 1\n#define N 2\nint x = N;\n';
F['14-define-texto-longo.cpp'] = '#define NOME "valor"\nconst char* s = NOME;\n';
F['15-define-expressao.cpp'] = '#define SOMA (1 + 2)\nint x = SOMA;\n';
F['16-define-undef.cpp'] = '#define N 7\n#undef N\nint x = N;\n';

// ---------------------------------------------------------- macro função
F['20-macro-funcao-simples.cpp'] = '#define ADD(a, b) ((a) + (b))\nint r = ADD(1, 2);\n';
F['21-macro-funcao-sem-args.cpp'] = '#define ZERO() 0\nint r = ZERO();\n';
F['22-macro-funcao-um-arg.cpp'] = '#define DUPLO(x) ((x) * 2)\nint r = DUPLO(5);\n';
F['23-macro-funcao-tres-args.cpp'] = '#define SOMA3(a, b, c) ((a) + (b) + (c))\nint r = SOMA3(1, 2, 3);\n';
F['24-macro-funcao-aninhada.cpp'] = '#define A 1\n#define B(x) ((x) + A)\nint r = B(2);\n';
F['25-macro-funcao-com-espaco-expande.cpp'] = '#define ADD(a, b) ((a) + (b))\nint r = ADD (1, 2);\n';

// ---------------------------------------------------------- # e ##
F['30-stringify-simples.cpp'] = '#define STR(x) #x\nconst char* s = STR(abc);\n';
F['31-stringify-numero.cpp'] = '#define STR(x) #x\nconst char* s = STR(42);\n';
F['32-stringify-espaco.cpp'] = '#define STR(x) #x\nconst char* s = STR(a b);\n';
F['33-paste-simples.cpp'] = '#define CAT(a, b) a##b\nint CAT(x, y) = 1;\n';
F['34-paste-numeros.cpp'] = '#define CAT(a, b) a##b\nint v = CAT(1, 2);\n';
F['35-paste-tres.cpp'] = '#define C3(a, b, c) a##b##c\nint C3(x, y, z) = 1;\n';

// ---------------------------------------------------------- recursividade
F['40-macro-recursiva.cpp'] = '#define X X\nint x = X;\n';
F['41-macro-indireta-ciclo.cpp'] = '#define A B\n#define B A\nint x = A;\n';
F['42-macro-cadeia-valida.cpp'] = '#define A B\n#define B 7\nint x = A;\n';

// ---------------------------------------------------------- #if
F['50-if-zero.cpp'] = '#if 0\nint nao;\n#endif\nint sim;\n';
F['51-if-um.cpp'] = '#if 1\nint sim;\n#endif\n';
F['52-if-constante.cpp'] = '#if 42\nint sim;\n#endif\n';
F['53-if-aritmetica.cpp'] = '#if (1 + 1) * 3 == 6\nint sim;\n#endif\n';
F['54-if-comparacao.cpp'] = '#if 10 > 3 && 3 < 10\nint sim;\n#endif\n';
F['55-if-negacao.cpp'] = '#if !0\nint sim;\n#endif\n';
F['56-if-shift.cpp'] = '#if (1 << 4) == 16 && (16 >> 2) == 4\nint sim;\n#endif\n';
F['57-if-bitwise.cpp'] = '#if (6 & 3) == 2 && (6 | 3) == 7 && (6 ^ 3) == 5\nint sim;\n#endif\n';
F['58-if-ternario.cpp'] = '#if (1 ? 2 : 3) == 2\nint sim;\n#endif\n';
F['59-if-defined.cpp'] = '#define N\n#if defined(N)\nint sim;\n#endif\n';
F['60-if-defined-falso.cpp'] = '#if defined(AO_EXISTE)\nint nao;\n#endif\nint sim;\n';

// ---------------------------------------------------------- #ifdef/#ifndef
F['70-ifdef-definido.cpp'] = '#define A\n#ifdef A\nint sim;\n#endif\n';
F['71-ifdef-nao-definido.cpp'] = '#ifdef B\nint nao;\n#endif\nint sim;\n';
F['72-ifndef-definido.cpp'] = '#define A\n#ifndef A\nint nao;\n#endif\nint sim;\n';
F['73-ifndef-nao-definido.cpp'] = '#ifndef B\nint sim;\n#endif\n';
F['74-ifdef-multiplos.cpp'] = '#define A\n#define B\n#ifdef A\nint x;\n#endif\n#ifdef B\nint y;\n#endif\n#ifdef C\nint z;\n#endif\n';

// ---------------------------------------------------------- #else/#elif
F['80-else-ramo-falso.cpp'] = '#if 0\nint nao;\n#else\nint sim;\n#endif\n';
F['81-else-ramo-verdadeiro.cpp'] = '#if 1\nint sim;\n#else\nint nao;\n#endif\n';
F['82-elif-primeiro.cpp'] = '#if 0\nint a;\n#elif 1\nint b;\n#else\nint c;\n#endif\n';
F['83-elif-segundo.cpp'] = '#if 0\nint a;\n#elif 0\nint b;\n#elif 1\nint c;\n#else\nint d;\n#endif\n';
F['84-else-final.cpp'] = '#if 0\nint a;\n#elif 0\nint b;\n#else\nint c;\n#endif\n';

// ---------------------------------------------------------- aninhamento
F['90-if-aninhado-simples.cpp'] = '#if 1\n#if 0\nint nao;\n#endif\nint sim;\n#endif\n';
F['91-if-aninhado-inativo.cpp'] = '#if 0\n#if 1\nint nao;\n#endif\nint nao2;\n#endif\nint sim;\n';
F['92-nesting-profundo.cpp'] = '#if 1\n#if 1\n#if 1\nint sim;\n#endif\n#endif\n#endif\n';
F['93-if-em-macro-args.cpp'] = '#define ESCOLHER(a, b) ((a) > (b) ? (a) : (b))\n#if 1\nint r = ESCOLHER(1, 2);\n#endif\n';

// ---------------------------------------------------------- combinados
F['100-definicao-macro-em-if.cpp'] = '#define VALOR 42\n#if VALOR > 40\nint sim;\n#endif\n';
F['101-if-definido-macro-valor.cpp'] = '#define N 5\n#if N == 5\nint sim;\n#endif\n';
F['102-pastel-condicionais-macros.cpp'] = '#define ATIVO\n#define NIVEL 2\n#ifdef ATIVO\n#if NIVEL > 1\nint sim;\n#else\nint nao;\n#endif\n#endif\n';
F['103-guard-macro-numerico.cpp'] = '#define VERSAO 3\n#if VERSAO >= 3\nint novo;\n#endif\n#if VERSAO < 3\nint velho;\n#endif\n';

// ---------------------------------------------------------- pré-definidos
F['110-cplusplus.cpp'] = '#if __cplusplus >= 201103L\nint tem_cpp11;\n#endif\n';
F['111-pixela-js.cpp'] = '#if __PIXELA_JS__\nint rodando_no_navegador;\n#endif\n';

// ---------------------------------------------------------- erros esperados
F['120-endif-orfao.cpp'] = '#endif\nint x;\n';
F['121-if-sem-endif.cpp'] = '#if 1\nint x;\n';
F['122-else-sem-if.cpp'] = '#else\nint x;\n';

// ---------------------------------------------------------- comentários
F['130-comentario-linha.cpp'] = '// comentário\nint x; // outro\n';
F['131-comentario-bloco.cpp'] = '/* bloco\nmultilinha */\nint x;\n';
F['132-comentario-em-macro.cpp'] = '#define N 7 // sete\nint x = N;\n';

// ---------------------------------------------------------- strings/chars
F['140-string-em-macro.cpp'] = '#define S "texto"\nconst char* s = S;\n';
F['141-char-em-codigo.cpp'] = "char c = 'A';\nchar d = '\\n';\n";
F['142-string-com-escape.cpp'] = 'const char* s = "linha1\\nlinha2\\t";\n';

// ---------------------------------------------------------- números
F['150-numeros-variados.cpp'] = 'int a = 42;\nint b = 0x1F;\nint c = 010;\nint d = 0b1010;\ndouble e = 1.5;\ndouble f = 1e3;\nint g = 7u;\nlong h = 7L;\n';

// ---------------------------------------------------------- pragma
F['160-pragma-once.cpp'] = '#pragma once\nint x;\n';
F['161-pragma-desconhecido.cpp'] = '#pragma GCC diagnostic push\nint x;\n';

// ---------------------------------------------------------- ponto e vírgula e operators
F['170-operadores-compostos.cpp'] = 'int x = 1;\nx <<= 2;\nx >>= 1;\nx += 3;\nx -= 1;\nx *= 2;\nx /= 2;\nx %= 3;\n';
F['171-ternario-em-codigo.cpp'] = 'int x = a > b ? a : b;\n';

// -------------------------------------------------------------- escrever

if (existsSync(DESTINO)) {
  for (const f of readdirSync(DESTINO)) rmSync(join(DESTINO, f));
} else {
  mkdirSync(DESTINO, { recursive: true });
}

let n = 0;
for (const [nome, conteudo] of Object.entries(F)) {
  writeFileSync(join(DESTINO, nome), conteudo);
  n++;
}
console.log(`[gen-fixtures-pp] ${n} fixtures escritas em tests/fixtures/pp/`);