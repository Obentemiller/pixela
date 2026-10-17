/**
 * preprocessor.js — Pré-processador de C++.
 *
 * ARQUITETURA: token-based. A entrada é lexada por lexer.js em modo
 * 'preprocess' (que reconhece '#' e <header-name>), e o pré-processador opera
 * sobre a lista de tokens — nunca sobre texto com regex.
 *
 * O laço principal é RECURSIVO POR RAMO: ao encontrar um #if, o pré-processador
 * localiza o #endif correspondente, processa recursivamente apenas o ramo
 * escolhido e devolve o índice logo depois do #endif. Isso elimina a pilha de
 * condicionais e a aritmética frágil de "saltar N tokens".
 *
 * Capacidades:
 *   - #include <...> e "..." contra arquivos virtuais/real, com detecção de
 *     ciclo, include guard e #pragma once
 *   - #define objeto e função, com # (stringify) e ## (paste)
 *   - hide set: macro não reexpande a si mesma
 *   - #if/#ifdef/#ifndef/#elif/#else/#endif com avaliador em BigInt
 *   - #undef, #line, #error, #warning, #pragma
 *   - __LINE__, __FILE__, __COUNTER__, __cplusplus, __PIXELA_JS__
 *
 * NUNCA LANÇA: erros viram diagnósticos.
 */

import { Lexer } from './lexer.js';
import { Diagnostic, ErrorCodes } from './diagnostics.js';

// --------------------------------------------------------------- headers virtuais padrão

const DEFAULT_HEADERS = {
  'pixela.h': `// Header virtual pixela.h — API mínima para o compilador C++ → JS.
int pix_width();
int pix_height();
double pix_time();
void pix_clear();
void pix_present();
void pix_set(int x, int y, bool on, int r, int g, int b);
void pix_line(int x0, int y0, int x1, int y1, int r, int g, int b);
void pix_rect(int x, int y, int w, int h, bool filled, int r, int g, int b);
void pix_circle(int cx, int cy, int radius, bool filled, int r, int g, int b);
void pix_triangle(int x0, int y0, int x1, int y1, int x2, int y2, int r, int g, int b);`,

  // Headers da biblioteca padrão e de sistema.
  //
  // P10: antes eram VAZIOS (placeholder). A TypeNameScope (P6) só reconhece
  // nome de tipo que foi declarado, e um header vazio não declara nada —
  // então `std::vector<uint8_t> on_;` e `size_t` deixavam de parsear.
  //
  // Agora cada header declara os NOMES, em forma de C++ mínimo. Não é a
  // implementação da biblioteca (isso é a stdlib da Fase 3); é a
  // DECLARAÇÃO que a TypeNameScope precisa ler. Os nomes que o prelúdio
  // declara passam a ser reconhecidos porque o pré-processador cola este
  // texto antes do parse, e o parser registra cada `using`/`struct` que vê.
  'vector': 'namespace std { template<class T, class A> struct vector { vector(); vector(size_t n); void push_back(const T& v); T& operator[](size_t i); size_t size() const; void resize(size_t n); void reserve(size_t n); bool empty() const; }; }',
  'string': 'namespace std { struct string { string(); string(const char* s); size_t size() const; const char* c_str() const; void reserve(size_t n); string& operator+=(const char* s); string& operator+=(const string& s); }; }',
  'cstdint': 'typedef signed char int8_t; typedef unsigned char uint8_t; typedef short int16_t; typedef unsigned short uint16_t; typedef int int32_t; typedef unsigned int uint32_t; typedef long long int64_t; typedef unsigned long long uint64_t; typedef long intptr_t; typedef unsigned long uintptr_t;',
  'stdint.h': 'typedef signed char int8_t; typedef unsigned char uint8_t; typedef short int16_t; typedef unsigned short uint16_t; typedef int int32_t; typedef unsigned int uint32_t; typedef long long int64_t; typedef unsigned long long uint64_t;',
  'stddef.h': 'typedef unsigned long size_t; typedef long ptrdiff_t;',
  'cstddef': 'typedef unsigned long size_t; typedef long ptrdiff_t;',
  'cmath': 'namespace std { double abs(double); double sqrt(double); double pow(double, double); double floor(double); double ceil(double); double round(double); double sin(double); double cos(double); double tan(double); double fmod(double, double); double atan2(double, double); } using std::abs; using std::sqrt; using std::pow; using std::floor; using std::ceil; using std::round; using std::sin; using std::cos; using std::tan; using std::fmod; using std::atan2;',
  'algorithm': 'namespace std { template<class T> const T& min(const T& a, const T& b); template<class T> const T& max(const T& a, const T& b); template<class T> T clamp(const T& v, const T& lo, const T& hi); template<class T, class I> void fill(I first, I last, const T& v); template<class T, class I> I min_element(I first, I last); }',
  'utility': 'namespace std { template<class A, class B> struct pair { A first; B second; }; template<class A, class B> pair<A, B> make_pair(A a, B b); template<class T> struct move_result { T value; }; }',
  'memory': 'namespace std { template<class T> struct unique_ptr { unique_ptr(); unique_ptr(T* p); T* get() const; T& operator*() const; T* operator->() const; void reset(T* p); }; template<class T> struct shared_ptr { shared_ptr(); T* get() const; T& operator*() const; T* operator->() const; }; template<class T> unique_ptr<T> make_unique(); template<class T> shared_ptr<T> make_shared(); }',
  'array': 'namespace std { template<class T, size_t N> struct array { T& operator[](size_t i); size_t size() const; }; }',
  'map': 'namespace std { template<class K, class V> struct map { V& operator[](const K& k); }; }',
  'set': 'namespace std { template<class T> struct set { void insert(const T& v); }; }',
  'initializer_list': 'namespace std { template<class T> struct initializer_list { const T* begin() const; const T* end() const; size_t size() const; }; }',
  'functional': 'namespace std { template<class Sig> struct function { function(); Sig operator()() const; }; }',
  'type_traits': 'namespace std { template<class T> struct remove_reference { typedef T type; }; template<class T> struct enable_if {}; }',
  'limits': 'namespace std { template<class T> struct numeric_limits { static T max(); static T min(); }; }',
  'chrono': 'namespace std { struct duration { double count() const; }; }',
  'atomic': 'namespace std { template<class T> struct atomic { T load() const; void store(T v); }; }',
  'iostream': 'namespace std { struct ostream { ostream& operator<<(const char* s); ostream& operator<<(char c); ostream& operator<<(int v); ostream& operator<<(unsigned v); ostream& operator<<(long v); ostream& operator<<(long long v); ostream& operator<<(double v); ostream& operator<<(float v); ostream& operator<<(bool v); ostream& operator<<(void* v); ostream& flush(); }; ostream cout; ostream cerr; ostream clog; ostream& endl(ostream&); } using std::cout; using std::cerr; using std::clog; using std::endl;',
  'ostream': 'namespace std { struct ostream { ostream& operator<<(const char* s); ostream& operator<<(int v); ostream& operator<<(double v); ostream& flush(); }; ostream& endl(ostream&); }',
  'istream': 'namespace std { struct istream { istream& operator>>(int& v); istream& operator>>(double& v); }; istream cin; } using std::cin;',
  'sstream': 'namespace std { struct stringstream { }; }',
  'fstream': 'namespace std { struct ifstream { }; struct ofstream { }; }',
  'stdexcept': 'namespace std { struct runtime_error { runtime_error(const char* m); }; struct logic_error { logic_error(const char* m); }; }',
  'thread': 'namespace std { struct thread { }; }',
  'random': 'namespace std { struct mt19937 { unsigned operator()(); }; }',
  'numeric': 'namespace std { template<class I> I accumulate(I first, I last, I init); }',
  'cstdio': 'int printf(const char* fmt); int sprintf(char* buf, const char* fmt);',
  'stdio.h': 'int printf(const char* fmt); int sprintf(char* buf, const char* fmt);',
  'cstdlib': 'void* malloc(unsigned long n); void free(void* p); int abs(int v); double atof(const char* s);',
  'stdlib.h': 'void* malloc(unsigned long n); void free(void* p); int abs(int v); double atof(const char* s);',
  'cstring': 'unsigned long strlen(const char* s); void* memcpy(void* d, const void* s, unsigned long n); int strcmp(const char* a, const char* b);',
  'string.h': 'unsigned long strlen(const char* s); void* memcpy(void* d, const void* s, unsigned long n); int strcmp(const char* a, const char* b);',
  'new': 'namespace std { struct bad_alloc { }; void* operator new(unsigned long n); void operator delete(void* p) noexcept; }',
  'cfloat': '',
  'numeric_limits': '',
  // headers de sistema usados pelo build nativo do pixela.hpp
  'sys/ioctl.h': '', 'unistd.h': '', 'fcntl.h': '', 'time.h': '',
  'errno.h': 'int errno;', 'signal.h': '',
  'assert.h': '',
};

