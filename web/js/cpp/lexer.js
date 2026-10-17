/**
 * lexer.js — Lexer (tokenizador) para o subconjunto de C++17 suportado.
 *
 * Contrato:
 *   - NUNCA LANÇA. Toda entrada produz { tokens, diagnostics }.
 *   - Caractere inválido vira um token de tipo 'error' e o laço continua.
 *   - String/char/comentário malformados viram diagnóstico apontando o início,
 *     nunca uma exceção.
 *   - Sempre termina com exatamente um token 'eof'.
 *   - Todo token tem loc { line, column, start, end }, 1-based, com `start`
 *     e `end` sendo offsets no texto-fonte.
 *
 * Kinds: ident | keyword | type | number | char | string | operator |
 *        punctuator | header-name | error | eof
 */

import { Diagnostic } from './diagnostics.js';

// --------------------------------------------------------------- tabelas

const KEYWORDS = new Set([
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
]);

const TYPES_BUILTIN = new Set([
  'char', 'signed char', 'unsigned char', 'short', 'unsigned short', 'int',
  'unsigned int', 'long', 'unsigned long', 'long long', 'unsigned long long',
  'float', 'double', 'long double', 'bool', 'wchar_t', 'char8_t', 'char16_t',
  'char32_t', 'void',
  'int8_t', 'int16_t', 'int32_t', 'int64_t',
  'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
  'size_t', 'ptrdiff_t', 'intptr_t', 'uintptr_t', 'nullptr_t',
]);

/** Pontuadores (não são operadores). */
const PUNCTUADORES = new Set([
  '...', ';', ',', '(', ')', '[', ']', '{', '}', ':', '?', '.',
]);

/** Operadores. */
const OPERADORES = new Set([
  '<<=', '>>=', '<=>', '->*', '->', '::', '.*', '++', '--', '<<', '>>',
  '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=',
  '|=', '^=',
  '+', '-', '*', '/', '%', '=', '<', '>', '!', '&', '|', '^', '~',
]);

/**
 * Tabela de casamento por maior comprimento. `->*` e `...` têm 3 caracteres;
 * sem esta ordenação, `->*` seria lido como `->` seguido de `*`.
 */
const SIMBOLOS = [...new Set([...PUNCTUADORES, ...OPERADORES])]
  .sort((a, b) => b.length - a.length);

/** Sufixos de literal inteiro, do mais longo para o mais curto. */
const SUFIXOS_INT = ['llu', 'llU', 'LLu', 'LLU', 'ull', 'ULL', 'uLL', 'Ull',
  'll', 'LL', 'lu', 'lU', 'Lu', 'LU', 'ul', 'uL', 'Ul', 'UL',
  'u', 'U', 'l', 'L'];
const SUFIXOS_FLOAT = ['f', 'F', 'l', 'L'];

/** mapa de escape simples -> caractere */
const ESCAPES_SIMPLES = {
  n: '\n', t: '\t', r: '\r', '0': '\0', a: '\x07', b: '\b', f: '\f',
  v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?',
};

