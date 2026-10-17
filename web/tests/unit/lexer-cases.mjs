/**
 * tests/unit/lexer-cases.mjs — corpus compartilhado de casos do lexer.
 *
 * Cada caso: { nome, src, esperado, diagnosticos? }
 *   - `esperado` é um array de tokens; cada token pode ser a string 'eof' ou
 *     [tipo, valor]. Só o par [tipo, valor] é comparado; `loc` é conferido à
 *     parte pelo teste de posições.
 *   - `diagnosticos` (opcional) é o número de diagnósticos esperado.
 *
 * O lexer NÃO deve lançar: todo caso é executado dentro de try/catch no
 * lexer.test.js, e um throw conta como falha.
 */

export const KEYWORDS = [
  'alignas', 'alignof', 'asm', 'auto', 'bool', 'break', 'case', 'catch',
  'char', 'char16_t', 'char32_t', 'class', 'concept', 'const', 'consteval',
  'constexpr', 'constinit', 'const_cast', 'continue', 'co_await', 'co_return',
  'co_yield', 'decltype', 'default', 'delete', 'do', 'double', 'dynamic_cast',
  'else', 'enum', 'explicit', 'export', 'extern', 'false', 'float', 'for',
  'friend', 'goto', 'if', 'inline', 'int', 'long', 'mutable', 'namespace',
  'new', 'noexcept', 'nullptr', 'operator', 'private', 'protected', 'public',
  'register', 'reinterpret_cast', 'requires', 'return', 'short', 'signed',
  'sizeof', 'static', 'static_assert', 'static_cast', 'struct', 'switch',
  'template', 'this', 'thread_local', 'throw', 'true', 'try', 'typedef',
  'typeid', 'typename', 'union', 'unsigned', 'using', 'virtual', 'void',
  'volatile', 'wchar_t', 'while',
];

/** Tipos que o lexer classifica como 'type' (não são keywords do C++). */
export const TIPOS_BUILTIN = [
  'char8_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t',
  'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
  'size_t', 'ptrdiff_t', 'intptr_t', 'uintptr_t', 'nullptr_t',
];

// utilidades para escrever o esperado de forma compacta
const t = (tipo, valor) => [tipo, valor];
const eof = 'eof';
const ident = (v) => t('ident', v);
const kw = (v) => t('keyword', v);
const tipo = (v) => t('type', v);
const num = (v) => t('number', v);
const real = (v) => t('number', v);
const str = (v) => t('string', v);
const charlit = (code) => t('char', code);
const op = (v) => t('operator', v);
const punct = (v) => t('punctuator', v);