/**
 * Caminho canônico de um `#include`, RESOLVIDO RELATIVO AO INCLUDER.
 *
 * É a regra do C++: em `#include "../pixela.hpp"` dentro de
 * `src/examples/mesh3d.cpp`, o `../` é relativo a `src/examples`, e o
 * resultado é `src/pixela.hpp` — NÃO a raiz do repositório, e NÃO o
 * diretório do arquivo que está sendo compilado.
 *
 * A entrada é o caminho do arquivo que faz o include (`this.currentFile`),
 * no mesmo formato em que o `Preprocessor` o recebe: relativo à raiz.
 * A saída é relativa à raiz também, para que sirva de chave do mapa
 * `includes`.
 *
 * Normaliza `.` e `..`, e devolve `''` quando o `..` escapa da raiz — nesse
 * caso o chamador trata como "não resolvido" e o include é erro.
 *
 * @param {string} includerPath caminho do arquivo que inclui
 * @param {string} spec o que está entre `"` ou `<>`
 * @returns {string} caminho canônico relativo à raiz, ou `''`
 */
export function resolve(includerPath, spec, isAngle = false) {
  const base = String(includerPath ?? '').includes('/')
    ? String(includerPath).slice(0, String(includerPath).lastIndexOf('/'))
    : '';
  const partes = base.split('/').filter((s) => s && s !== '.');
  for (const seg of String(spec).split('/')) {
    if (seg === '..') {
      if (partes.length === 0) return ''; // escapa da raiz
      partes.pop();
    } else if (seg !== '.' && seg !== '') {
      partes.push(seg);
    }
  }
  return partes.join('/');
}

// --------------------------------------------------------------- helpers

const ehDigito = (c) => c >= '0' && c <= '9';
const ehAlpha = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const ehAlnum = (c) => ehAlpha(c) || ehDigito(c);

/** Divide argumentos de macro por vírgulas de topo. */
export function splitMacroArgs(s) {
  const args = [];
  let prof = 0;
  let atual = '';
  let literal = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (literal) {
      atual += c;
      if (c === '\\' && i + 1 < s.length) { atual += s[++i]; continue; }
      if (c === literal) literal = null;
      continue;
    }
    if (c === '"' || c === "'") { literal = c; atual += c; continue; }
    if (c === '(') { prof++; atual += c; continue; }
    if (c === ')') { prof--; atual += c; continue; }
    if (c === ',' && prof === 0) { args.push(atual); atual = ''; continue; }
    atual += c;
  }
  if (atual !== '' || args.length > 0) args.push(atual);
  return args.map((a) => a.trim());
}

// --------------------------------------------------------------- Preprocessor

export class Preprocessor {
  constructor(opts = {}) {
    this.virtualHeaders = { ...DEFAULT_HEADERS, ...(opts.headers ?? {}) };
    this.includes = { ...(opts.includes ?? {}) };
    this.baseDir = opts.baseDir ?? null;
    /**
     * Diretórios de busca para `#include <x>`, em ordem. Equivale ao `-I` do
     * compilador: só entram na busca de `<...>`, nunca na de `"..."`.
     */
    this.includeDirs = (opts.includeDirs ?? []).map((d) => String(d).replace(/\/+$/, ''));
    /**
     * Caminhos canônicos dos headers que ENTRARAM, na ordem de entrada.
     * Não inclui headers virtuais nem headers barrados por `pragma once`.
     * Exposto em `process().resolvidos`.
     */
    this.resolvidos = [];
    /**
     * `-nostdinc`: pula a busca por headers de SISTEMA. Os headers virtuais
     * e o mapa `includes` continuam valendo — o diferencial contra o g++
     * usa `-nostdinc` justamente para comparar só o que o projeto usa.
     */
    this.nostdinc = !!opts.nostdinc;
    this.maxIncludeDepth = opts.maxIncludeDepth ?? 200;
    this.predefined = Object.entries(opts.predefined ?? {}).map(
      ([k, v]) => [k, String(v)],
    );
    this.errors = [];
    this.counter = 0;
    this.currentFile = 'main.cpp';
    this.macros = new Map();
    this.pragmaOnce = new Set();
  }

  // ------------------------------------------------------------ API

  /**
   * @param {string} source
   * @param {string} filename
   * @returns {{text: string, tokens: Token[], diagnostics: Diagnostic[]}}
   */
  process(source, filename = 'main.cpp') {
    this.errors = [];
    this.counter = 0;
    this.pragmaOnce = new Set();
    // `resolvidos` é por execução: um `process()` novo começa com a lista
    // zerada, senão a segunda chamada herdaria os headers da primeira.
    this.resolvidos = [];
    this.currentFile = filename;
    this.includeStack = [];
    this._carregarMacrosPadrao();

    const { tokens, diagnostics } = new Lexer(source, filename).tokenize({ mode: 'preprocess' });
    for (const d of diagnostics) this.errors.push(d);

    let saida;
    try {
      saida = this._processar(tokens.filter((t) => t.type !== 'eof'), filename).tokens;
    } catch (e) {
      this.errors.push(new Diagnostic('error', ErrorCodes.INSTANTIATION_ERROR,
        `Erro interno no pré-processador: ${e.constructor.name}: ${e.message}`,
        { line: 1, column: 1 }));
      saida = [];
    }

    return {
      text: this._tokensParaTexto(saida),
      tokens: saida,
      diagnostics: this.errors,
      /**
       * Caminhos canônicos dos headers que ENTRARAM, na ordem de entrada.
       * Um header virtual NÃO entra aqui (não é um arquivo), e um header
       * barrado por `pragma once` também não. É a evidência de qual arquivo
       * foi realmente carregado — ver R6d.
       */
      resolvidos: this.resolvidos.slice(),
    };
  }

  _carregarMacrosPadrao() {
    this.macros = new Map();
    const predef = {
      ...Object.fromEntries(this.predefined),
      __PIXELA_JS__: '1',
      __wasm32__: '1',
      __cplusplus: '201703L',
      __PIXELA_VERSION__: '1',
    };
    for (const [k, v] of Object.entries(predef)) {
      this.macros.set(k, { nome: k, params: null, corpo: this._textoParaTokens(v), funcLike: false });
    }
  }

  _textoParaTokens(texto) {
    const r = new Lexer(texto, this.currentFile).tokenize();
    return r.tokens.filter((t) => t.type !== 'eof');
  }

  // ------------------------------------------------------------ núcleo