const ehDigito = (c) => c >= '0' && c <= '9';
const ehHex = (c) =>
  (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
const valorHex = (c) =>
  c >= '0' && c <= '9' ? c.charCodeAt(0) - 48
    : (c.toLowerCase().charCodeAt(0) - 87);
const ehAlpha = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const ehAlnum = (c) => ehAlpha(c) || ehDigito(c);

// --------------------------------------------------------------- Token

export class Token {
  constructor(type, value, loc, extra = {}) {
    this.type = type;
    this.value = value;
    this.loc = loc;
    // Campos derivados, usados pelo parser/sema.
    this.literal = extra.literal !== undefined ? extra.literal : value;
    this.isKeyword = type === 'keyword';
    this.isType = type === 'type';
    this.isLiteral = type === 'number' || type === 'char' || type === 'string';
    this.isOperator = type === 'operator';
    this.isPunctuator = type === 'punctuator';
    this.isError = type === 'error';
    // info do literal: tipo inferido e texto original
    this.literalKind = extra.literalKind ?? null;  // 'int' | 'float' | 'char' | 'string'
    this.suffix = extra.suffix ?? '';
    this.text = extra.text ?? String(value);
    // Numeric literal: base (2, 8, 10, 16) e os dígitos crus, para que
    // `literalType` possa recalcular o valor EXATO com BigInt. `value` é um
    // Number e perde precisão acima de 2^53 — insuficiente para decidir
    // entre `long long` e `unsigned long long`.
    this.base = extra.base ?? null;
    this.digits = extra.digits ?? null;
    // Prefixo de literal de char/string: '', 'u8', 'u', 'U', 'L'.
    this.prefix = extra.prefix ?? '';
    this.hasSpaceBefore = !!extra.spaceBefore;
    this.commentsBefore = extra.commentsBefore ?? [];
  }

  toString() {
    return this.type + ':' + this.value + '@' + this.loc.line + ':' + this.loc.column;
  }
}

// --------------------------------------------------------------- Lexer

export class Lexer {
  constructor(source, fileName = 'main.cpp') {
    this.source = source;
    this.fileName = fileName;
    this.reset();
  }

  reset() {
    this.pos = 0;
    this.line = 1;
    this.lineStart = 0; // offset do início da linha corrente
    this.tokens = [];
    this.diagnostics = [];
    this.spaceBefore = false;
    this.commentsBefore = [];
    this.afterInclude = false; // o token anterior era #include
  }

  // -- posições ----------------------------------------------------------

  col() { return this.pos - this.lineStart + 1; }

  /** O caractere corrente é o primeiro não-branco da linha? */
  emInicioDeLinha() {
    for (let k = this.lineStart; k < this.pos; k++) {
      const c = this.source[k];
      if (c !== ' ' && c !== '\t' && c !== '\r' && c !== '\f' && c !== '\v') return false;
    }
    return true;
  }
  loc() { return { line: this.line, column: this.col(), start: this.pos }; }
  locFin(end) { return { line: this.line, column: this.col(), start: this.pos, end }; }

  erro(codigo, mensagem, pos = this.pos, extra = {}) {
    const { line, column } = this.posParaLoc(pos);
    this.diagnostics.push(new Diagnostic(
      'error', codigo, mensagem,
      { file: this.fileName, line, column, ...extra },
    ));
  }

  /**
   * Converte um offset absoluto em {line, column}, contando newlines para trás
   * a partir de `this.line`/`this.lineStart` (contexto do cursor). Utilitário
   * compartilhado por posição de token e posição de diagnóstico.
   */
  posParaLoc(pos) {
    const alvo = Math.max(0, Math.min(pos, this.source.length));
    let p = this.pos;
    let linha = this.line;

    // anda para trás até `alvo`, contando '\n'
    while (p > alvo) {
      p--;
      if (this.source[p] === '\n') linha--;
    }
    // se ainda estamos antes de alvo (pos > this.pos), conta para frente
    if (p < alvo) {
      let k = p;
      while (k < alvo) {
        if (this.source[k] === '\n') linha++;
        k++;
      }
    }
    // coluna = offset - início da linha + 1
    let iniLinha = p;
    while (iniLinha > 0 && this.source[iniLinha - 1] !== '\n') iniLinha--;
    return { line: Math.max(1, linha), column: alvo - iniLinha + 1 };
  }

  // -- emission ----------------------------------------------------------

  emitir(tipo, valor, ini, extra = {}) {
    const loc = { line: ini.line, column: ini.column, start: ini.start, end: this.pos };
    const tk = new Token(tipo, valor, loc, { ...extra, spaceBefore: this.spaceBefore, commentsBefore: this.commentsBefore });
    this.tokens.push(tk);
    this.spaceBefore = false;
    this.commentsBefore = [];
    this.afterInclude = /include|include_next|import/.test(valor ?? '');
    return tk;
  }

  // -- principal ---------------------------------------------------------

  /**
   * @param {{headerNames?: boolean, mode?: 'normal'|'preprocess'}} [opts]
   * @returns {{tokens: Token[], diagnostics: Diagnostic[]}}
   */
  tokenize(opts = {}) {
    this.reset();
    const mode = opts.mode ?? 'normal';
    const headerNames = opts.headerNames ?? (mode === 'preprocess');

    while (this.pos < this.source.length) {
      const c = this.source[this.pos];

      // espaços
      if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') {
        this.pos++;
        this.spaceBefore = true;
        continue;
      }
      if (c === '\n') {
        this.pos++;
        this.line++;
        this.lineStart = this.pos;
        this.spaceBefore = true;
        // uma diretiva só vale na início da linha (permitindo whitespace antes)
        this.atLineStart = this.source.slice(this.lineStart, this.pos).trim() === '';
        continue;
      }

      // comentário
      if (c === '/' && this.source[this.pos + 1] === '/') {
        this.comentarioLinha();
        continue;
      }
      if (c === '/' && this.source[this.pos + 1] === '*') {
        this.comentarioBloco();
        continue;
      }

      // Continuação de linha: barra invertida + newline (fora de
      // comentário/string) é removida ANTES do token ser lido, para que
      // uma macro de várias linhas vire uma única linha lógica.
      if (c === '\\' && this.source[this.pos + 1] === '\n') {
        this.pos += 2;
        this.line++;
        this.lineStart = this.pos;
        this.spaceBefore = true;
        continue;
      }

      // pré-processamento: '#' no início da linha
      if (mode === 'preprocess' && c === '#' && this.emInicioDeLinha()) {
        this.diretiva();
        continue;
      }

      // header-name: <...> logo após #include
      if (headerNames && c === '<' && this.afterInclude) {
        if (this.headerName()) continue;
      }

      // literais
      if (c === '"') { this.stringLiteral(); continue; }
      if ((c === 'u' || c === 'U' || c === 'L') && this.ePrefixoLiteral()) {
        this.stringLiteral();
        continue;
      }
      if (c === "'") { this.charLiteral(); continue; }
      // Prefixo de literal de caractere: u8'a', u'a', U'a', L'a' são UM token.
      // Sem esta regra o prefixo virava um identificador separado, e
      // `L'x'` virava `ident:"L" | char:'x'` — silenciosamente errado.
      if ((c === 'u' || c === 'U' || c === 'L') && this.ePrefixoCharLiteral()) {
        this.charLiteral(this.ePrefixoCharLiteral());
        continue;
      }
      if (c === 'R' && this.source[this.pos + 1] === '"') { this.rawString(); continue; }
      if ((c === 'u' || c === 'U' || c === 'L') && this.source[this.pos + 1] === 'R'
          && this.source[this.pos + 2] === '"') {
        this.rawString(2);
        continue;
      }

      // números
      if (ehDigito(c) || (c === '.' && ehDigito(this.source[this.pos + 1]))) {
        this.numberLiteral();
        continue;
      }

      // identificadores / keywords / tipos
      if (ehAlpha(c)) {
        this.identificador();
        continue;
      }

      // pontuadores e operadores, por maior casamento
      let casou = null;
      for (const s of SIMBOLOS) {
        if (this.source.startsWith(s, this.pos)) { casou = s; break; }
      }
      // No modo preprocess, '#' que NÃO está no início da linha é o operador
      // de stringify (#x) ou de colagem (##) dentro do corpo de um #define.
      if (!casou && c === '#' && mode === 'preprocess') {
        casou = this.source[this.pos + 1] === '#' ? '##' : '#';
      }
      if (casou) {
        const ini = this.loc();
        this.pos += casou.length;
        this.emitir(PUNCTUADORES.has(casou) ? 'punctuator' : 'operator', casou, ini);
        continue;
      }

      // caractere inválido: token de erro + continua (nunca lança)
      const ini = this.loc();
      this.erro('E0100', `Caractere inválido: ${JSON.stringify(c)}`, this.pos);
      this.pos++;
      this.emitir('error', c, ini, { literal: c });
    }

    this.emitir('eof', '', { line: this.line, column: this.col(), start: this.pos });
    return { tokens: this.tokens, diagnostics: this.diagnostics };
  }

  // -- comentários -------------------------------------------------------

  /**
   * Comentário de linha. Uma barra invertida imediatamente antes do newline
   * CONTINUA o comentário na linha seguinte (regra do C). Quando a continuação
   * é usada, o laço retorna com `pos` no primeiro caractere de código.
   */
  comentarioLinha() {
    const ini = this.pos;
    this.pos += 2; // consome //
    let continuado = false;
    while (this.pos < this.source.length) {
      const c = this.source[this.pos];

      if (c === '\n') {
        if (!continuado) break;
        // A linha seguinte também é comentário: pula o newline e continua.
        this.pos++;
        this.line++;
        this.lineStart = this.pos;
        continuado = false;
        continue;
      }

      if (c === '\\') {
        const prox = this.source[this.pos + 1];
        if (prox === '\n') { this.pos += 1; continuado = true; continue; }
        if (prox === '\r' && this.source[this.pos + 2] === '\n') {
          this.pos += 1; continuado = true; continue;
        }
      }
      this.pos++;
    }
    this.commentsBefore.push({ kind: 'line', text: this.source.slice(ini, this.pos) });
    this.spaceBefore = true;
  }

  comentarioBloco() {
    const ini = this.pos;
    const iniLoc = this.loc();
    this.pos += 2;
    let fechado = false;
    while (this.pos < this.source.length) {
      if (this.source[this.pos] === '*' && this.source[this.pos + 1] === '/') {
        this.pos += 2;
        fechado = true;
        break;
      }
      if (this.source[this.pos] === '\n') { this.line++; this.lineStart = this.pos + 1; }
      this.pos++;
    }
    if (!fechado) {
      this.erro('E0100', 'Comentário de bloco não fechado', ini);
    }
    this.commentsBefore.push({ kind: 'block', text: this.source.slice(ini, this.pos), loc: iniLoc });
    this.spaceBefore = true;
  }

  // -- diretivas (modo preprocess) --------------------------------------

  diretiva() {
    const ini = this.loc();
    const iniPos = this.pos;
    this.pos++; // '#'

    const iniNome = this.pos;
    while (this.pos < this.source.length && ehAlnum(this.source[this.pos])) this.pos++;
    const nome = this.source.slice(iniNome, this.pos);

    if (!nome) {
      this.erro('E0100', "'#' sem nome de diretiva", iniPos);
      this.emitir('error', '#', ini);
      return;
    }

    if (nome === 'include' || nome === 'include_next' || nome === 'import') {
      this.emitir('hash', nome, ini);
      // pula espaços até o header-name
      while (this.pos < this.source.length && /[ \t]/.test(this.source[this.pos])) this.pos++;
      const abre = this.source[this.pos];
      if (abre === '<') {
        this.headerName(true);
      } else if (abre === '"') {
        this.headerNameAspas();
      } else {
        // #include MACRO — deixa o macro ser tokenizado normalmente
      }
      return;
    }

    this.emitir('hash', nome, ini);
  }

  /** Lê <...> como header-name. */
  headerName(forcar = false) {
    const iniPos = this.pos;
    const iniLoc = this.loc();
    let k = iniPos + 1;
    while (k < this.source.length && this.source[k] !== '>' && this.source[k] !== '\n') k++;
    if (this.source[k] !== '>') {
      if (!forcar) return false;
      this.erro('E0100', 'Header não terminado (falta >)', iniPos);
      const nome = this.source.slice(iniPos + 1, k);
      this.pos = k;
      this.emitir('error', nome, iniLoc);
      return true;
    }
    const nome = this.source.slice(iniPos + 1, k);
    this.pos = k + 1;
    this.emitir('header-name', nome, iniLoc);
    // O token `header-name` guarda o NOME sem os delimitadores, e `value`
    // perde a informação de que era `<...>`. O pré-processador precisa
    // dela: `<x>` busca nos `includeDirs` (o `-I`), `"x"` não — é a regra
    // que separa as duas buscas (R2a).
    this.tokens[this.tokens.length - 1].isAngle = true;
    return true;
  }

  /** Lê "..." como header-name (usado em #include "x.h"). */
  headerNameAspas() {
    const iniPos = this.pos;
    const iniLoc = this.loc();
    let k = iniPos + 1;
    while (k < this.source.length && this.source[k] !== '"' && this.source[k] !== '\n') k++;
    if (this.source[k] !== '"') {
      this.erro('E0100', 'Header não terminado (falta ")', iniPos);
      this.pos = k;
      this.emitir('error', this.source.slice(iniPos + 1, k), iniLoc);
      return;
    }
    const nome = this.source.slice(iniPos + 1, k);
    this.pos = k + 1;
    this.emitir('header-name', nome, iniLoc);
    // Forma com aspas: `isAngle` false é o PADRÃO, mas fica explícito porque
    // o pré-processador decide a busca com ele (R2a).
    this.tokens[this.tokens.length - 1].isAngle = false;
  }

  // -- literais ----------------------------------------------------------

  ePrefixoLiteral() {
    const p = this.source[this.pos + 1];
    if (p === '"') return true;
    if (p === '8' && this.source[this.pos + 2] === '"') return true; // u8"..."
    return false;
  }

  /**
   * Tamanho do prefixo de literal de caractere em `this.pos`, ou 0.
   * `u8'a'` → 2, `u'a'` → 1, `L'a'` → 1, `U'a'` → 1.
   */
  ePrefixoCharLiteral() {
    const c = this.source[this.pos];
    const p1 = this.source[this.pos + 1];
    if (p1 === "'") return 1;
    if (c === 'u' && p1 === '8' && this.source[this.pos + 2] === "'") return 2;
    return 0;
  }

  /** Prefixo de string não suportado: emite diagnóstico e segue. */
  avisarPrefixoNaoSuportado(inicio) {
    const p = this.source[inicio];
    if (p === 'L' || p === 'U' || p === 'u') {
      this.erro('E0203', `Prefixo de literal '${p}' não suportado`, inicio);
    }
  }

  stringLiteral() {
    const iniPos = this.pos;
    const iniLoc = this.loc();
    let i = this.pos;

    // prefixo opcional
    let prefixo = '';
    if (this.source[i] === 'u' && this.source[i + 1] === '8' && this.source[i + 2] === '"') {
      prefixo = 'u8'; i += 2;
    } else if (this.source[i] === 'L' || this.source[i] === 'U' || this.source[i] === 'u') {
      this.avisarPrefixoNaoSuportado(i);
      prefixo = this.source[i];
      i += 1;
    }

    const abre = this.source[i];
    if (abre !== '"') {
      // não era string: emite como identificador e deixa o laço seguir
      this.identificador();
      return;
    }
    i++;

    let valor = '';
    let fechou = false;
    while (i < this.source.length) {
      const c = this.source[i];
      if (c === '"') { i++; fechou = true; break; }
      if (c === '\n') break; // string não pode跨越 linha
      if (c === '\\') {
        const r = this.lerEscape(i);
        valor += r.valor;
        i = r.proximo;
        if (r.erro) this.erro(r.erro.codigo, r.erro.mensagem, i, {});
        continue;
      }
      valor += c;
      i++;
    }

    if (!fechou) {
      this.erro('E0100', 'Literal de string não terminado', iniPos);
    }
    this.pos = i;
    this.emitir('string', valor, iniLoc, {
      literal: valor, literalKind: 'string', suffix: prefixo, prefix: prefixo,
      text: this.source.slice(iniPos, i),
    });
  }

  /** Lê um escape a partir da barra em `i`. Devolve { valor, proximo, erro? }. */
  lerEscape(i) {
    const barra = i;
    const prox = i + 1;
    if (prox >= this.source.length) {
      return { valor: '', proximo: prox, erro: { codigo: 'E0100', mensagem: 'Escape truncado no fim do arquivo' } };
    }
    const e = this.source[prox];

    if (Object.prototype.hasOwnProperty.call(ESCAPES_SIMPLES, e)) {
      return { valor: ESCAPES_SIMPLES[e], proximo: prox + 1 };
    }

    if (e === 'x') {
      let k = prox + 1, hex = '', code = 0;
      while (k < this.source.length && ehHex(this.source[k]) && hex.length < 2) {
        hex += this.source[k];
        code = code * 16 + valorHex(this.source[k]);
        k++;
      }
      if (hex.length === 0) {
        return { valor: 'x', proximo: prox + 1, erro: { codigo: 'E0203', mensagem: '\\x precisa de ao menos um dígito hexadecimal' } };
      }
      return { valor: String.fromCharCode(code), proximo: k };
    }

    if (e === 'u' || e === 'U') {
      const quantos = e === 'u' ? 4 : 8;
      let k = prox + 1, hex = '';
      while (k < this.source.length && ehHex(this.source[k]) && hex.length < quantos) {
        hex += this.source[k];
        k++;
      }
      if (hex.length !== quantos) {
        return {
          valor: e + hex, proximo: k,
          erro: { codigo: 'E0203', mensagem: `\\${e} precisa de ${quantos} dígitos hexadecimais, recebeu ${hex.length}` },
        };
      }
      const code = parseInt(hex, 16);
      return { valor: String.fromCodePoint(code), proximo: k };
    }

    if (e >= '0' && e <= '7') {
      let k = prox, oct = '', code = 0;
      while (k < this.source.length && this.source[k] >= '0' && this.source[k] <= '7' && oct.length < 3) {
        oct += this.source[k];
        code = code * 8 + (this.source[k].charCodeAt(0) - 48);
        k++;
      }
      return { valor: String.fromCharCode(code), proximo: k };
    }

    // escape desconhecido: mantém o caractere, mas avisa
    return {
      valor: e, proximo: prox + 1,
      erro: { codigo: 'E0203', mensagem: `Sequência de escape desconhecida: \\${e}` },
    };
  }

  charLiteral(pfx = 0) {
    const iniPos = this.pos;
    const iniLoc = this.loc();
    const prefixo = pfx === 2 ? 'u8' : (pfx === 1 ? this.source[iniPos] : '');
    let i = this.pos + pfx + 1; // depois da aspa inicial
    let valor = null;
    let erro = null;

    if (i >= this.source.length || this.source[i] === '\n') {
      this.erro('E0100', 'Literal de caractere não terminado', iniPos);
      this.pos = i;
      this.emitir('error', '', iniLoc, { literal: null });
      return;
    }

    // '' (aspas imediatamente seguida de aspas) é vazio → erro
    if (this.source[i] === "'") {
      this.erro('E0100', 'Literal de caractere vazio', iniPos);
      this.pos = i + 1;
      this.emitir('error', '', iniLoc, { literal: null });
      return;
    }

    if (this.source[i] === '\\') {
      const r = this.lerEscape(i);
      valor = r.valor.codePointAt(0) ?? 0;
      i = r.proximo;
      if (r.erro) erro = r.erro;
    } else {
      valor = this.source[i].codePointAt(0);
      i++;
    }

    if (this.source[i] !== "'") {
      this.erro('E0100',
        `Literal de caractere malformado: esperado \'\' depois do caractere, encontrado ${JSON.stringify(this.source[i] ?? '<fim>')}`,
        iniPos);
    } else {
      i++;
    }

    this.pos = i;
    if (erro) this.erro(erro.codigo, erro.mensagem, iniPos);
    // Um char literal sem prefixo tem tipo `char`, que no modelo wasm32 é
    // COM sinal. `'\xff'` vale -1, não 255. Para literais prefixados o valor
    // é o code point e não há conversão para char.
    let v = valor;
    if (v !== null && prefixo === '' && v > 127) v -= 256;
    this.emitir('char', v, iniLoc, {
      literal: v, literalKind: 'char', prefix: prefixo,
      text: this.source.slice(iniPos, i),
    });
  }

  rawString(pfx = 0) {
    const iniPos = this.pos;
    const iniLoc = this.loc();
    // iniPos aponta no prefixo (R / u8R / LR). A aspa de abertura está em
    // iniPos + pfx + 1; o delimitador vem depois dela.
    let i = iniPos + pfx + 2;
    let delim = '';
    while (i < this.source.length && this.source[i] !== '(' && delim.length < 16) {
      delim += this.source[i];
      i++;
    }
    if (this.source[i] !== '(') {
      this.erro('E0100', 'Raw string sem delimitador antes de (', iniPos);
      this.pos = i;
      this.emitir('error', '', iniLoc);
      return;
    }
    i++; // consome o '(' de abertura
    // fecha = ')' + delimitador + '"'
    const fecha = ')' + delim + '"';
    const fim = this.source.indexOf(fecha, i);
    const corpo = fim === -1 ? this.source.slice(i) : this.source.slice(i, fim);

    // atualiza contadores de linha do corpo
    for (let k = 0; k < corpo.length; k++) {
      if (corpo[k] === '\n') { this.line++; this.lineStart = i + k + 1; }
    }

    if (fim === -1) {
      this.erro('E0100', 'Raw string não terminada', iniPos);
      this.pos = this.source.length;
    } else {
      this.pos = fim + fecha.length;
    }

    this.emitir('string', corpo, iniLoc, {
      literal: corpo, literalKind: 'string', text: this.source.slice(iniPos, this.pos),
    });
  }

  numberLiteral() {
    const iniPos = this.pos;
    const iniLoc = this.loc();
    const s = this.source;
    let i = this.pos;
    let erro = null;

    // ---- base por prefixo
    let base = 10;
    if (s[i] === '0' && (s[i + 1] === 'x' || s[i + 1] === 'X')) base = 16, i += 2;
    else if (s[i] === '0' && (s[i + 1] === 'b' || s[i + 1] === 'B')) base = 2, i += 2;

    // ---- é ponto flutuante? (só na base decimal)
    // `i` ainda aponta para o PRIMEIRO dígito (não para o separador), então a
    // busca por '.'/'e' tem de começar depois dos dígitos inteiros. Fazemos um
    // lookahead sem consumir.
    let ehFloat = false;
    if (base === 10) {
      let k = i;
      while (k < s.length && (ehDigito(s[k]) || s[k] === "'")) k++;
      const temPonto = s[k] === '.' && (ehDigito(s[k + 1]) || k + 1 === s.length
        || s[k + 1] === 'e' || s[k + 1] === 'E');
      const expoente = (s[k] === 'e' || s[k] === 'E')
        && (ehDigito(s[k + 1])
          || ((s[k + 1] === '+' || s[k + 1] === '-') && ehDigito(s[k + 2])));
      ehFloat = temPonto || expoente;
    }

    const digitoOk = base === 16 ? ehHex : base === 2 ? (c) => c === '0' || c === '1' : ehDigito;
    const inicioDigitos = i;

    // ---- parte inteira (com separadores ') ou corpo de float
    let corpo = '';
    while (i < s.length) {
      const c = s[i];
      if (digitoOk(c)) { corpo += c; i++; continue; }
      if (c === "'") {
        const antes = corpo[corpo.length - 1];
        const depois = s[i + 1];
        if (antes && digitoOk(depois)) { i++; continue; }
        erro = { codigo: 'E0100', mensagem: "Separador de dígito ' em posição inválida" };
        i++;
        continue;
      }
      if (ehDigito(c)) {
        erro = {
          codigo: 'E0203',
          mensagem: base === 2 ? `Dígito '${c}' inválido em literal binário`
            : base === 16 ? `Dígito '${c}' inválido em literal hexadecimal`
              : `Dígito '${c}' inesperado`,
        };
        i++;
        continue;
      }
      break;
    }

    // ---- parte fracionária
    if (ehFloat && s[i] === '.') {
      corpo += '.';
      i++;
      while (i < s.length) {
        const c = s[i];
        if (ehDigito(c)) { corpo += c; i++; continue; }
        if (c === "'") {
          const antes = corpo[corpo.length - 1];
          if (antes && ehDigito(s[i + 1])) { i++; continue; }
          erro = { codigo: 'E0100', mensagem: "Separador de dígito ' em posição inválida" };
          i++;
          continue;
        }
        break;
      }
    }

    // ---- expoente
    if (ehFloat && (s[i] === 'e' || s[i] === 'E')) {
      const save = i;
      let t = corpo + 'e';
      i++;
      if (s[i] === '+' || s[i] === '-') { t += s[i]; i++; }
      if (ehDigito(s[i])) {
        while (i < s.length && ehDigito(s[i])) { t += s[i]; i++; }
        corpo = t;
      } else {
        i = save; // o 'e' não pertence ao número
      }
    }

    // ---- ponto flutuante hexadecimal (0x1p3): não suportado
    if (base === 16 && (s[i] === '.' || s[i] === 'p' || s[i] === 'P')) {
      erro = { codigo: 'E0203', mensagem: 'Literal de ponto flutuante hexadecimal não suportado' };
      if (s[i] === '.') { i++; while (i < s.length && (ehHex(s[i]) || s[i] === '.')) i++; }
      if (s[i] === 'p' || s[i] === 'P') {
        i++;
        if (s[i] === '+' || s[i] === '-') i++;
        while (i < s.length && ehDigito(s[i])) i++;
      }
    }

    // ---- base octal implícita (0NNN)
    if (base === 10 && !ehFloat && corpo.length > 1 && corpo[0] === '0') {
      let octal = true;
      for (const d of corpo) {
        if (d === '8' || d === '9') {
          // Em C++ um literal octal não pode conter 8 ou 9.
          erro = { codigo: 'E0203', mensagem: `Dígito '${d}' inválido em literal octal` };
          octal = false;
          break;
        }
      }
      if (octal) base = 8;
    }

    // ---- sufixo
    let sufixo = '';
    for (const suf of (ehFloat ? SUFIXOS_FLOAT : SUFIXOS_INT)) {
      if (s.substr(i, suf.length) === suf) { sufixo = suf; i += suf.length; break; }
    }

    // ---- valor
    let valor;
    if (ehFloat) {
      valor = parseFloat(corpo);
      if (!Number.isFinite(valor)) valor = 0;
    } else if (corpo === '') {
      valor = 0;
      if (inicioDigitos === i) {
        erro = erro ?? {
          codigo: 'E0100',
          mensagem: base === 16 ? 'Literal hexadecimal sem dígitos'
            : base === 2 ? 'Literal binário sem dígitos' : 'Literal numérico sem dígitos',
        };
      }
    } else {
      valor = parseInt(corpo, base);
      if (Number.isNaN(valor)) valor = 0;
    }

    this.pos = i;
    if (erro) this.erro(erro.codigo, erro.mensagem, iniPos);
    this.emitir('number', valor, iniLoc, {
      literal: valor, literalKind: ehFloat ? 'float' : 'int', suffix: sufixo,
      text: s.slice(iniPos, i),
      base: ehFloat ? 10 : base,
      // corpo contém o expoente colado ("1e10"); para inteiro é só o miolo.
      digits: ehFloat ? null : corpo,
    });
  }

  identificador() {
    const iniPos = this.pos;
    const iniLoc = this.loc();
    let i = this.pos;
    while (i < this.source.length && ehAlnum(this.source[i])) i++;
    const nome = this.source.slice(iniPos, i);
    this.pos = i;

    let tipo;
    if (KEYWORDS.has(nome)) tipo = 'keyword';
    else if (TYPES_BUILTIN.has(nome)) tipo = 'type';
    else tipo = 'ident';

    this.emitir(tipo, nome, iniLoc, { text: nome });
  }
}