export const CASOS = [
  // ------------------------------------------------------------------ básicos
  { nome: 'fonte vazia devolve só eof', src: '', esperado: [eof] },
  { nome: 'só espaços', src: '   \t  \n  ', esperado: [eof] },

  // ------------------------------------------------------------- identificadores
  { nome: 'identificador simples', src: 'x', esperado: [ident('x'), eof] },
  { nome: 'identificador com dígitos', src: 'abc123', esperado: [ident('abc123'), eof] },
  { nome: 'identificador começando com _', src: '_privado', esperado: [ident('_privado'), eof] },
  { nome: 'identificador com _ no meio', src: 'a_b_c', esperado: [ident('a_b_c'), eof] },
  { nome: 'dois identificadores', src: 'foo bar', esperado: [ident('foo'), ident('bar'), eof] },
  { nome: 'identificador unicode (não-ASCII) vira diagnóstico', src: 'café', esperado: [ident('caf'), t('error', 'é'), eof], diagnosticos: 1 },

  // ---------------------------------------------------------------- keywords
  ...KEYWORDS.map((k) => ({
    nome: `keyword ${k}`, src: k, esperado: [kw(k), eof],
  })),

  // ------------------------------------------------------------- tipos built-in
  ...TIPOS_BUILTIN.map((k) => ({
    nome: `tipo builtin ${k}`, src: k, esperado: [tipo(k), eof],
  })),

  // ------------------------------------------------------------ inteiros decimais
  { nome: 'inteiro 0', src: '0', esperado: [num(0), eof] },
  { nome: 'inteiro 7', src: '7', esperado: [num(7), eof] },
  { nome: 'inteiro 42', src: '42', esperado: [num(42), eof] },
  { nome: 'inteiro grande', src: '2147483647', esperado: [num(2147483647), eof] },

  // ------------------------------------------------------------ inteiros hexadecimais
  { nome: 'hex 0x0', src: '0x0', esperado: [num(0), eof] },
  { nome: 'hex 0x1F', src: '0x1F', esperado: [num(31), eof] },
  { nome: 'hex minúsculo 0xff', src: '0xff', esperado: [num(255), eof] },
  { nome: 'hex maiúsculo 0XFF', src: '0XFF', esperado: [num(255), eof] },
  { nome: 'hex sem dígitos gera diagnóstico', src: '0x', esperado: [num(0), eof], diagnosticos: 1 },

  // ------------------------------------------------------------ inteiros octais
  { nome: 'octal 0', src: '0', esperado: [num(0), eof] },
  { nome: 'octal 010 = 8', src: '010', esperado: [num(8), eof] },
  { nome: 'octal 077 = 63', src: '077', esperado: [num(63), eof] },

  // ------------------------------------------------------------ inteiros binários
  { nome: 'binário 0b0', src: '0b0', esperado: [num(0), eof] },
  { nome: 'binário 0b1010 = 10', src: '0b1010', esperado: [num(10), eof] },
  { nome: 'binário com dígito inválido gera 1 diagnóstico', src: '0b102', esperado: [num(2), eof], diagnosticos: 1 },

  // ------------------------------------------------------------ separadores de dígito
  { nome: "separador 1'000", src: "1'000", esperado: [num(1000), eof] },
  { nome: "separadores múltiplos 1'000'000", src: "1'000'000", esperado: [num(1000000), eof] },

  // ------------------------------------------------------------ sufixos inteiros
  { nome: 'sufixo u', src: '7u', esperado: [num(7), eof] },
  { nome: 'sufixo U', src: '7U', esperado: [num(7), eof] },
  { nome: 'sufixo l', src: '7l', esperado: [num(7), eof] },
  { nome: 'sufixo L', src: '7L', esperado: [num(7), eof] },
  { nome: 'sufixo ul', src: '7ul', esperado: [num(7), eof] },
  { nome: 'sufixo lu', src: '7lu', esperado: [num(7), eof] },
  { nome: 'sufixo LL', src: '7LL', esperado: [num(7), eof] },
  { nome: 'sufixo ull', src: '7ull', esperado: [num(7), eof] },
  { nome: 'sufixo ULL', src: '7ULL', esperado: [num(7), eof] },
  { nome: 'sufixo ll', src: '7ll', esperado: [num(7), eof] },
  { nome: 'sufixo f (float)', src: '1.5f', esperado: [real(1.5), eof] },
  { nome: 'sufixo F (float)', src: '1.5F', esperado: [real(1.5), eof] },
  { nome: 'sufixo L em ponto flutuante', src: '1.0L', esperado: [real(1), eof] },

  // ------------------------------------------------------------ ponto flutuante
  { nome: 'float 1.5', src: '1.5', esperado: [real(1.5), eof] },
  { nome: 'float com ponto final 1.', src: '1.', esperado: [real(1), eof] },
  { nome: 'float .5', src: '.5', esperado: [real(0.5), eof] },
  { nome: 'float 1e3', src: '1e3', esperado: [real(1000), eof] },
  { nome: 'float 1e-3', src: '1e-3', esperado: [real(0.001), eof] },
  { nome: 'float 1E3', src: '1E3', esperado: [real(1000), eof] },
  { nome: 'float 1.5e+2', src: '1.5e+2', esperado: [real(150), eof] },
  { nome: 'float 1.e3', src: '1.e3', esperado: [real(1000), eof] },
  { nome: 'float 0.0', src: '0.0', esperado: [real(0), eof] },
  { nome: 'hex-float 0x1p3 gera diagnóstico', src: '0x1p3', esperado: [num(1), eof], diagnosticos: 1 },

  // ------------------------------------------------------------ char literals
  { nome: "char 'A'", src: "'A'", esperado: [charlit(65), eof] },
  { nome: "char 'a'", src: "'a'", esperado: [charlit(97), eof] },
  { nome: "char '0'", src: "'0'", esperado: [charlit(48), eof] },
  { nome: "char espaço", src: "' '", esperado: [charlit(32), eof] },
  { nome: "char \\n", src: "'\\n'", esperado: [charlit(10), eof] },
  { nome: "char \\t", src: "'\\t'", esperado: [charlit(9), eof] },
  { nome: "char \\r", src: "'\\r'", esperado: [charlit(13), eof] },
  { nome: "char \\0", src: "'\\0'", esperado: [charlit(0), eof] },
  { nome: "char \\a", src: "'\\a'", esperado: [charlit(7), eof] },
  { nome: "char \\b", src: "'\\b'", esperado: [charlit(8), eof] },
  { nome: "char \\f", src: "'\\f'", esperado: [charlit(12), eof] },
  { nome: "char \\v", src: "'\\v'", esperado: [charlit(11), eof] },
  { nome: "char \\\\", src: "'\\\\'", esperado: [charlit(92), eof] },
  { nome: "char \\'", src: "'\\''", esperado: [charlit(39), eof] },
  { nome: "char \"", src: "'\"'", esperado: [charlit(34), eof] },
  { nome: "char \\x41", src: "'\\x41'", esperado: [charlit(65), eof] },
  { nome: "char \\101 (octal)", src: "'\\101'", esperado: [charlit(65), eof] },
  { nome: "char não terminado gera diagnóstico", src: "'a", esperado: [charlit(97), eof], diagnosticos: 1 },
  { nome: "char vazio gera diagnóstico", src: "''", esperado: [t('error', ''), eof], diagnosticos: 1 },
  { nome: "char com aspas duplas", src: '\'"\'', esperado: [charlit(34), eof] },
  { nome: "char com interrogação", src: "'?'", esperado: [charlit(63), eof] },
  { nome: "char com backslash escapado", src: "'\\\\'", esperado: [charlit(92), eof] },
  { nome: "char com \\0", src: "'\\0'", esperado: [charlit(0), eof] },

  // ------------------------------------------------------------ string literals
  { nome: 'string simples', src: '"abc"', esperado: [str('abc'), eof] },
  { nome: 'string vazia', src: '""', esperado: [str(''), eof] },
  { nome: 'string com espaço', src: '"a b"', esperado: [str('a b'), eof] },
  { nome: 'string com \\n', src: '"a\\nb"', esperado: [str('a\nb'), eof] },
  { nome: 'string com \\t', src: '"a\\tb"', esperado: [str('a\tb'), eof] },
  { nome: 'string com \\\\', src: '"a\\\\b"', esperado: [str('a\\b'), eof] },
  { nome: 'string com \\"', src: '"a\\"b"', esperado: [str('a"b'), eof] },
  { nome: 'string com \\x41', src: '"\\x41"', esperado: [str('A'), eof] },
  { nome: 'string não fechada gera diagnóstico', src: '"abc', esperado: [str('abc'), eof], diagnosticos: 1 },
  { nome: 'raw string R"(...)" preserva a barra invertida', src: 'R"(a\\nb)"', esperado: [str('a\\nb'), eof] },
  { nome: 'raw string fecha no primeiro delimitador', src: 'R"delim(a)delim"b', esperado: [str('a'), ident('b'), eof] },
  { nome: 'raw string vazio', src: 'R"()"', esperado: [str(''), eof] },
  { nome: 'u8"abc" é string normal', src: 'u8"abc"', esperado: [str('abc'), eof] },
  { nome: 'L"..." gera diagnóstico (prefixo não suportado)', src: 'L"abc"', esperado: [str('abc'), eof], diagnosticos: 1 },
  { nome: 'u"..." gera diagnóstico (prefixo não suportado)', src: 'u"abc"', esperado: [str('abc'), eof], diagnosticos: 1 },
  { nome: 'U"..." gera diagnóstico (prefixo não suportado)', src: 'U"abc"', esperado: [str('abc'), eof], diagnosticos: 1 },

  // ------------------------------------------------------------ comentários
  { nome: 'comentário de linha é ignorado', src: 'a // resto', esperado: [ident('a'), eof] },
  { nome: 'comentário de linha sem continuação termina na linha', src: 'a // c1\nb', esperado: [ident('a'), ident('b'), eof] },
  // Continuação de linha: a barra + newline real faz o COMENTÁRIO continuar,
  // então o `b` da linha seguinte também é comentário.
  { nome: 'comentário com \\ + newline real continua o comentário', src: 'a // c1 \\' + '\n' + 'b', esperado: [ident('a'), eof] },
  { nome: 'comentário continuado com código depois de 2 linhas', src: 'a // c1 \\' + '\n' + 'b \\' + '\n' + 'c', esperado: [ident('a'), eof] },
  { nome: 'comentário de bloco é ignorado', src: 'a /* x */ b', esperado: [ident('a'), ident('b'), eof] },
  { nome: 'comentário de bloco multilinha', src: 'a /* x\ny\nz */ b', esperado: [ident('a'), ident('b'), eof] },
  { nome: 'comentário de bloco não fechado gera diagnóstico', src: 'a /* x', esperado: [ident('a'), eof], diagnosticos: 1 },
  { nome: 'só comentário', src: '// nada', esperado: [eof] },

  // ------------------------------------------------------------ pontuadores
  { nome: 'parênteses', src: '()', esperado: [punct('('), punct(')'), eof] },
  { nome: 'chaves', src: '{}', esperado: [punct('{'), punct('}'), eof] },
  { nome: 'colchetes', src: '[]', esperado: [punct('['), punct(']'), eof] },
  { nome: 'ponto e vírgula', src: ';', esperado: [punct(';'), eof] },
  { nome: 'vírgula', src: ',', esperado: [punct(','), eof] },
  { nome: 'dois-pontos', src: '::', esperado: [op('::'), eof] },
  { nome: 'três-pontos é punctuator', src: '...', esperado: [punct('...'), eof] },
  { nome: 'ponto final', src: 'x.', esperado: [ident('x'), punct('.'), eof] },
  { nome: 'seta', src: '->', esperado: [op('->'), eof] },
  { nome: 'seta com estrela', src: '->*', esperado: [op('->*'), eof] },
  { nome: 'ponto-estrela', src: '.*', esperado: [op('.*'), eof] },
  { nome: ' spaceship', src: '<=>', esperado: [op('<=>'), eof] },
  { nome: 'duas vírgulas em sequência', src: ',,', esperado: [punct(','), punct(','), eof] },

  // ------------------------------------------------------------ operadores
  { nome: 'sinal de igual', src: '=', esperado: [op('='), eof] },
  { nome: 'sinal de mais', src: '+', esperado: [op('+'), eof] },
  { nome: 'sinal de menos', src: '-', esperado: [op('-'), eof] },
  { nome: 'asterisco', src: '*', esperado: [op('*'), eof] },
  { nome: 'barra', src: '/', esperado: [op('/'), eof] },
  { nome: 'porcentagem', src: '%', esperado: [op('%'), eof] },
  { nome: 'maior', src: '>', esperado: [op('>'), eof] },
  { nome: 'menor', src: '<', esperado: [op('<'), eof] },
  { nome: 'exclamação', src: '!', esperado: [op('!'), eof] },
  { nome: 'e comercial', src: '&', esperado: [op('&'), eof] },
  { nome: 'pipe', src: '|', esperado: [op('|'), eof] },
  { nome: 'circunflexo', src: '^', esperado: [op('^'), eof] },
  { nome: 'til', src: '~', esperado: [op('~'), eof] },
  { nome: 'interrogação é punctuator', src: '?', esperado: [punct('?'), eof] },
  { nome: 'dois iguais', src: '==', esperado: [op('=='), eof] },
  { nome: 'diferente', src: '!=', esperado: [op('!='), eof] },
  { nome: 'menor ou igual', src: '<=', esperado: [op('<='), eof] },
  { nome: 'maior ou igual', src: '>=', esperado: [op('>='), eof] },
  { nome: 'e lógico', src: '&&', esperado: [op('&&'), eof] },
  { nome: 'ou lógico', src: '||', esperado: [op('||'), eof] },
  { nome: 'mais igual', src: '+=', esperado: [op('+='), eof] },
  { nome: 'menos igual', src: '-=', esperado: [op('-='), eof] },
  { nome: 'asterisco igual', src: '*=', esperado: [op('*='), eof] },
  { nome: 'barra igual', src: '/=', esperado: [op('/='), eof] },
  { nome: 'porcentagem igual', src: '%=', esperado: [op('%='), eof] },
  { nome: 'e comercial igual', src: '&=', esperado: [op('&='), eof] },
  { nome: 'pipe igual', src: '|=', esperado: [op('|='), eof] },
  { nome: 'circunflexo igual', src: '^=', esperado: [op('^='), eof] },
  { nome: 'shift à esquerda', src: '<<', esperado: [op('<<'), eof] },
  { nome: 'shift à direita', src: '>>', esperado: [op('>>'), eof] },
  { nome: 'shift-composto <<=', src: '<<=', esperado: [op('<<='), eof] },
  { nome: 'shift-composto >>=', src: '>>=', esperado: [op('>>='), eof] },
  { nome: 'incremento', src: '++', esperado: [op('++'), eof] },
  { nome: 'decremento', src: '--', esperado: [op('--'), eof] },
  { nome: 'a---b vira -- e -', src: 'a---b', esperado: [ident('a'), op('--'), op('-'), ident('b'), eof] },
  { nome: 'a+++b vira ++ e +', src: 'a+++b', esperado: [ident('a'), op('++'), op('+'), ident('b'), eof] },
  { nome: 'x >>= 1', src: 'x >>= 1', esperado: [ident('x'), op('>>='), num(1), eof] },
  { nome: 'x <<= 1', src: 'x <<= 1', esperado: [ident('x'), op('<<='), num(1), eof] },

  // ------------------------------------------------------------header-name
  { nome: 'include com <...> gera header-name', src: '#include <vector>', esperado: [t('hash', 'include'), t('header-name', 'vector'), eof], modoPreprocess: true },
  { nome: 'include com "..." gera header-name', src: '#include "meu.h"', esperado: [t('hash', 'include'), t('header-name', 'meu.h'), eof], modoPreprocess: true },

  // ------------------------------------------------------------ declarações reais
  {
    nome: 'declaração simples',
    src: 'int x = 5;',
    esperado: [kw('int'), ident('x'), op('='), num(5), punct(';'), eof],
  },
  {
    nome: 'definição de função',
    src: 'int main() { return 0; }',
    esperado: [
      kw('int'), ident('main'), punct('('), punct(')'),
      punct('{'), kw('return'), num(0), punct(';'), punct('}'), eof,
    ],
  },
  {
    nome: 'if/else',
    src: 'if (x) y = 1; else y = 2;',
    esperado: [
      kw('if'), punct('('), ident('x'), punct(')'),
      ident('y'), op('='), num(1), punct(';'),
      kw('else'), ident('y'), op('='), num(2), punct(';'), eof,
    ],
  },
  {
    nome: 'while com corpo',
    src: 'while (i < 10) i = i + 1;',
    esperado: [
      kw('while'), punct('('), ident('i'), op('<'), num(10), punct(')'),
      ident('i'), op('='), ident('i'), op('+'), num(1), punct(';'), eof,
    ],
  },
  {
    nome: 'ponto-e-vírgula duplo vira dois tokens',
    src: 'a;;',
    esperado: [ident('a'), punct(';'), punct(';'), eof],
  },
  {
    nome: 'template com >>',
    src: 'std::vector<int>> v;',
    esperado: [
      ident('std'), op('::'), ident('vector'), op('<'), kw('int'), op('>>'),
      ident('v'), punct(';'), eof,
    ],
  },

  // ------------------------------------------------------------ erros / recuperação
  { nome: 'caractere inválido @ gera token de erro', src: '@', esperado: [t('error', '@'), eof], diagnosticos: 1 },
  { nome: 'caractere inválido $ gera token de erro', src: '$', esperado: [t('error', '$'), eof], diagnosticos: 1 },
  { nome: 'caractere inválido entre identificadores não derruba o resto', src: 'a @ b', esperado: [ident('a'), t('error', '@'), ident('b'), eof], diagnosticos: 1 },
  { nome: 'escape inválido em string gera diagnóstico', src: '"\\q"', esperado: [str('q'), eof], diagnosticos: 1 },
  { nome: 'escape \\u exige 4 hex', src: '"\\u12"', esperado: [str('u12'), eof], diagnosticos: 1 },
  { nome: 'escape \\x sem hex gera diagnóstico', src: '"\\xZZ"', esperado: [str('xZZ'), eof], diagnosticos: 1 },
  { nome: 'crase gera token de erro', src: '`', esperado: [t('error', '`'), eof], diagnosticos: 1 },
  { nome: 'dígito 8 em octal gera diagnóstico', src: '08', esperado: [num(8), eof], diagnosticos: 1 },
  { nome: 'cr em código é ignorado como espaço', src: 'a\rb', esperado: [ident('a'), ident('b'), eof] },

  // ------------------------------------------------------------ recuperação
  {
    nome: 'string malformada não derruba o lexer',
    src: '"unterminated',
    esperado: [str('unterminated'), eof],
    diagnosticos: 1,
  },
];