  /**
   * Processa tokens até o fim (ou até um #endif, se `ateEndif`).
   * Devolve { tokens, proximo } onde `proximo` é o índice logo depois.
   */
  _processar(tokens, filename, ateEndif = false, pilha = []) {
    const out = [];
    let i = 0;

    while (i < tokens.length) {
      const t = tokens[i];

      if (t.type === 'hash') {
        const nome = t.value;

        // #endif: devolve para quem chamou (ou consome, se chamado no topo)
        if (nome === 'endif') {
          if (ateEndif) return { tokens: out, proximo: i + 1 };
          this._erro(t, 'E0100', '#endif sem #if correspondente');
          i++;
          continue;
        }

        // #else/#elif sem #if correspondente: erro + consome a linha
        if ((nome === 'else' || nome === 'elif') && !ateEndif) {
          this._erro(t, 'E0100', `#${nome} sem #if correspondente`);
          i = this._fimDaLinha(tokens, i + 1, t.loc?.line);
          continue;
        }

        if (nome === 'if' || nome === 'ifdef' || nome === 'ifndef') {
          const r = this._blocoCondicional(tokens, i, filename, pilha);
          out.push(...r.tokens);
          i = r.proximo;
          continue;
        }

        i = this._diretivaSimples(tokens, i, out, filename, pilha);
        continue;
      }

      out.push(t);
      i++;
    }

    if (ateEndif) {
      this.errors.push(new Diagnostic('error', ErrorCodes.UNEXPECTED_TOKEN,
        'bloco condicional sem #endif correspondente',
        { line: 1, column: 1 }));
    }

    // expansão de macros no código que sobrou
    return { tokens: this._expandir(out, new Set(), 0, filename), proximo: i };
  }

  /**
   * Tokens que vieram de dentro de uma macro carregam o nome da macro em
   * `_deMacro`. É isso que implementa o hide set: ao expandir `X`, os
   * tokens resultantes ficam marcados e um `X` dentro deles não reexpande.
   */

  /**
   * Processa um #if/#ifdef/#ifndef completo: localiza o #endif, escolhe o
   * ramo ativo e o processa recursivamente. Devolve o índice após o #endif.
   */
  _blocoCondicional(tokens, i, filename, pilha) {
    const hash = tokens[i];
    const linha = hash.loc?.line;
    const nome = hash.value;

    // consome a linha da diretiva (expressão ou nome da macro)
    const fimLinha = this._fimDaLinha(tokens, i + 1, linha);
    const expr = tokens.slice(i + 1, fimLinha);

    let condInicial;
    if (nome === 'if') condInicial = this._avaliar(expr, hash);
    else if (nome === 'ifdef') condInicial = this.macros.has(this._primeiroIdent(expr));
    else condInicial = !this.macros.has(this._primeiroIdent(expr));

    // localiza o #endif correspondente pulando os blocos aninhados
    let prof = 0;
    let k = fimLinha;
    const ramos = []; // [{tipo:'if'|'elif'|'else', expr, token}]
    let fim = tokens.length;
    for (; k < tokens.length; k++) {
      const t = tokens[k];
      if (t.type !== 'hash') continue;
      const n = t.value;
      if (n === 'if' || n === 'ifdef' || n === 'ifndef') { prof++; continue; }
      if (n === 'endif') {
        if (prof === 0) { fim = k; break; }
        prof--;
        continue;
      }
      if (prof === 0 && (n === 'elif' || n === 'else')) {
        const prox = this._fimDaLinha(tokens, k + 1, t.loc?.line);
        ramos.push({ tipo: n, expr: tokens.slice(k + 1, prox), token: t });
        k = prox - 1;
        continue;
      }
    }

    if (fim >= tokens.length) {
      this._erro(hash, 'E0100', '#if sem #endif correspondente');
      // sem #endif, ainda emite o corpo escolhido (o código é recuperável)
      const corpoSemFim = condInicial ? tokens.slice(fimLinha) : [];
      return { tokens: this._processar(corpoSemFim, filename, false, pilha).tokens, proximo: tokens.length };
    }

    // escolhe o ramo: o primeiro verdadeiro; senão, #else
    const corpoIni = this._ateProximoSeparador(tokens, fimLinha, ['elif', 'else', 'endif']);
    let ativo = condInicial;
    let corpo = ativo ? tokens.slice(fimLinha, corpoIni) : null;

    for (const r of ramos) {
      const prox = this._ateProximoSeparador(tokens, this._posAposSeparador(tokens, r.token), ['elif', 'else', 'endif']);
      if (corpo !== null) continue; // já escolheu
      if (r.tipo === 'else') { ativo = true; corpo = tokens.slice(this._posAposSeparador(tokens, r.token), prox); }
      else if (this._avaliar(r.expr, r.token)) { ativo = true; corpo = tokens.slice(this._posAposSeparador(tokens, r.token), prox); }
    }

    if (corpo === null) corpo = [];

    const r = this._processar(corpo, filename, false, pilha);
    return { tokens: r.tokens, proximo: fim + 1 };
  }

  /** Índice do token logo após a diretiva cujo token é `t`. */
  _posAposSeparador(tokens, t) {
    const idx = tokens.indexOf(t);
    return this._fimDaLinha(tokens, idx + 1, t.loc?.line);
  }

  /** Índice do primeiro token que é um #endif, #elif ou #else de um dos tipos. */
  _ateProximoSeparador(tokens, i, tipos) {
    let prof = 0;
    for (let k = i; k < tokens.length; k++) {
      const t = tokens[k];
      if (t.type !== 'hash') continue;
      const n = t.value;
      if (n === 'if' || n === 'ifdef' || n === 'ifndef') { prof++; continue; }
      if (n === 'endif') {
        if (prof === 0) return k;
        prof--;
        continue;
      }
      if (prof === 0 && tipos.includes(n)) return k;
    }
    return tokens.length;
  }

  /** Índice do primeiro token fora da linha `linha`, a partir de `i`. */
  _fimDaLinha(tokens, i, linha) {
    for (let k = i; k < tokens.length; k++) {
      const t = tokens[k];
      if (t.type === 'eof') return k;
      if (t.loc && linha !== undefined && t.loc.line > linha) return k;
    }
    return tokens.length;
  }

  _primeiroIdent(expr) {
    for (const t of expr) if (t.type === 'ident') return t.value;
    return null;
  }

  // ------------------------------------------------------------ diretivas simples

  _diretivaSimples(tokens, i, out, filename, pilha) {
    const hash = tokens[i];
    const nome = hash.value;
    const linha = hash.loc?.line;
    const prox = this._fimDaLinha(tokens, i + 1, linha);

    switch (nome) {
      case 'include':
      case 'include_next':
      case 'import': {
        this._incluir(tokens, i, out, filename, pilha);
        return prox;
      }
      case 'define':
        this._definir(tokens, i, prox);
        return prox;
      case 'undef': {
        const nomeTok = tokens[i + 1];
        if (nomeTok && nomeTok.type === 'ident') this.macros.delete(nomeTok.value);
        return prox;
      }
      case 'error':
        this._erro(hash, 'E0100', `#error ${this._texto(tokens.slice(i + 1, prox))}`);
        return prox;
      case 'warning':
        this.errors.push(new Diagnostic('warning', 'W0200',
          `#warning ${this._texto(tokens.slice(i + 1, prox))}`, hash.loc));
        return prox;
      case 'line':
        return prox;
      case 'pragma': {
        const resto = this._texto(tokens.slice(i + 1, prox));
        if (resto === 'once') { this.pragmaOnce.add(filename); return prox; }  // `filename` ja e o canonico (ver `_incluir`)
        // O GCC preserva #pragma desconhecido na saída (verificado com
        // `g++ -E -P`: `#pragma GCC diagnostic push` continua lá). Fazemos o
        // mesmo para que o resultado do compilador seja comparável.
        out.push(...tokens.slice(i, prox));
        return prox;
      }
      default:
        return prox;
    }
  }

  _texto(tokens) {
    return tokens.map((t) => t.text ?? String(t.value ?? '')).join(' ').trim();
  }

  // ------------------------------------------------------------ #define