// ------------------------------------------------------- literalType

/**
 * Modelo de dados padrão do projeto: wasm32.
 * `long` tem 32 bits, igual a `int`; ponteiros também.
 */
export const MODELO_WASM32 = Object.freeze({ longBits: 32 });

/** Modelo de dados x86-64 / LP64, para comparação com o g++ nativo. */
export const MODELO_LP64 = Object.freeze({ longBits: 64 });

const TIPOS_CHAR_PREFIXO = {
  u8: 'char8_t',
  u: 'char16_t',
  U: 'char32_t',
  L: 'wchar_t',
};

/**
 * Tipo de um literal com prefixo `u8`.
 *
 * O prefixo `u8` só produz `char8_t` a partir do C++20. Em C++17 — a
 * linguagem-alvo do projeto — `u8'a'` é `char` e `u8"..."` é `const char[N]`.
 * Verificado com `g++ -std=c++17` e `-std=c++20`
 * (ver reports/H4-u8.log).
 */
function tipoPrefixoU8(std) {
  // C++17 = 201703, C++20 = 202002. Comparar `std >= 2020` estaria errado:
  // 201703 >= 2020 é true e todo caso cairia no C++20.
  return std >= 202002 ? 'char8_t' : 'char';
}

/**
 * Valor EXATO de um literal inteiro, como BigInt.
 *
 * `token.value` é um Number e perde precisão acima de 2^53 — insuficiente
 * para decidir entre `long long` e `unsigned long long`, e insuficiente
 * para comparar `18446744073709551615ull` com o que o g++ imprime.
 *
 * Para literais de ponto flutuante devolve `null`: não há valor exato em
 * BigInte o tipo correto é Number.
 */
