/**
 * tests/unit/preprocessor-cases.mjs — corpus do pré-processador (>= 60 casos).
 *
 * Cada caso: { nome, src, esperado, diagnosticos?, includes? }
 *   - `esperado`: texto de saída esperado, com `\n` normalizado.
 *   - `includes`: mapa header -> conteúdo, para testes de #include.
 *   - `definidos`: macros pré-definidos extras.
 */
export const CASOS = [
  // ---------------------------------------------------------- sem diretiva
  { nome: 'código simples', src: 'int x = 1;', esperado: 'int x = 1;' },
  { nome: 'múltiplas linhas', src: 'int a;\nint b;\nint c;', esperado: 'int a;\nint b;\nint c;' },
  { nome: 'string vazia', src: '', esperado: '' },

  // ---------------------------------------------------------- #define objeto
  { nome: '#define N 7 e uso', src: '#define N 7\nint x = N;', esperado: 'int x = 7;' },
  { nome: '#define N sem valor', src: '#define N\nint x = 1;', esperado: 'int x = 1;' },
  { nome: '#define vazio', src: '#define E\nint x = E;', esperado: 'int x = ;' },
  { nome: '#define com texto', src: '#define TXT hello\nconst char* s = TXT;', esperado: 'const char* s = hello;' },
  { nome: '#define com espaços', src: '#define V   1  2  3\nint v = V;', esperado: 'int v = 1  2  3;' },
  { nome: 'duas defines', src: '#define A 1\n#define B 2\nint x = A + B;', esperado: 'int x = 1 + 2;' },
  { nome: 'redefine', src: '#define A 1\n#define A 2\nint x = A;', esperado: 'int x = 2;' },
  { nome: 'undef', src: '#define A 1\n#undef A\nint x = A;', esperado: 'int x = A;' },
  { nome: 'undef de macro inexistente', src: '#undef NAO_EXISTE\nint x;', esperado: 'int x;' },

  // ---------------------------------------------------------- macro não casa por prefixo
  { nome: 'macro não casa por prefixo', src: '#define N 1\nint NAME = N;', esperado: 'int NAME = 1;' },
  { nome: 'macro dentro de identificador maior', src: '#define X 9\nint Xa = X; int bX = 1;', esperado: 'int Xa = 9; int bX = 1;' },
  { nome: 'macro dentro de string não expande', src: '#define A 1\nconst char* s = "A";', esperado: 'const char* s = "A";' },

  // ---------------------------------------------------------- macro de função
  { nome: 'macro de função simples', src: '#define ADD(a,b) a+b\nint r = ADD(1,2);', esperado: 'int r = 1+2;' },
  // O GCC aceita `ADD (1,2)` como invocação mesmo com espaço (verificado com
// `g++ -E -P`), então o espaço não impede a expansão.
{ nome: 'macro de função expande com espaço antes do parêntese', src: '#define ADD(a,b) ((a)+(b))\nint r = ADD (1,2);', esperado: 'int r = ((1)+(2));' },
  { nome: 'macro de função sem argumentos', src: '#define F() 42\nint r = F();', esperado: 'int r = 42;' },
  { nome: 'macro de função com argumento vazio', src: '#define CAT(a,b) a##b\nint CAT(x,);', esperado: 'int x;' },
  { nome: 'macro de função aninhada', src: '#define A 1\n#define B(x) (x+A)\nint r = B(2);', esperado: 'int r = (2+1);' },
  { nome: 'macro de função com vários tokens', src: '#define MAX(a,b) ((a)>(b)?(a):(b))\nint m = MAX(1,2);', esperado: 'int m = ((1)>(2)?(1):(2));' },

  // ---------------------------------------------------------- # e ##
  { nome: 'stringify #x', src: '#define STR(x) #x\nconst char* s = STR(abc);', esperado: 'const char* s = "abc";' },
  { nome: 'stringify com espaço', src: '#define STR(x) #x\nconst char* s = STR(a b);', esperado: 'const char* s = "a b";' },
  { nome: 'stringify de número', src: '#define STR(x) #x\nconst char* s = STR(42);', esperado: 'const char* s = "42";' },
  { nome: 'paste ##', src: '#define CAT(a,b) a##b\nint CAT(x,y) = 1;', esperado: 'int xy = 1;' },
  { nome: 'paste com número', src: '#define CAT(a,b) a##b\nint v = CAT(1,2);', esperado: 'int v = 12;' },
  { nome: 'paste de 3 símbolos', src: '#define C3(a,b,c) a##b##c\nint C3(x,y,z) = 1;', esperado: 'int xyz = 1;' },

  // ---------------------------------------------------------- recursividade / hide set
  { nome: 'macro recursiva não expande a si mesma', src: '#define X X\nint x = X;', esperado: 'int x = X;' },
  { nome: 'macro indireta não reexpande', src: '#define A B\n#define B A\nint x = A;', esperado: 'int x = A;' },
  { nome: 'expansão reativa com outro macro', src: '#define A B\n#define B 7\nint x = A;', esperado: 'int x = 7;' },

  // ---------------------------------------------------------- condicionais
  { nome: '#if 0 descarta', src: '#if 0\nint nao;\n#endif\nint sim;', esperado: 'int sim;' },
  { nome: '#if 1 mantém', src: '#if 1\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: '#if com constante', src: '#if 42\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: '#ifdef definido', src: '#define A\n#ifdef A\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: '#ifdef não definido', src: '#ifdef B\nint nao;\n#endif', esperado: '' },
  { nome: '#ifndef definido', src: '#define A\n#ifndef A\nint nao;\n#endif', esperado: '' },
  { nome: '#ifndef não definido', src: '#ifndef B\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: '#else ramo falso', src: '#if 0\nint nao;\n#else\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: '#else ramo verdadeiro', src: '#if 1\nint sim;\n#else\nint nao;\n#endif', esperado: 'int sim;' },
  { nome: '#elif tomado', src: '#if 0\nint a;\n#elif 1\nint b;\n#else\nint c;\n#endif', esperado: 'int b;' },
  { nome: '#elif não tomado', src: '#if 0\nint a;\n#elif 0\nint b;\n#else\nint c;\n#endif', esperado: 'int c;' },
  { nome: 'dois #elif', src: '#if 0\nint a;\n#elif 0\nint b;\n#elif 1\nint c;\n#else\nint d;\n#endif', esperado: 'int c;' },
  { nome: '#if aninhado', src: '#if 1\n#if 0\nint nao;\n#endif\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: '#if aninhado inativo', src: '#if 0\n#if 1\nint nao;\n#endif\nint nao2;\n#endif\nint sim;', esperado: 'int sim;' },
  { nome: 'nesting profundo', src: '#if 1\n#if 1\n#if 0\nint nao;\n#endif\nint sim;\n#endif\n#endif', esperado: 'int sim;' },

  // ---------------------------------------------------------- expressões #if
  { nome: 'aritmética +', src: '#if 1+1 == 2\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: 'aritmética !=', src: '#if 1 != 2\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: 'aritmética *', src: '#if 3*4 == 12\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: 'aritmética -', src: '#if 10-4 == 6\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: 'aritmética /', src: '#if 12/4 == 3\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: 'aritmética %', src: '#if 13%4 == 1\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: 'shift <<', src: '#if (1<<4) == 16\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: 'shift >>', src: '#if (16>>2) == 4\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: 'bitwise &', src: '#if (6&3) == 2\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: 'bitwise |', src: '#if (6|3) == 7\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: 'bitwise ^', src: '#if (6^3) == 5\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: 'lógico &&', src: '#if 1 && 1\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: 'lógico ||', src: '#if 0 || 1\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: 'negação !', src: '#if !0\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: 'complemento ~', src: '#if ~0 == -1\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: 'ternário', src: '#if 1 ? 1 : 0\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: 'parênteses', src: '#if (1+1)*(2+2) == 8\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: 'precedência', src: '#if 1 + 2 * 3 == 7\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: 'defined(X) verdadeiro', src: '#define N 5\n#if defined(N)\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: 'defined(X) falso', src: '#if defined(NAO)\nint nao;\n#endif', esperado: '' },
  { nome: 'defined X sem parênteses', src: '#define N\n#if defined N\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: 'macro numérica em #if', src: '#define N 5\n#if N > 3\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: '&& com short-circuit', src: '#define A 0\n#if A && 1/0\nint nao;\n#endif', esperado: '' },
  { nome: '|| com short-circuit', src: '#define A 1\n#if A || 1/0\nint sim;\n#endif', esperado: 'int sim;' },

  // ---------------------------------------------------------- BigInt em #if
  { nome: 'BigInt: 2^62', src: '#if 4611686018427387904 > 0\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: 'BigInt: acima de 2^53 mantém precisão (valores diferem)', src: '#if 9007199254740993 == 9007199254740992\nint nao;\n#endif\nint sim;', esperado: 'int sim;' },
  { nome: 'BigInt: 2^53+1 é maior que 2^53', src: '#if 9007199254740993 > 9007199254740992\nint sim;\n#endif', esperado: 'int sim;' },
  { nome: 'BigInt: multiplicação grande', src: '#if 3037000499 * 3037000499 == 9223372030926249001\nint sim;\n#endif', esperado: 'int sim;' },

  // ---------------------------------------------------------- definidos
  { nome: '__LINE__ na linha 1', src: 'int a = __LINE__;', esperado: 'int a = 1;' },
  { nome: '__LINE__ na linha 3', src: 'int a;\nint b;\nint c = __LINE__;', esperado: 'int a;\nint b;\nint c = 3;' },
  { nome: '__FILE__', src: 'const char* f = __FILE__;', esperado: 'const char* f = "t.cpp";' },
  { nome: '__cplusplus >= 201703L', src: '#if __cplusplus >= 201703L\nint sim;\n#endif', esperado: 'int sim;' },

  // ---------------------------------------------------------- erros
  { nome: '#endif sem #if', src: '#endif\nint x;', esperado: 'int x;', diagnosticos: 1 },
  { nome: '#if sem #endif', src: '#if 1\nint x;', esperado: 'int x;', diagnosticos: 1 },
  { nome: '#else sem #if', src: '#else\nint x;', esperado: 'int x;', diagnosticos: 1 },
  { nome: '#include inexistente', src: '#include <nao_existe.h>\nint x;', esperado: 'int x;', diagnosticos: 1 },
  { nome: '#define malformado', src: '#define\nint x;', esperado: 'int x;', diagnosticos: 1 },
  { nome: '#include com macro sem header', src: '#include MEU_HEADER\nint x;', esperado: 'int x;' },

  // ---------------------------------------------------------- pragma
  { nome: '#pragma once ignorado', src: '#pragma once\nint x;', esperado: 'int x;' },
  // O GCC preserva #pragma desconhecido na saída (verificado com
// `g++ -E -P`), então o pré-processador faz o mesmo.
{ nome: 'pragma desconhecido é preservado', src: '#pragma GCC diagnostic push\nint x;', esperado: '#pragma GCC diagnostic push int x;' },

  // ---------------------------------------------------------- includes
  {
    nome: '#include <a.h> injeta conteúdo',
    src: '#include <a.h>\nint x;',
    includes: { 'a.h': 'int a_declarado();' },
    esperado: 'int a_declarado();\nint x;',
  },
  {
    nome: '#include "b.h" injeta conteúdo',
    src: '#include "b.h"\nint x;',
    includes: { 'b.h': 'int b_declarado();' },
    esperado: 'int b_declarado();\nint x;',
  },
  {
    nome: 'include guarda evita duplicação',
    src: '#include <g.h>\n#include <g.h>\nint x;',
    includes: { 'g.h': '#ifndef G_H\n#define G_H\nint g();\n#endif' },
    esperado: 'int g();\nint x;',
  },
  {
    nome: '#pragma once evita duplicação',
    src: '#include <o.h>\n#include <o.h>\nint x;',
    includes: { 'o.h': '#pragma once\nint o();' },
    esperado: 'int o();\nint x;',
  },
  {
    nome: 'include aninhado',
    src: '#include <outro.h>\nint x;',
    includes: { 'outro.h': '#include <interno.h>', 'interno.h': 'int interno();' },
    esperado: 'int interno();\nint x;',
  },
  {
    nome: 'include circular gera erro',
    src: '#include <c1.h>\nint x;',
    includes: { 'c1.h': '#include <c2.h>', 'c2.h': '#include <c1.h>' },
    // o ciclo é detectado e diagnosticado; o código após o include continua
    esperado: 'int x;',
    diagnosticos: 1,
  },
  {
    nome: 'include dentro de #if 0 não injeta',
    src: '#if 0\n#include <nunca.h>\n#endif\nint x;',
    includes: { 'nunca.h': 'int nunca();' },
    esperado: 'int x;',
  },
  {
    nome: 'include dentro de #if 1 injeta',
    src: '#if 1\n#include <sempre.h>\n#endif\nint x;',
    includes: { 'sempre.h': 'int sempre();' },
    esperado: 'int sempre();\nint x;',
  },

  // ---------------------------------------------------------- pré-definidos custom
  {
    nome: 'macro pré-definido usado',
    src: '#if MEU == 3\nint sim;\n#endif',
    definidos: { MEU: '3' },
    esperado: 'int sim;',
  },
  {
    nome: 'macro pré-definido expandido em código',
    src: 'int x = VALOR;',
    definidos: { VALOR: '99' },
    esperado: 'int x = 99;',
  },
];