  _definir(tokens, i, fim) {
    const hash = tokens[i];
    const nomeTok = tokens[i + 1];
    const valido = nomeTok && nomeTok !== hash
      && (nomeTok.type === 'ident' || nomeTok.type === 'keyword' || nomeTok.type === 'type')
      && nomeTok.loc?.line === hash.loc?.line;

    if (!valido) {
      this._erro(hash, ErrorCodes.EXPECTED_IDENTIFIER,
        '#define sem nome de macro na mesma linha');
      return;
    }

    const nome = nomeTok.value;
    let j = i + 2;
    let params = null;

    // Macro de FUNÇÃO exige '(' ADJACENTE ao nome. `#define SOMA (1 + 2)` é
    // objeto-like com corpo `(1 + 2)`, não uma função de zero parâmetros.
    const abreColado = tokens[j]?.type === 'punctuator' && tokens[j].value === '('
      && !tokens[j].hasSpaceBefore;
    if (abreColado) {
      params = [];
      j++;
      let fechado = false;
      while (j < fim) {
        const t = tokens[j];
        if (t.type === 'punctuator' && t.value === ')') { j++; fechado = true; break; }
        if ((t.type === 'operator' || t.type === 'punctuator') && t.value === ',') { j++; continue; }
        if ((t.type === 'operator' || t.type === 'punctuator') && t.value === '...') {
          params.push('__VA_ARGS__'); j++; continue;
        }
        if (t.type === 'ident' || t.type === 'keyword' || t.type === 'type') {
          params.push(t.value); j++; continue;
        }
        this._erro(t, ErrorCodes.EXPECTED_IDENTIFIER, `Parâmetro inválido em #define ${nome}`);
        j++;
      }
      if (!fechado) {
        this._erro(hash, ErrorCodes.EXPECTED_CLOSE_PAREN,
          `Lista de parâmetros de #define ${nome} não fechada`);
      }
    }

    const corpo = tokens.slice(j, fim);
    this.macros.set(nome, { nome, params, corpo, funcLike: params !== null });
  }

  // ------------------------------------------------------------ expansão

  /**
   * Expande macros na lista de tokens de código (sem diretivas).
   */
  _expandir(tokens, hideSet = new Set(), profundidade = 0, filename = 'main.cpp') {
    if (profundidade > 64) {
      this.errors.push(new Diagnostic('error', ErrorCodes.DEPTH_EXCEEDED,
        'Expansão de macro excedeu 64 níveis (recursão?)', { line: 1, column: 1 }));
      return [];
    }
    const out = [];
    let i = 0;
    let passos = 0;

    while (i < tokens.length) {
      if (++passos > 200000) {
        this.errors.push(new Diagnostic('error', ErrorCodes.DEPTH_EXCEEDED,
          'Expansão de macro não convergiu', { line: 1, column: 1 }));
        return out;
      }
      const t = tokens[i];

      // Built-ins dependem da posição do uso
      if ((t.type === 'ident') && ehAlpha(t.value?.[0] ?? '')) {
        if (t.value === '__LINE__') {
          const v = t.loc?.line ?? 1;
          out.push({ ...t, type: 'number', value: v, literal: v, literalKind: 'int', text: String(v), _sintetico: true, hasSpaceBefore: t.hasSpaceBefore });
          i++; continue;
        }
        if (t.value === '__FILE__') {
          const nome = filename;
          out.push({ ...t, type: 'string', value: nome, literal: nome, literalKind: 'string', text: `"${nome}"`, _sintetico: true, hasSpaceBefore: t.hasSpaceBefore });
          i++; continue;
        }
        if (t.value === '__COUNTER__') {
          const v = this.counter++;
          out.push({ ...t, type: 'number', value: v, literal: v, literalKind: 'int', text: String(v), _sintetico: true, hasSpaceBefore: t.hasSpaceBefore });
          i++; continue;
        }
      }

      if ((t.type === 'ident' || t.type === 'keyword' || t.type === 'type')
          && ehAlpha(t.value?.[0] ?? '')) {
        // hide set: token que nasceu dentro desta mesma macro não reexpande.
        // `hideSet` acumula os nomes à medida que descemos na expansão.
        if (!hideSet.has(t.value)) {
          const r = this._expandirMacro(tokens, i, hideSet);
          if (r.expandiu) {
            out.push(...this._expandir(r.tokens, r.hide, profundidade + 1, filename));
            i = r.proximo;
            continue;
          }
        }
      }

      out.push(t);
      i++;
    }
    return out;
  }

  _expandirMacro(tokens, i, hideSet) {
    const t = tokens[i];
    const def = this.macros.get(t.value);
    if (!def) return { expandiu: false, tokens: [], proximo: i };

    // Hide set: se a macro já está sendo expandida, NÃO reexpande — o
    // identificador é emitido como está. Sem isso, `#define X X` entraria
    // em recursão infinita e `#define A B / #define B A` nunca terminaria.
    if (hideSet.has(def.nome)) return { expandiu: false, tokens: [], proximo: i };

    const novoHide = new Set(hideSet);
    novoHide.add(def.nome);

    if (def.funcLike) {
      // O '(' pode estar separado por espaços: o GCC aceita `ADD (1,2)` como
      // invocação (verificado com `g++ -E -P`: a saída é `((1)+(2))`).
      const abre = tokens[i + 1];
      if (abre?.type !== 'punctuator' || abre.value !== '(') {
        return { expandiu: false, tokens: [], proximo: i };
      }
      const fim = this._fecharParenteses(tokens, i + 1);
      if (fim === -1) {
        this._erro(t, ErrorCodes.EXPECTED_CLOSE_PAREN, `Parêntese não fechado na macro ${def.nome}`);
        return { expandiu: false, tokens: [], proximo: tokens.length };
      }
      const args = this._argumentos(tokens, i + 2, fim);
      // O primeiro token da expansão herda o espaço que havia antes da
      // invocação da macro — senão `= ADD(...)` sairia `=1+2`.
      const espaco = t.hasSpaceBefore;
      const corpo = this._substituir(def, args).map((x, k) => ({
        ...x, _sintetico: true, _deMacro: def.nome, hasSpaceBefore: k === 0 ? espaco : false,
      }));
      return { expandiu: true, tokens: corpo, proximo: fim + 1, hide: novoHide };
    }

    // Macro objeto: corpo vazio (flag de guard) expande para nada.
    if (def.corpo.length === 0) return { expandiu: true, tokens: [], proximo: i + 1, hide: novoHide };
    const corpo = this._substituir(def, []).map((x, k) => ({
      ...x,
      _sintetico: true,
      _deMacro: def.nome,
      // O primeiro token da expansão herda o espaço antes da macro; os
      // demais usam o espaço que tinham no corpo do #define.
      hasSpaceBefore: k === 0 ? t.hasSpaceBefore : x.hasSpaceBefore,
    }));
    return { expandiu: true, tokens: corpo, proximo: i + 1, hide: novoHide };
  }

  _fecharParenteses(tokens, i) {
    let prof = 0;
    const linhaBase = tokens[i]?.loc?.line;
    for (let k = i; k < tokens.length; k++) {
      const t = tokens[k];
      // uma chamada de macro não atravessa linha: se a linha mudou e o
      // parêntese ainda não fechou, a invocação está malformada
      if (t.loc && linhaBase !== undefined && t.loc.line > linhaBase && prof > 0) return -1;
      if (t.type === 'punctuator' && t.value === '(') prof++;
      else if (t.type === 'punctuator' && t.value === ')') {
        prof--;
        if (prof === 0) return k;
      }
    }
    return -1;
  }

  _argumentos(tokens, ini, fim) {
    const args = [];
    let prof = 0;
    let atual = [];
    for (let k = ini; k < fim; k++) {
      const t = tokens[k];
      if (t.type === 'punctuator' && t.value === '(') prof++;
      if (t.type === 'punctuator' && t.value === ')') prof--;
      if (t.type === 'punctuator' && t.value === ',' && prof === 0) {
        args.push(atual); atual = []; continue;
      }
      atual.push(t);
    }
    if (atual.length || args.length) args.push(atual);
    return args;
  }