export function valorExato(token) {
  if (!token || token.literalKind !== 'int') return null;
  if (token.digits !== null && token.digits !== undefined && token.base) {
    // Dois cuidados:
    //  1. `BigInt("80000000")` vale OITO MILHÕES, não 0x80000000 — o prefixo
    //     da base é obrigatório.
    //  2. `BigInt("0077")` vale 77, NÃO 63: em JavaScript zero à esquerda
    //     NÃO significa octal (difere de C/C++). Por isso o prefixo `0o`,
    //     que é explícito. `digits` já traz o `0` inicial do octal implícito.
    const pfx = token.base === 16 ? '0x' : token.base === 2 ? '0b'
      : token.base === 8 ? '0o' : '';
    try {
      return BigInt(pfx + token.digits);
    } catch {
      /* cai para token.value */
    }
  }
  try {
    return BigInt(token.value);
  } catch {
    return null;
  }
}

/**
 * Tipo que o padrão C++17 dá a um literal.
 *
 * Inteiros — [dcl.type]p1/p3 e a tabela de [lex.cconstr]:
 *   - base 10 começa em `int`; base 0/2/8/16 começa em `int` e o sufixo `u`
 *     promove para `unsigned int` ANTES de qualquer promoção por tamanho;
 *   - a escada para base decimal é int → long → long long;
 *   - a escada para base não decimal é int → unsigned int → long long.
 *     (`long` e `unsigned long` NUNCA aparecem na escada de base 10 sem
 *     sufixo, e `unsigned long` só aparece com sufixo `u`.)
 *
 * Ponto flutuante — [lex.floating]:
 *   sem sufixo → double; `f` → float; `l` → long double.
 *
 * Char — [lex.charset]: sem prefixo → char; `u8`/`u`/`U`/`L` → o
 * tipo de caractere correspondente.
 *
 * String — [lex.string]: sem prefixo é `const char[N+1]`.
 *
 * @param {Token} token
 * @param {{longBits?: number, std?: number}} [opts] modelo de dados e padrão.
 *        O padrão é wasm32 (alvo do projeto) e C++17.
 * @returns {string|null} o nome do tipo, ou null se o token não for literal.
 */