  /** Aplica parâmetros, # (stringify) e ## (paste) no corpo da macro. */
  _substituir(def, args) {
    const textoDe = (idx) => (args[idx] ?? []).map((x) => x.text ?? String(x.value ?? '')).join(' ');
    const paramIdx = (nome) => (def.params ? def.params.indexOf(nome) : -1);

    const saida = [];
    const corpo = def.corpo;

    for (let k = 0; k < corpo.length; k++) {
      const t = corpo[k];

      // '##' entre dois operandos
      if (t.type === 'operator' && t.value === '##') {
        const esq = saida.pop();
        const dir = corpo[k + 1];
        if (!dir) continue;
        const dirTexto = paramIdx(dir.value) >= 0
          ? textoDe(paramIdx(dir.value))
          : (dir.text ?? String(dir.value ?? ''));
        const esqTexto = esq ? (esq.text ?? String(esq.value ?? '')) : '';
        // re-lexa o resultado para preservar os tipos
        saida.push(...this._textoParaTokens(esqTexto + dirTexto));
        k++;
        continue;
      }

      // '#' antes de um parâmetro → stringify
      if (t.type === 'operator' && t.value === '#') {
        const alvo = corpo[k + 1];
        const idx = alvo ? paramIdx(alvo.value) : -1;
        if (idx >= 0) {
          saida.push(this._stringToken(textoDe(idx), t.loc, true));
          k++;
          continue;
        }
        saida.push(t);
        continue;
      }

      // parâmetro → argumentos. Os tokens do argumento mantêm o espaço que
      // tinham na invocação; quando o primeiro argumento é colado num
      // operador (ex.: `(x+A)` vira `(2+1)`), preservamos a posição do
      // parâmetro no corpo, não a do argumento.
      const idx = paramIdx(t.value);
      if (idx >= 0) {
        const subst = args[idx] ?? [];
        saida.push(...subst.map((x, k) => ({
          ...x,
          hasSpaceBefore: k === 0 ? (t.hasSpaceBefore || x.hasSpaceBefore) : x.hasSpaceBefore,
        })));
        continue;
      }

      saida.push(t);
    }
    return saida;
  }

  _stringToken(texto, loc, sintetico = false) {
    const esc = texto.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return { type: 'string', value: texto, literal: texto, literalKind: 'string', text: `"${esc}"`, loc, _sintetico: sintetico };
  }

  // ------------------------------------------------------------ #include

  /**
   * Procura o conteúdo de um header, na ORDEM que a ordem §4/A1 prescreve.
   *
   *   `#include "x"`  → 1. headers virtuais de sistema
   *                    → 2. `includes` com a grafia exata
   *                    → 3. `includes` com o caminho CANÔNICO relativo ao
   *                       INCLUDER (`resolve`) — é onde `../pixela.hpp`
   *                       dentro de `src/examples/mesh3d.cpp` resolve
   *
   *   `#include <x>`  → 1. headers virtuais de sistema
   *                    → 2. `includeDirs` em ordem (o `-I` do compilador)
   *                    → 3. `includes` com a grafia exata
   *                    → 4. `includes` com o caminho canônico relativo ao
   *                       INCLUDER
   *
   * A diferença é que só `"..."` começa pelo diretório do INCLUDER — é a
   * regra do C++. `<x>` é procurado nos caminhos de sistema primeiro.
   *
   * @param {string} spec o que está entre `"` ou `<>`
   * @param {boolean} isAngle `true` para `#include <...>`
   * @returns {{conteudo: string|undefined, chave: string}} `chave` é o
   *          caminho canônico, e é o que identifica o header adiante.
   */
  _buscarHeader(spec, isAngle) {
    // `tentativas` registra TODAS as chaves que foram consultadas, na ordem.
    // Quando o header não é encontrado, a lista vai na mensagem: é o que
    // permite ver o que o pré-processador procurou e comparar com o que o
    // g++ imprime (`no include path in which to search for ...`).
    const tentativas = [];

    // ---- A ORDEM NORMATIVA (o que o compilador faz, e a §4/A1) ----------
    //
    //   `#include "x"`  →  (1) diretório do INCLUDER
    //                     (2) `includeDirs` (o `-I`)
    //                     (3) headers virtuais de sistema
    //
    //   `#include <x>`  →  (1) `includeDirs` (o `-I`)
    //                     (2) diretório do INCLUDER
    //                     (3) headers virtuais de sistema
    //
    // O item (3) é O ÚLTIMO de propósito. Um header virtual é um STUB do
    // que o projeto realmente tem em `src/`; se ele vier primeiro, um
    // `#include "pixela.hpp"` do bridge resolve para `int pix_width()` em vez
    // de `src/pixela.hpp`, e `class Canvas` nunca chega ao parser. Um arquivo
    // real do projeto NUNCA pode ser sombreado por um stub (R6c).
    //
    // A diferença entre `"x"` e `<x>` é só quem vai primeiro: o diretório do
    // includer abre a busca para `"x"` e só aparece como alternativa para
    // `<x>`, porque `<x>` é header de sistema e a diretiva de cabeçalho de um
    // projeto de usuário também o encontra.

    // (2)/(1) — `includeDirs`, o `-I`. Entra primeiro em `<x>`; em `"x"` é o
    // segundo passo.
    if (isAngle) {
      for (const dir of this.includeDirs) {
        const chave = dir ? `${dir}/${spec}` : spec;
        tentativas.push(`<includeDir ${dir}> ${chave}`);
        const c = this.includes[chave] ?? this.includes[`/${chave}`];
        if (c !== undefined) return { conteudo: c, chave, tentativas, de: 'includeDir' };
      }
    }

    // (1)/(2) — diretório do INCLUDER, pelo caminho canônico. A grafia exata
    // entra logo depois, e é o que cobre o include na raiz (`main.cpp`
    // incluindo `h.h`, onde `resolve` devolve a própria grafia).
    const canonico = resolve(this.currentFile, spec, isAngle);
    if (canonico) {
      tentativas.push(`<canônico, relativo a ${this.currentFile}> ${canonico}`);
      const c = this.includes[canonico] ?? this.includes[`/${canonico}`];
      if (c !== undefined) return { conteudo: c, chave: canonico, tentativas, de: 'includer' };
    }

    if (!isAngle) {
      for (const dir of this.includeDirs) {
        const chave = dir ? `${dir}/${spec}` : spec;
        tentativas.push(`<includeDir ${dir}> ${chave}`);
        const c = this.includes[chave] ?? this.includes[`/${chave}`];
        if (c !== undefined) return { conteudo: c, chave, tentativas, de: 'includeDir' };
      }
    }

    tentativas.push(`<grafia exata> ${spec}`);
    const exato = this.includes[spec];
    if (exato !== undefined) return { conteudo: exato, chave: spec, tentativas, de: 'grafia-exata' };

    // (3) — header virtual de SISTEMA. Último de propósito: ver acima.
    const virtual = this.virtualHeaders[spec];
    if (virtual !== undefined) {
      return { conteudo: virtual, chave: spec, tentativas, de: 'virtual', eVirtual: true };
    }

    return { conteudo: undefined, chave: spec, tentativas };
  }

  _incluir(tokens, i, out, filename, pilha) {
    const achadoNome = this._nomeDoInclude(tokens, i);
    if (!achadoNome) {
      this._erro(tokens[i], ErrorCodes.EXPECTED_IDENTIFIER, '#include sem header-name válido');
      return;
    }
    // `#include <x>`: tira os delimitadores. O mapa e os `includeDirs` são
    // indexados pelo NOME, não por `<x>`.
    let nomeHeader = achadoNome.nome;
    const isAngle = achadoNome.isAngle;
    if (isAngle && nomeHeader.startsWith('<') && nomeHeader.endsWith('>')) {
      nomeHeader = nomeHeader.slice(1, -1);
    }

    const achado = this._buscarHeader(nomeHeader, isAngle);
    const conteudo = achado.conteudo;
    if (conteudo === undefined) {
      this._erro(tokens[i], 'E0100',
        `Header não encontrado: ${nomeHeader} (incluído de ${this.currentFile}:${tokens[i].loc?.line ?? '?'})`
        + ` — procurado em: ${achado.tentativas.join('; ')}`);
      return;
    }

    // Daqui em diante a identidade do header é o caminho CANÔNICO: `pragma
    // once`, include guard e detecção de ciclo precisam reconhecer `a/../h.h`
    // e `h.h` como o MESMO arquivo (R2b). Com a grafia escrita, os dois
    // entrariam duas vezes.
    const canonico = achado.chave;
    nomeHeader = canonico;
    // De onde este include parte — usado nas mensagens de ciclo e de
    // profundidade ("incluído de X:linha").
    const entrada = `${this.currentFile}:${tokens[i].loc?.line ?? '?'}`;

    if (this.pragmaOnce.has(canonico)) return;

    // O GUARD vem ANTES da detecção de ciclo. `a.h` inclui `b.h`, que inclui
    // `a.h` de novo: com include guard em `a.h` a segunda entrada é uma
    // DEFINIÇÃO já feita e o ciclo não é erro — é o que o compilador faz, e
    // é o que o `g++` aceita (fixture caso14). Sem guard, aí sim é ciclo
    // (caso15).
    const guard = this._detectarGuard(conteudo);
    if (guard && this.macros.has(guard)) return;

    // A pilha guarda `arquivo:linha`; para o ciclo só interessa o ARQUIVO.
    // Comparar o arquivo canônico é o que faz `a/../a.h` e `a.h` fecharem o
    // mesmo ciclo.
    const naPilha = pilha.some((e) => e.slice(0, e.lastIndexOf(':')) === canonico);
    if (naPilha) {
      this._erro(tokens[i], 'E0100',
        `Include circular detectado: ${[...pilha, entrada].join(' -> ')} -> ${canonico}`
        + ` (incluído de ${this.currentFile}:${tokens[i].loc?.line ?? '?'})`);
      return;
    }
    if (pilha.length >= this.maxIncludeDepth) {
      this._erro(tokens[i], 'E0100',
        `Profundidade de include excedida (${this.maxIncludeDepth}): ${[...pilha, entrada].join(' -> ')} -> ${canonico}`);
      return;
    }

    // `resolvidos` é a lista de caminhos canônicos que ENTRARAM, na ordem de
    // entrada. O ponto do `push` é aqui, DEPOIS de todos os retornos
    // (`pragma once`, guard, ciclo, profundidade): um header barrado não
    // entrou, e listá-lo seria mentir sobre o que o compilador viu.
    //
    // Um header virtual tem a chave `spec` e NÃO é um arquivo do disco, então
    // não entra na lista — é assim que se prova que nenhum virtual sombreou
    // um arquivo real (R6d).
    if (!achado.eVirtual) this.resolvidos.push(canonico);

    const arquivoAtual = this.currentFile;
    this.currentFile = canonico;
    const { tokens: sub, diagnostics } = new Lexer(conteudo, canonico).tokenize({ mode: 'preprocess' });
    for (const d of diagnostics) this.errors.push(d);
    // A pilha carrega `arquivo:linha` — é o que permite escrever a cadeia do
    // ciclo como "incluído de X:linha", que é onde o include QUE FECHA o
    // ciclo está. Sem a linha, a cadeia só mostra nomes de arquivo e não
    // diz onde olhar.
    const r = this._processar(
      sub.filter((t) => t.type !== 'eof'), canonico, false, [...pilha, entrada]);
    out.push(...r.tokens);
    this.currentFile = arquivoAtual;

    if (guard) {
      this.macros.set(guard, { nome: guard, params: null, corpo: [], funcLike: false });
    }
  }

  /** Nome do header de uma diretiva #include (literal ou via macro). */
  /**
   * Nome do header de uma diretiva `#include`, e se ele é `<...>`.
   *
   * O lexer NÃO sempre emite `header-name`: em `#include <x>` ele pode
   * devolver `<` como operador separado (o `>` fecha a lista de template do
   * ponto de vista do lexer). Os dois formatos são tratados aqui, e o
   * `isAngle` sai junto — é ele que decide se os `includeDirs` entram na
   * busca (R2a).
   *
   * @returns {{nome: string, isAngle: boolean}|null}
   */
  _nomeDoInclude(tokens, i) {
    // O índice de `i` depende do ponto de entrada: em modo `preprocess` o
    // lexer emite UM token `hash:"include"` e o header vem em `i+1`; na forma
    // tokenizada, `#` e `include` são separados e o header vem em `i+2`.
    // A diferença é detectada pelo próprio token.
    let prox = null;
    if (tokens[i]?.type === 'hash') prox = tokens[i + 1];
    else if (tokens[i]?.value === '#') prox = tokens[i + 2] ?? tokens[i + 1];
    else prox = tokens[i + 1];
    if (prox?.type === 'header-name') {
      // `isAngle` foi gravado pelo lexer no momento da leitura — é o único
      // lugar onde os delimitadores ainda estavam presentes.
      const v = String(prox.value);
      return { nome: v, isAngle: prox.isAngle === true || v.startsWith('<') };
    }

    // `<` como operador: o header é o que vem entre ele e o `>`.
    if (prox && (prox.type === 'operator' || prox.type === 'punctuator') && prox.value === '<') {
      const base = tokens[i]?.type === 'hash' ? i + 2 : i + 3;
      let j = base;
      const pedacos = [];
      while (j < tokens.length && tokens[j].value !== '>' && tokens[j].type !== 'eof') {
        pedacos.push(String(tokens[j].value ?? ''));
        j++;
      }
      if (tokens[j]?.value !== '>') return null;
      return { nome: `<${pedacos.join('')}>`, isAngle: true };
    }

    // `#include MACRO`. O corpo da macro é um literal de STRING — `"x.h"` —
    // e não um `header-name`: o lexer só marca `header-name` quando o
    // delimitador estava no FONTE. Logo, `#define M "x.h"` + `#include M`
    // precisa ler o `string` e tirar as aspas.
    if (prox && (prox.type === 'ident' || prox.type === 'keyword' || prox.type === 'type')) {
      const def = this.macros.get(prox.value);
      const primeiro = def?.corpo?.[0];
      if (primeiro) {
        if (primeiro.type === 'header-name') {
          const v = String(primeiro.value);
          return { nome: v, isAngle: v.startsWith('<') };
        }
        if (primeiro.type === 'string') {
          return { nome: String(primeiro.value), isAngle: false };
        }
        // `<x>` escrito como tokens soltos na macro.
        if (primeiro.value === '<') {
          const pedacos = [];
          let j = 1;
          while (def.corpo[j] && def.corpo[j].value !== '>') {
            pedacos.push(String(def.corpo[j].value ?? ''));
            j++;
          }
          if (def.corpo[j]?.value === '>') {
            return { nome: `<${pedacos.join('')}>`, isAngle: true };
          }
        }
      }
      const expandido = this._expandir([prox], new Set());
      if (expandido[0]?.type === 'header-name') {
        const v = String(expandido[0].value);
        return { nome: v, isAngle: v.startsWith('<') };
      }
      if (expandido[0]?.type === 'string') {
        return { nome: String(expandido[0].value), isAngle: false };
      }
      // `#include MACRO` onde a macro É o nome entre <>
      return { nome: `<${prox.value}>`, isAngle: true };
    }
    return null;
  }