export function literalType(token, opts = MODELO_WASM32) {
  if (!token || !token.literalKind) return null;
  const longBits = opts?.longBits ?? MODELO_WASM32.longBits;
  const std = opts?.std ?? 201703;

  switch (token.literalKind) {
    case 'char':
      if (!token.prefix) return 'char';
      if (token.prefix === 'u8') return tipoPrefixoU8(std);
      return TIPOS_CHAR_PREFIXO[token.prefix];

    case 'string': {
      const base = token.prefix === 'u8' ? tipoPrefixoU8(std)
        : (token.prefix ? TIPOS_CHAR_PREFIXO[token.prefix] : 'char');
      return `const ${base}[${String(token.value).length + 1}]`;
    }

    case 'float':
      if (token.suffix === 'f' || token.suffix === 'F') return 'float';
      if (token.suffix === 'l' || token.suffix === 'L') return 'long double';
      return 'double';

    case 'int':
      break;

    default:
      return null;
  }

  // ---- inteiro
  const sufixo = token.suffix ?? '';
  const temU = /[uU]/.test(sufixo);
  const nL = (sufixo.match(/[lL]/g) || []).length;
  const v = valorExato(token) ?? 0n;
  const MAX_INT = 2147483647n;
  const MAX_UINT = 4294967295n;
  const MAX_LONG = longBits === 32 ? 2147483647n : 9223372036854775807n;
  const MAX_ULONG = longBits === 32 ? 4294967295n : 18446744073709551615n;
  const MAX_LLONG = 9223372036854775807n;

  // Base decimal (sem 0x/0b/0 inicial): a escada nunca passa por unsigned
  // sem sufixo `u`.
  const decimal = token.base === 10 || (token.text && /^[^0]/.test(token.text));

  // ---- sufixos explícitos: o valor tem que CABER no tipo pedido.
  // Se não couber no tipo com o sufixo dado, o padrão manda subir um degrau
  // na escada. Todos os vereditos abaixo foram conferidos com `g++ -m32`
  // (ver reports/H4-vereditos-corpus.log).
  if (nL >= 2) {
    return temU ? 'unsigned long long' : 'long long';
  }
  if (nL === 1) {
    if (temU) return v <= MAX_ULONG ? 'unsigned long' : 'unsigned long long';
    return v <= MAX_LONG ? 'long' : 'long long';
  }
  if (temU) {
    // Escada unsigned: unsigned int → unsigned long → unsigned long long.
    // Em wasm32 `unsigned long` tem 32 bits, então 4294967296u já é
    // `unsigned long long` (confirmado com g++ -m32).
    if (v <= MAX_UINT) return 'unsigned int';
    if (decimal) return v <= MAX_ULONG ? 'unsigned long' : 'unsigned long long';
    return 'unsigned long long';
  }

  // ---- sem sufixo
  if (decimal) {
    if (v <= MAX_INT) return 'int';
    return v <= MAX_LONG ? 'long' : 'long long';
  }
  // base 0/2/8/16
  if (v <= MAX_INT) return 'int';
  if (v <= MAX_UINT) return 'unsigned int';
  return 'long long';
}

export { KEYWORDS, TYPES_BUILTIN, OPERADORES, PUNCTUADORES, SIMBOLOS };
export default Lexer;