  _detectarGuard(conteudo) {
    const m = conteudo.match(/^\s*#\s*ifndef\s+(\w+)\s*\r?\n\s*#\s*define\s+\1\b/);
    return m ? m[1] : null;
  }

  // ------------------------------------------------------------ avaliação de #if

  /** Avalia a expressão inteira de #if em BigInt. */
  _avaliar(tokens, origem) {
    if (tokens.length === 0) {
      this._erro(origem, 'E0100', '#if sem expressão');
      return true;
    }
    try {
      const prep = this._preparar(tokens);
      if (prep.length === 0) {
        this._erro(origem, 'E0100', 'expressão de #if vazia após expansão');
        return true;
      }
      // Avaliador recursivo-descendente: faz curto-circuito de verdade
      // em && e || (o lado direito só é lido quando o esquerdo não decide).
      return this._avaliarExpr(prep) !== 0n;
    } catch (e) {
      this._erro(origem, 'E0100',
        `Não foi possível avaliar a expressão de #if (${e.message}); assumindo verdadeira`);
      return true;
    }
  }

  /** Expande macros e converte tudo para {tipo:'num'|'op'}. */
  _preparar(tokens) {
    const out = [];
    let i = 0;
    while (i < tokens.length) {
      const t = tokens[i];

      if (t.type === 'ident' && t.value === 'defined') {
        let k = i + 1;
        let temParen = false;
        if (tokens[k]?.type === 'punctuator' && tokens[k].value === '(') { temParen = true; k++; }
        const alvo = tokens[k];
        const definido = alvo?.type === 'ident' && this.macros.has(alvo.value);
        out.push({ tipo: 'num', valor: definido ? '1' : '0' });
        k++;
        if (temParen && tokens[k]?.type === 'punctuator' && tokens[k].value === ')') k++;
        i = k;
        continue;
      }

      if (t.type === 'ident' || t.type === 'keyword' || t.type === 'type') {
        const def = this.macros.get(t.value);
        if (def) {
          // expande (uma passada; #if não usa função-macro na prática)
          const sub = def.funcLike ? [] : this._expandir(def.corpo, new Set());
          out.push(...this._preparar(sub));
          i++;
          continue;
        }
        out.push({ tipo: 'num', valor: '0' }); // identificador desconhecido
        i++;
        continue;
      }

      if (t.type === 'number') {
        let v = (t.text ?? String(t.value)).replace(/[uUlL]+$/, '');
        out.push({ tipo: 'num', valor: v === '' ? '0' : v });
        i++;
        continue;
      }

      if (t.type === 'punctuator' || t.type === 'operator') {
        out.push({ tipo: 'op', valor: t.value });
        i++;
        continue;
      }

      i++;
    }
    return out;
  }

  /**
   * Avaliador recursivo-descendente da expressão de #if.
   *
   * Grammática (da mais fraca para a mais forte):
   *   ou     := e ('||' e)*
   *   e      :=igualdade ('&&' igualdade)*
   *   igual  := bitor ('=='|'!=' bitor)*
   *   bitor  := bitxor ('|' bitxor)*
   *   bitxor := bitand ('^' bitand)*
   *   bitand := igualdade2 ('&' igualdade2)*
   *   ...
   *
   * O curto-circuito é REAL: em `0 && 1/0`, o lado direito nunca é lido,
   * então a divisão por zero não acontece.
   */
  _avaliarExpr(toks) {
    this._i = 0;
    this._toks = toks;
    const v = this._parseTernario();
    if (this._i < toks.length) {
      throw new Error(`token inesperado ${toks[this._i].valor}`);
    }
    return v;
  }

  _peek() { return this._toks[this._i]; }
  _eOp(...valores) {
    const t = this._peek();
    return t && t.tipo === 'op' && valores.includes(t.valor) ? t : null;
  }
  _consume(...valores) {
    const op = this._eOp(...valores);
    if (op) this._i++;
    return op;
  }

  _parseOu() {
    let esq = this._parseE();
    for (;;) {
      if (!this._consume('||')) return esq;
      if (esq !== 0n) {
        // curto-circuito: verdadeiro || X é verdadeiro sem avaliar X
        this._descartarOperando();
        esq = 1n;
        continue;
      }
      const dir = this._parseE();
      esq = dir !== 0n ? 1n : 0n;
    }
  }

  /** Ternário tem precedência MENOR que ||, então é o topo da gramática. */
  _parseTernario() {
    const cond = this._parseOu();
    if (!this._consume('?')) return cond;
    // Os dois ramos só são avaliados quando o cond decide — curto-circuito.
    const a = cond !== 0n ? this._parseOu() : 0n;
    if (!this._consume(':')) throw new Error("faltou ':' no ternário de #if");
    const b = cond !== 0n ? 0n : this._parseOu();
    return cond !== 0n ? a : b;
  }

  _parseE() {
    let esq = this._parseIgualdade();
    for (;;) {
      if (!this._consume('&&')) return esq;
      if (esq === 0n) {
        // curto-circuito: o lado direito NUNCA é avaliado. Ainda assim é
        // preciso consumi-lo sintaticamente, senão o parser desalinha e
        // reclama de token inesperado. Consumimos os tokens do operando
        // seguinte sem avaliá-los.
        this._descartarOperando();
        esq = 0n;
        continue;
      }
      const dir = this._parseIgualdade();
      esq = dir !== 0n ? 1n : 0n;
    }
  }

  /** Consome os tokens de um operando booleano sem avaliá-los. */
  _descartarOperando() {
    // Consome até o próximo &&, ||, ? ou ')' no mesmo nível de parênteses,
    // ou até o fim da expressão. Não lança ao chegar no fim: um operando
    // descartado no fim da lista é normal (`#if 0 && 1`).
    let profundidade = 0;
    for (;;) {
      const t = this._peek();
      if (!t) return; // fim da expressão: nada mais a descartar
      if (t.tipo === 'op' && t.valor === '(') { profundidade++; this._i++; continue; }
      if (t.tipo === 'op' && t.valor === ')') {
        if (profundidade === 0) return;
        profundidade--;
        this._i++;
        continue;
      }
      if (profundidade === 0 && t.tipo === 'op'
          && (t.valor === '&&' || t.valor === '||' || t.valor === '?')) return;
      this._i++;
    }
  }

  _parseIgualdade() {
    let esq = this._parseBitOu();
    for (;;) {
      const op = this._consume('==', '!=');
      if (!op) return esq;
      const dir = this._parseBitOu();
      esq = (op.valor === '==') ? (esq === dir ? 1n : 0n) : (esq !== dir ? 1n : 0n);
    }
  }

  _parseBitOu() {
    let esq = this._parseBitXor();
    for (;;) {
      if (!this._consume('|')) return esq;
      esq |= this._parseBitXor();
    }
  }

  _parseBitXor() {
    let esq = this._parseBitE();
    for (;;) {
      if (!this._consume('^')) return esq;
      esq ^= this._parseBitE();
    }
  }

  _parseBitE() {
    let esq = this._parseRelacional();
    for (;;) {
      if (!this._consume('&')) return esq;
      esq &= this._parseRelacional();
    }
  }

  _parseRelacional() {
    let esq = this._parseDeslocamento();
    for (;;) {
      const op = this._consume('<', '<=', '>', '>=');
      if (!op) return esq;
      const dir = this._parseDeslocamento();
      switch (op.valor) {
        case '<': esq = esq < dir ? 1n : 0n; break;
        case '<=': esq = esq <= dir ? 1n : 0n; break;
        case '>': esq = esq > dir ? 1n : 0n; break;
        case '>=': esq = esq >= dir ? 1n : 0n; break;
      }
    }
  }

  _parseDeslocamento() {
    let esq = this._parseAditivo();
    for (;;) {
      const op = this._consume('<<', '>>');
      if (!op) return esq;
      const dir = this._parseAditivo();
      esq = op.valor === '<<' ? (esq << dir) : (esq >> dir);
    }
  }

  _parseAditivo() {
    let esq = this._parseMultiplicativo();
    for (;;) {
      const op = this._consume('+', '-');
      if (!op) return esq;
      const dir = this._parseMultiplicativo();
      esq = op.valor === '+' ? esq + dir : esq - dir;
    }
  }

  _parseMultiplicativo() {
    let esq = this._parseUnario();
    for (;;) {
      const op = this._consume('*', '/', '%');
      if (!op) return esq;
      // curto-circuito também se aplica ao operando esquerdo: `0 && (1/0)`
      // nunca chega aqui, mas `0 * (1/0)` protection: se dir for 0 e for
      // divisão, C trata como erro — então não protegemos, propagamos.
      const dir = this._parseUnario();
      if (op.valor === '*') esq *= dir;
      else if (op.valor === '/') {
        if (dir === 0n) throw new Error('divisão por zero em #if');
        esq = esq / dir;
      } else {
        if (dir === 0n) throw new Error('resto de divisão por zero em #if');
        esq = esq % dir;
      }
    }
  }

  _parseUnario() {
    if (this._consume('!')) return this._parseUnario() === 0n ? 1n : 0n;
    if (this._consume('~')) return ~this._parseUnario();
    if (this._consume('-')) return -this._parseUnario();
    if (this._consume('+')) return +this._parseUnario();
    return this._parsePrimario();
  }

  _parsePrimario() {
    if (this._consume('(')) {
      const v = this._parseTernario();
      if (!this._consume(')')) throw new Error("faltou ')' em #if");
      return v;
    }
    const t = this._peek();
    if (!t) throw new Error('expressão de #if terminou cedo demais');
    if (t.tipo === 'num') { this._i++; return BigInt(t.valor === '' ? '0' : t.valor); }
    this._i++;
    throw new Error(`operando inválido ${JSON.stringify(t.valor)} em #if`);
  }

  _rpn(tokens) {
    const PREC = {
      '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5,
      '==': 6, '!=': 6, '<': 7, '<=': 7, '>': 7, '>=': 7,
      '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10,
    };
    const saida = [];
    const pilha = [];
    let i = 0;

    while (i < tokens.length) {
      const t = tokens[i];
      if (t.tipo === 'num') {
        saida.push({ tipo: 'num', valor: BigInt(t.valor) });
        i++;
        continue;
      }
      const op = t.valor;
      if (op === '!' || op === '~') { pilha.push(op); i++; continue; }
      if (op === '(') { pilha.push('('); i++; continue; }
      if (op === ')') {
        while (pilha.length && pilha[pilha.length - 1] !== '(') saida.push({ tipo: 'op', valor: pilha.pop() });
        if (!pilha.length) throw new Error('parênteses desbalanceados');
        pilha.pop();
        i++;
        while (pilha.length && (pilha[pilha.length - 1] === '!' || pilha[pilha.length - 1] === '~')) {
          saida.push({ tipo: 'op', valor: pilha.pop() });
        }
        continue;
      }
      if (op === '?') { pilha.push('?'); i++; continue; }
      if (op === ':') {
        while (pilha.length && pilha[pilha.length - 1] !== '?') saida.push({ tipo: 'op', valor: pilha.pop() });
        if (!pilha.length) throw new Error("':' sem '?'");
        pilha.pop();
        i++;
        continue;
      }
      if (op === '-' || op === '+') {
        // unário ou binário: se前の token é num ou ')', é binário
        const anterior = tokens[i - 1];
        const ehBinario = anterior && (anterior.tipo === 'num'
          || (anterior.tipo === 'op' && (anterior.valor === ')' || anterior.valor === ']')));
        if (!ehBinario) { pilha.push(op); i++; continue; }
      }
      const p = PREC[op];
      if (p === undefined) throw new Error(`operador desconhecido '${op}'`);
      while (pilha.length) {
        const topo = pilha[pilha.length - 1];
        if (topo === '(' || topo === '?') break;
        const pt = PREC[topo];
        if (pt !== undefined && pt >= p) saida.push({ tipo: 'op', valor: pilha.pop() });
        else break;
      }
      pilha.push(op);
      i++;
    }

    while (pilha.length) {
      const t2 = pilha.pop();
      if (t2 === '(') throw new Error('parêntese não fechado');
      saida.push({ tipo: 'op', valor: t2 });
    }
    return saida;
  }

  _avaliarRPN(rpn) {
    const p = [];
    for (let idx = 0; idx < rpn.length; idx++) {
      const t = rpn[idx];
      if (t.tipo === 'num') { p.push(t.valor); continue; }
      const op = t.valor;

      if (op === '!') { p.push(p.pop() === 0n ? 1n : 0n); continue; }
      if (op === '~') { p.push(~p.pop()); continue; }

      if (op === '?') {
        const c = p.pop(), b = p.pop(), a = p.pop();
        p.push(c !== 0n ? a : b);
        continue;
      }

      // Curto-circuito é feito no _avaliarExpr (recursive descent); aqui os
      // dois operandos já estão na pilha.
      const b = p.pop(), a = p.pop();
      if (a === undefined || b === undefined) throw new Error('operadores sem operandos');

      switch (op) {
        case '+': p.push(a + b); break;
        case '-': p.push(a - b); break;
        case '*': p.push(a * b); break;
        case '/': p.push(a / b); break;
        case '%': p.push(a % b); break;
        case '<<': p.push(a << b); break;
        case '>>': p.push(a >> b); break;
        case '&': p.push(a & b); break;
        case '|': p.push(a | b); break;
        case '^': p.push(a ^ b); break;
        case '==': p.push(a === b ? 1n : 0n); break;
        case '!=': p.push(a !== b ? 1n : 0n); break;
        case '<': p.push(a < b ? 1n : 0n); break;
        case '<=': p.push(a <= b ? 1n : 0n); break;
        case '>': p.push(a > b ? 1n : 0n); break;
        case '>=': p.push(a >= b ? 1n : 0n); break;
        case '&&': p.push(a !== 0n && b !== 0n ? 1n : 0n); break;
        case '||': p.push(a !== 0n || b !== 0n ? 1n : 0n); break;
        default: throw new Error(`operador desconhecido '${op}'`);
      }
    }
    if (p.length !== 1) throw new Error('expressão malformada');
    return p[0];
  }

  // ------------------------------------------------------------ saída

  _erro(token, codigo, mensagem) {
    this.errors.push(new Diagnostic('error', codigo, mensagem,
      token?.loc ?? { line: 1, column: 1 }));
  }

  /** Reconstrói texto a partir dos tokens, respeitando quebras e espaços. */
  _tokensParaTexto(tokens) {
    const partes = [];
    let linhaAtual = 1;
    let ultimoCol = 0;   // coluna original do último token NA MESMA linha
    let ultimoLinha = 0;
    let primeiro = true;
    let ultimoTexto = null;

    for (const t of tokens) {
      if (!t || t.type === 'eof') continue;
      // Um token 'hash' sobrevivente é uma diretiva não tratada (ex.:
      // #pragma desconhecido) — reemite com o '#' na frente, como o GCC.
      const texto = t.type === 'hash'
        ? `#${t.value ?? ''}`
        : (t.text ?? String(t.value ?? ''));
      if (texto === '') continue;

      const loc = t.loc;
      if (loc && loc.line > linhaAtual) {
        // Sem cap: no máximo um \n por linha pulada. Um cap (ex.: 2) faria
        // linhaAtual ficar defasada e um token da MESMA linha seguinte
        // ainda receberia uma quebra.
        partes.push('\n');
        linhaAtual = loc.line;
        ultimoCol = 0;
        ultimoLinha = 0;
        primeiro = true;
      }

      if (!primeiro) {
        // A coluna original só decide o espaçamento quando o token e o
        // anterior estão na MESMA linha da fonte — depois de um #elif pulado,
        // as linhas da fonte não correspondem mais à saída.
        const mesmaLinha = loc && ultimoLinha > 0 && loc.line === ultimoLinha;
        const precisa = t.hasSpaceBefore
          || (!t._sintetico && mesmaLinha && ultimoCol > 0
              && loc.column > ultimoCol + ultimoTexto.length)
          || this._coladoComAnterior(ultimoTexto, texto);
        if (precisa) partes.push(' ');
      }

      partes.push(texto);
      ultimoTexto = texto;
      // Coluna original serve só para tokens que NÃO foram expandidos. Num
      // token sintético o loc aponta para a posição da macro, não do texto
      // gerado, então usá-lo produziria espaçamento errado depois dele.
      ultimoCol = (loc && !t._sintetico) ? loc.column : 0;
      ultimoLinha = loc?.line ?? 0;
      primeiro = false;
    }
    return partes.join('');
  }

  /** Dois identificadores/números vizinhos ficariam colados sem espaço? */
  _coladoComAnterior(anterior, texto) {
    if (!anterior || !texto) return false;
    const a = anterior[anterior.length - 1];
    const b = texto[0];
    const alnum = (c) => ehAlnum(c) || c === '_';
    return alnum(a) && alnum(b);
  }
}

export default Preprocessor;