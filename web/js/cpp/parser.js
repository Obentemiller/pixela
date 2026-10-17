/**
 * js/cpp/parser.js — C++ → AST.
 *
 * Reescrito do zero sob TDD. O arquivo anterior (783 linhas, zero testes)
 * importava um export inexistente e foi para a quarentena; este não é um
 * conserto dele.
 *
 * ## Contrato
 *
 * - **Nunca lança.** Toda entrada devolve `{ast, diagnostics}`.
 * - **Progresso garantido.** Nenhum laço avança sem consumir token. Um `while`
 *   que não consome nada é laço infinito, não caso raro — por isso todo
 *   `consome()` no fim de um laço é `avancaOuConsome()`.
 * - **Erro é dado, não exceção.** `este()` devolve sempre algo; quando não há
 *   token, devolve um token sintético de fim de arquivo, que nunca é
 *   confundido com um token real.
 * - **Recuperação.** Um erro não abandona o arquivo: o parser sincroniza no
 *   próximo `;`, `}` ou início de declaração e continua.
 *
 * ## Entrada
 *
 * Tokens do lexer, já passam pelo pré-processador. O parser não entende
 * `#include`: quem inclui é o pré-processador.
 *
 * ## Documentação
 *
 * O formato dos nós está em docs/ast.md — que é normativo. Este arquivo e
 * aquele não podem divergir.
 *
 * ## Fora do escopo
 *
 * Construções reconhecidas e não implementadas dão E02xx com o nome da
 * construção, nunca "token inesperado". Ver a tabela em docs/ast.md §6.
 */

import * as A from './ast.js';

// ------------------------------------------------------------------ erros

/**
 * Subcódigos de E02xx: cada construção fora do escopo tem o seu.
 * E03xx está ocupado por erros semânticos — ver docs/ast.md §6.
 */
const E = {
  ASM: 'E0201',
  GOTO: 'E0202',
  ALIGNAS: 'E0203',
  COROUTINA: 'E0204',
  OPERATOR: 'E0205',
  IMPORT: 'E0206',
  STRING_LARGO: 'E0207',
  ATRIBUTO: 'E0208',
  CONCEITO: 'E0209',
  GENERICO: 'E0200',
};

const DESCRICAO_E02 = {
  E0201: "declaração 'asm'",
  E0202: "'goto' e rótulos",
  E0203: "'alignas' e 'thread_local'",
  E0204: 'corrotinas (co_await, co_yield, co_return)',
  E0205: 'sobrecarga de operator',
  E0206: "'import' de módulo",
  E0207: 'literal de string largo (u"...", U"...", L"...")',
  E0208: 'atributo [[...]]',
  E0209: "'concept' e 'requires'",
  E0200: 'construção',
};

const E01 = {
  TOKEN: 'E0100',
  PONTO_E_VIRGULA: 'E0101',
  PARENTESE: 'E0102',
  CHAVE: 'E0103',
  IDENTIFICADOR: 'E0104',
  TIPO: 'E0105',
};

/** Códigos semânticos (E03xx) emitidos pelo parser. */
const E03 = {
  DESIGNATED_INITIALIZER_UNSUPPORTED: 'E0308',
};

// ------------------------------------------------------- reconhecimento de tipo

/**
 * Nomes de `std` que o compilador conhece sem ler os headers.
 *
 * A lista é o suficiente para o subconjunto declarado do compilador e está
 * documentada em docs/ast.md. Um nome de std que NÃO está aqui é tratado
 * como identificador comum — é a sema que vai dizer que não conhece, e não o
 * parser. A lista é fechada de propósito: `std::` seguido de identificador
 * desconhecido ainda é um nome qualificado válido.
 */
const NOMES_STD = new Set([
  // containers e sequência
  'vector', 'array', 'deque', 'list', 'forward_list', 'set', 'multiset',
  'map', 'multimap', 'unordered_set', 'unordered_multiset', 'unordered_map',
  'unordered_multimap', 'stack', 'queue', 'priority_queue', 'pair', 'tuple',
  // texto
  'string', 'wstring', 'u8string', 'u16string', 'u32string', 'string_view',
  'basic_string', 'basic_string_view',
  // utilitários
  'optional', 'variant', 'any', 'tuple_size', 'initializer_list',
  'unique_ptr', 'shared_ptr', 'weak_ptr', 'make_unique', 'make_shared',
  'move', 'forward', 'swap', 'begin', 'end', 'size', 'data', 'empty',
  // memória e blocos
  'allocator', 'function', 'reference_wrapper', 'bit', 'byte',
  // iostream
  'ostream', 'istream', 'iostream', 'endl', 'cout', 'cin', 'cerr', 'clog',
  // matemática
  'abs', 'max', 'min', 'sqrt', 'pow', 'floor', 'ceil', 'round', 'clamp',
]);

/**
 * Nomes de `NOMES_STD` que são VALOR (função ou objeto), não TIPO.
 *
 * `std::cout << "x"` e `std::min(a, b)` começam como `std::X` igual a
 * `std::string s`. O que separa é o token seguinte: depois de um TIPO vem
 * um identificador (`s`), um `*`/`&`, `<` ou `[`; depois de um VALOR vem um
 * operador, `(` ou `;`. `isTypeName` usa esta distinção.
 */
const NOMES_STD_VALOR = new Set([
  'move', 'forward', 'swap', 'begin', 'end', 'size', 'data', 'empty',
  'make_unique', 'make_shared', 'abs', 'max', 'min', 'sqrt', 'pow',
  'floor', 'ceil', 'round', 'clamp',
  'endl', 'cout', 'cin', 'cerr', 'clog',
]);

/** Nomes de `NOMES_STD` que são TIPO (`std::string`, `std::vector<int>`). */
const NOMES_STD_TIPO = new Set([...NOMES_STD].filter((n) => !NOMES_STD_VALOR.has(n)));

/** Tipos da biblioteca padrão que são palavras-chave no lexer. */
const TIPOS_BUILTIN_TEXT = new Set([
  'void', 'bool', 'char', 'short', 'int', 'long', 'float', 'double',
  'signed', 'unsigned', 'wchar_t', 'char8_t', 'char16_t', 'char32_t',
]);

const PALAVRAS_ESPECIFICADOR = new Set([
  'static', 'extern', 'inline', 'virtual', 'explicit', 'mutable', 'const',
  'constexpr', 'consteval', 'constinit', 'friend', 'register', 'volatile',
  'thread_local', 'typename', 'typedef', 'restrict', '__restrict', '_Atomic',
  'auto',
]);

const PALAVRAS_CV = new Set(['const', 'volatile', 'restrict', '__restrict']);

/** Operadores que podem virar declaradores: `operator+`, `operator[]`… */
const OPERADORES_DECLARAVEIS = new Set([
  '+', '-', '*', '/', '%', '^', '&', '|', '~', '!', '=', '<', '>',
  '+=', '-=', '*=', '/=', '%=', '^=', '&=', '|=', '<<', '>>', '<<=', '>>=',
  '==', '!=', '<=', '>=', '&&', '||', '++', '--', ',', '->*', '->',
  '()', '[]', 'new', 'delete',
]);

// ------------------------------------------------------------------ helpers

const fim = { type: 'eof', value: '', literalKind: null, isError: false, loc: { line: 1, column: 1 } };

/** O token `i` depois do fim da lista, ou um token sintético de EOF. */
function tokenEm(tokens, i) {
  return (i >= 0 && i < tokens.length) ? tokens[i] : fim;
}

// ------------------------------------------------------------------ Parser

export class Parser {
  /**
   * @param {Token[]} tokens tokens do lexer (já pré-processados)
   * @param {{file?: string}} [opts]
   */
  constructor(tokens, opts = {}) {
    this.tokens = Array.isArray(tokens) ? tokens.slice() : [];
    // o lexer sempre emite um 'eof'; se não veio, acrescentamos um para que
    // `fim()` nunca seja alcançado.
    if (this.tokens.length === 0 || this.tokens[this.tokens.length - 1].type !== 'eof') {
      this.tokens.push(fim);
    }
    this.file = opts.file ?? 'main.cpp';
    this.diagnostics = [];
    this.i = 0;
    /** Profundidade de template, para diagnostics de `>>` e de `>>>`. */
    this.profundidadeTemplate = 0;
    /** Limite de iterações por função de parse, para nunca travar. */
    this.orcamento = 0;

    /**
     * TypeNameScope — o conjunto de nomes que a TypeNameScope considera
     * NOME DE TIPO. Substitui a heurística "toda letra maiúscula é tipo",
     * que quebrava `a * b`, `x < y > z` e `i & j` (ver P6).
     *
     * Fontes de um nome de tipo:
     *   (a) palavra-chave de tipo built-in (`int`, `char`, `void`…);
     *   (b) nome de TIPO do prelúdio (`std::vector`, `std::string`…);
     *   (c) declaração de tipo vista no arquivo — `struct S{}`, `enum E{}`,
     *       `typedef … X`, `using X = …`;
     *   (d) parâmetro de template, registrado ao parsear `template<class T>`;
     *   (e) lista de parâmetros (`noTipo`), onde identificador solto é tipo.
     *
     * É uma PILHA de conjuntos: entrar num escopo empilha um conjunto novo,
     * sair desempilha. Um tipo declarado dentro de uma função NÃO vaza para
     * fora dela (teste P6-S01).
     */
    this.nomesTipo = [new Set()];
  }

  /** O conjunto de nomes de tipo do escopo ATUAL. */
  get tiposDoEscopo() { return this.nomesTipo[this.nomesTipo.length - 1]; }

  /** Registra `nome` como nome de tipo no escopo atual. */
  declaraTipo(nome) {
    if (nome) this.tiposDoEscopo.add(String(nome));
  }

  /** Entra num escopo: tipos declarados aqui não vazam para fora. */
  abreEscopoTipos() {
    // Herda os tipos do escopo pai: `struct T{}` no topo do arquivo continua
    // tipo dentro de qualquer função. O que é declarado no FILHO não sobe.
    this.nomesTipo.push(new Set(this.tiposDoEscopo));
    return this;
  }

  /** Sai do escopo, descartando os tipos declarados dentro dele. */
  fechaEscopoTipos() { if (this.nomesTipo.length > 1) this.nomesTipo.pop(); return this; }

  // ---------------------------------------------------------- tokens

  /**
   * O token atual. NUNCA devolve `undefined`: no fim da lista devolve um
   * token sintético de EOF. Todo o parser pode chamar isto sem guarda.
   */
  este() { return tokenEm(this.tokens, this.i); }

  /** O token `n` posições à frente, sem consumir. */
  olha(n = 0) { return tokenEm(this.tokens, this.i + n); }

  /** O valor do token atual como texto. */
  valor() { return String(this.este().value ?? ''); }

  /** Consome o token atual e devolve o novo índice. */
  avanca() { return ++this.i; }

  /** Consome se o valor for `v`; devolve se consumiu. */
  come(v) {
    if (this.valor() === v) { this.avanca(); return true; }
    return false;
  }

  /** Consome se for um dos valores; devolve o que consumiu, ou null. */
  comeUm(...vs) {
    const v = this.valor();
    if (vs.includes(v)) { this.avanca(); return v; }
    return null;
  }

  /**
   * Consome um token semimportância e devolve um AST de erro.
   * Usado na recuperação: nunca deixa o índice parado.
   */
  avancaOuConsome() {
    if (this.i < this.tokens.length - 1) this.avanca();
    else this.i = this.tokens.length - 1;
  }

  // ---------------------------------------------------------- diagnósticos

  loc(token = this.este()) {
    const l = token?.loc;
    return { file: this.file, line: l?.line ?? 0, column: l?.column ?? 0 };
  }

  /**
   * Registra um diagnóstico. Devolve sempre o token para permitir
   * `consome(`;`()` encadeado. Nunca lança.
   */
  diag(codigo, mensagem, token = this.este()) {
    this.diagnostics.push({
      severity: 'error',
      code: codigo,
      message: mensagem,
      loc: this.loc(token),
    });
    return token;
  }

  /** Erro de sintaxe com o token encontrado citado na mensagem. */
  erro(espera, token = this.este()) {
    const achado = token.type === 'eof' ? '<fim do arquivo>' : `'${token.value}'`;
    return this.diag(E01.TOKEN, `Esperava ${espera}, encontrado ${achado}`, token);
  }

  /** Erro de sintaxe com código específico. */
  erroCom(codigo, mensagem, token = this.este()) {
    return this.diag(codigo, mensagem, token);
  }

  /**
   * Relata uma construção reconhecida e não suportada.
   * O ponto inteiro desta função é: nunca dizer "token inesperado" para algo
   * que o parser SABE o que é.
   */
  foraDoEscopo(codigo, token = this.este()) {
    const d = DESCRICAO_E02[codigo] ?? DESCRICAO_E02.E0200;
    return this.diag(codigo, `Não suportado: ${d}`, token);
  }

  // ---------------------------------------------------------- loc nos nós

  /** Copia a loc de um token para um nó, sem mutar o nó. */
  comLoc(no, token) {
    if (!no || typeof no !== 'object') return no;
    no.loc = this.loc(token);
    return no;
  }

  // ---------------------------------------------------------- isTypeName

  /**
   * O token atual inicia um nome de tipo?
   *
   * Isto é a ambiguidade central do C++: `f(x)` pode ser uma chamada de
   * função ou uma declaração de `x` como parâmetro. Resolvemos com um escopo:
   * `noTipo` marca "estamos dentro de um `( ... )` que é lista de
   * parâmetros", onde um identificador solto É um tipo.
   *
   * @returns {boolean}
   */
  isTypeName(noTipo = false, n = 0) {
    const t = this.olha(n);
    if (t.type === 'type') return true;
    // `int`, `void`, `char` chegam como `keyword`, não como `type`.
    if (t.type === 'keyword' && TIPOS_BUILTIN_TEXT.has(String(t.value))) return true;
    if (t.type !== 'ident') return false;

    const nome = String(t.value);
    // Dentro de lista de parâmetros: identificador solto é tipo.
    if (noTipo) return true;
    // `std::algo` — o segundo componente é o que decide. `string` e `vector`
    // chegam como `keyword` (ver NOMES_STD), não como `ident`, então o tipo do
    // token não pode ser o critério.
    //
    // Depois do nome vem o QUE DECIDE: se for `x`, `*`, `&`, `<` ou `[`, o
    // nome é um TIPO (`std::string s`, `std::vector<int> v`); se for um
    // operador, `(` ou `;`, é um VALOR (`std::cout << 1`, `std::min(a,b)`).
    const prox1 = this.olha(n + 1);
    if (String(prox1.value) === '::') {
      const segundo = String(this.olha(n + 2).value);
      const t2 = this.olha(n + 2);
      if (t2.type === 'ident' || t2.type === 'type' || t2.type === 'keyword') {
        // P10: `std::T` e `T` sao decididos pelo PRELUDIO DECLARADO — o
        // pre-processador cola as declaracoes de `<vector>`, `<string>`,
        // `<cstdint>`… antes do parse e o parser registra cada `struct`/
        // `using` que ve. `std::vector` e tipo porque `vector` foi
        // DECLARADO, nao porque esta numa lista fixa.
        if (this.tiposDoEscopo.has(segundo)) return true;
        if (NOMES_STD_VALOR.has(segundo)) return false;
        if (NOMES_STD_TIPO.has(segundo)) return true;
        // Nome desconhecido de `std::`: tipo se vier algo que continue um tipo
        // (outro nome, `*`, `&`, `<`, `[`), valor caso contrário.
        const depois = this.olha(n + 3);
        return depois.type === 'ident' || depois.type === 'type'
          || ['*', '&', '<', '['].includes(String(depois.value));
      }
    }
    // P6: o nome é TIPO se, e somente se, a TypeNameScope diz. Não há mais
    // heurística de "capitalizado é tipo": ela vazava escopo (um `struct
    // Local` declarado dentro de uma função continuava sendo tipo fora
    // dela — teste P6-S01) e não é o que a ordem manda.
    //
    // Consequência: um tipo definido em OUTRO arquivo (que este parser não
    // viu) não é reconhecido. Os arquivos do projeto passam porque todos
    // incluem `pixela.hpp` pelo pré-processador, que cola o texto antes do
    // parse. Ver P10 — a correção definitiva é o prelúdio declarado.
    if (this.tiposDoEscopo.has(nome)) return true;
    return false;
  }

  /** O token atual inicia um qualified-id (`a::b::c`)? */
  isQualifiedId() {
    const t = this.este();
    if (t.type !== 'ident' && t.type !== 'type') return false;
    // `::` no início (nome global)
    if (this.valor() === '::') return true;
    let k = 0;
    while (this.olha(k).type === 'ident' || this.olha(k).type === 'type'
      || this.olha(k).type === 'template') {
      if (this.olha(k + 1).value === '::') { k += 2; continue; }
      break;
    }
    return k >= 2;
  }

  // ---------------------------------------------------------- template-id

  /**
   * Existe uma lista de argumentos de template em `<...>` aqui?
   *
   * Esta é a ambiguidade mais perigosa do C++ em tempo de análise: em
   * `i < 10`, o `<` parece abrir `i<10>`. Sem uma checagem, o parser
   * consumia `<10; ++i) { } ...` procurando um `>` que não existe e
   * engolia o resto do arquivo.
   *
   * A regra prática: só tratamos `<` como início de template se houver um
   * `>` correspondente antes de qualquer `;`, `{`, `}` ou fim de linha, com
   * `<` e `>` balanceados. Isso é conservador: pode recusar uma lista de
   * template legítima com operador de comparaçao dentro (`A<(x>y)>`), caso
   * raro que o padrão também resolve como outra coisa.
   */
  eListaTemplateArgs(inicio = 0, limite = 200) {
    if (this.olha(inicio).value !== '<') return false;
    let prof = 0;
    // Começa em `inicio + 1`: o `<` de ABERTURA não entra na contagem. Começar
    // nele deixava `prof` sempre >= 1 dentro da lista, e as regras de topo
    // (`||`, `?`, `=`) nunca valiam.
    for (let k = inicio + 1; k < inicio + 1 + limite; k++) {
      const t = this.olha(k);
      if (t.type === 'eof') return false;
      const v = String(t.value ?? '');
      if (v === ';') return false;
      if (v === '{' || v === '}') return false;
      // No topo da lista, `||`, `&&`, `?`, `:` e `=` não podem aparecer:
      // uma lista de argumentos de template válida não os contém. Sem esta
      // regra, `x < a || x > b` viajava `x<a> || x>b` — o `>` da comparação
      // fechava a suposta lista, e o nome virava a string `x<a> || x>b`.
      if (prof === 0 && ['||', '&&', '?', ':', '='].includes(v)) return false;
      // P6: no TOPO da lista, um argumento de template é um TIPO (ou uma lista
      // de não-tipos). `x < y > z;` com `y` VARIÁVEL não é template — sem
      // esta regra o nome virava `x<>` e o unparse produzia `x<>::z;`.
      const candT = this.olha(k);
      if (prof === 0 && v !== 'const' && v !== 'typename'
        && (candT.type === 'ident' || candT.type === 'type')) {
        // `type` (o lexer marca `uint8_t`, `size_t`… como type) é tipo por
        // definição. Para `ident`, decide a TypeNameScope.
        const ehTipo = candT.type === 'type'
          || this.tiposDoEscopo.has(v) || NOMES_STD_TIPO.has(v)
          || (v[0] >= 'A' && v[0] <= 'Z' && v.length > 1);
        if (!ehTipo) {
          // `V<T>`, `N::T<T>` — o nome pode ser composto, e aí o token
          // seguinte é `::` ou `<`. `V<T>` simples também é aceitável, mas
          // `y > z` NÃO é: `>` aqui fecha a lista, então um nome minúsculo
          // antes de `>` é comparação, não template.
          const depois = String(this.olha(k + 1).value);
          if (depois === '>') return false;
          if (!['::', '<', ','].includes(depois)) return false;
        }
      }
      if (v === ')') { if (prof === 0) return false; prof--; continue; }
      if (v === '(') { prof++; continue; }
      if (v === '>') {
        if (prof === 0) return true;
        prof--;
        // prof voltou a 0: a lista FECHOU aqui. Continuar a varredura
        // encontraria o `;` depois e devolveria false, fazendo
        // `S<int> s;` ser lido como `S < int >` (comparação).
        if (prof === 0) return true;
        continue;
      }
      if (v === '>>') {
        // `>>` fecha dois templates de uma vez. Com um `<` aberto, ele casa.
        if (prof <= 1) return true;
        prof -= 2;
        if (prof === 0) return true;
        continue;
      }
      if (v === '<') prof++;
      if (t.loc && k > 0 && this.olha(k - 1).loc
        && t.loc.line !== this.olha(k - 1).loc.line) {
        return false; // atravessa linha: não é lista de template
      }
    }
    return false;
  }

  /**
   * Consome `<...>` depois de um nome, se for lista de argumentos de template.
   *
   * O truque do `>>`: `vector<vector<int>>` fecha dois templates com um só
   * token. C++17 resolve isso dividindo `>>` em dois `>`. Nós fazemos o
   * mesmo: devolve `true` e consome APENAS o primeiro `>` quando o segundo
   * também é `>`, deixando o segundo para quem estiver no nível externo.
   *
   * @returns {boolean} consumiu uma lista?
   */
  tryTemplateArgs(forcado = false) {
    if (this.valor() !== '<') return false;
    if (!forcado && !this.eListaTemplateArgs()) return false;
    const abre = this.este();
    void abre;
    this.avanca();

    const args = [];
    let guard = 0;
    while (this.este().type !== 'eof' && guard++ < 4096) {
      if (this.valor() === '>') { this.avanca(); break; }
      if (this.valor() === '>>') {
        // fecha este template e deixa um `>` para o de fora
        const token = this.este();
        this.tokens[this.i] = { ...token, value: '>' };
        break;
      }
      if (this.valor() === ',') { this.avanca(); continue; }
      if (this.valor() === ')') break;
      if (this.valor() === '(') {
        this.consumeBlocoAte(')');
        continue;
      }
      const antes = this.i;
      const arg = this.tryTipo();
      if (arg) args.push(arg);
      if (this.i === antes) this.avancaOuConsome();
    }
    return true;
  }

  // ---------------------------------------------------------- sincronização

  /**
   * Recuperação de erro: consome até um ponto seguro.
   * Para em `;`, `}` ou no fim, sem越过 o `}` de abertura (salva em `this.pilhaChave`).
   */
  sincroniza(pareEm = [';', '}']) {
    let guard = 0;
    while (this.este().type !== 'eof' && guard++ < 100000) {
      const v = this.valor();
      if (pareEm.includes(v)) return;
      // Um novo开始 de declaração também é ponto seguro.
      if (this.este().type === 'type' || this.este().type === 'keyword') return;
      this.avanca();
    }
  }

  /** Consome tokens até encontrar `fecha`, empurrandoprofundidade. */
  consumeBlocoAte(fecha) {
    let profundidade = 0;
    let guard = 0;
    while (this.este().type !== 'eof' && guard++ < 100000) {
      const v = this.valor();
      if (v === '(' || v === '[' || v === '{') profundidade++;
      else if (v === ')' || v === ']' || v === '}') {
        if (profundidade === 0) {
          if (v === fecha) { this.avanca(); return true; }
          if (v === '}') return false;
          return false;
        }
        profundidade--;
      }
      this.avanca();
    }
    return false;
  }

  // ---------------------------------------------------------- entrada

  /**
   * Ponto de entrada. Devolve SEMPRE `{ast, diagnostics}`.
   * @returns {{ast: A.TranslationUnit, diagnostics: object[]}}
   */
  parse() {
    this.i = 0;
    this.diagnostics = [];
    const decls = [];
    let guard = 0;
    while (this.este().type !== 'eof' && guard++ < 2000000) {
      const antes = this.i;
      const d = this.declaracaoTopo();
      if (d) decls.push(d);
      if (this.i === antes) {
        // O parser não avançou: consome o token para nunca travar.
        this.erro('declaração');
        this.avancaOuConsome();
      }
    }
    return { ast: A.TranslationUnit(decls), diagnostics: this.diagnostics };
  }

  // ================================================================
  // Declarações de topo
  // ================================================================

  declaracaoTopo() {
    const t = this.este();

    if (this.valor() === ';') { this.avanca(); return A.EmptyDecl(); }

    if (t.type === 'hash') {
      // Diretiva que sobrou (o pré-processador deveria ter tratado).
      this.erro('declaração');
      this.avanca();
      return null;
    }

    if (t.type === 'keyword' && t.value === 'namespace') return this.namespaceDecl();
    if (t.type === 'keyword' && t.value === 'using') return this.usingDecl();
    if (t.type === 'keyword' && t.value === 'template') return this.templateDecl();
    if (t.type === 'keyword' && t.value === 'export') {
      // `export template<...>` / `export namespace`
      this.avanca();
      return this.declaracaoTopo();
    }
    if (t.type === 'keyword' && t.value === 'static_assert') return this.staticAssert();
    if (t.type === 'keyword' && t.value === 'asm') {
      this.foraDoEscopo(E.ASM);
      this.avanca();
      this.consumeBlocoAte(';');
      return A.EmptyDecl();
    }
    if (t.type === 'keyword' && t.value === 'import') {
      this.foraDoEscopo(E.IMPORT);
      this.avanca();
      this.sincroniza();
      return null;
    }
    if (t.type === 'keyword' && t.value === 'concept') {
      this.foraDoEscopo(E.CONCEITO);
      this.avanca();
      this.sincroniza();
      return null;
    }
    // `goto`/`throw` no topo de arquivo: reconhecidos, fora do escopo. Sem
    // esta regra seriam "token inesperado", que é exatamente o que não
    // queremos.
    if (t.type === 'keyword' && t.value === 'goto') {
      return A.EmptyDecl(this.gotoStmt(), this.loc(t));
    }
    if (t.type === 'keyword' && t.value === 'throw') {
      this.foraDoEscopo(E.GENERICO);
      this.avanca();
      if (this.valor() !== ';') this.expressao();
      this.consumeUm(';');
      return A.EmptyDecl();
    }
    // `extern "C" ...` — especificação de ligação. SÓ quando o próximo token
    // é string: `extern T x;` é declaração comum, com `extern` de specifier
    // (já está em PALAVRAS_ESPECIFICADOR). Sem esta guarda, todo `extern`
    // caía em linkageSpec(), que exige literal de string.
    if (t.type === 'keyword' && t.value === 'extern'
        && this.olha(1).type === 'string') {
      return this.linkageSpec();
    }

    // `[[atributo]]` antes de qualquer declaração
    if (this.valor() === '[' && this.olha(1).value === '[') {
      this.foraDoEscopo(E.ATRIBUTO);
      while (this.este().type !== 'eof' && this.valor() !== ';' && this.valor() !== ']') {
        this.avancaOuConsome();
      }
      this.consumeBlocoAte(']');
      return this.declaracaoTopo();
    }

    // `int x;`, `struct S {};`, `enum E {};`, `typedef ...;`
    return this.declaracaoSimples();
  }

  /** Especificação de ligação: `extern "C" ...` ou `extern "C" { ... }`. */
  linkageSpec() {
    const ini = this.este();
    this.avanca(); // extern

    // Deve vir um string literal: "C" ou "C++"
    if (this.este().type !== 'string') {
      this.erro('string literal após extern');
      this.sincroniza();
      return A.EmptyDecl();
    }

    const linguagem = this.valor(); // "C" ou "C++"
    this.avanca(); // consome a string

    // Verifica se é bloco `extern "C" { ... }` ou declaração única `extern "C" decl`
    if (this.valor() === '{') {
      this.avanca(); // {
      const decls = [];
      let guard = 0;
      while (this.este().type !== 'eof' && this.valor() !== '}' && guard++ < 100000) {
        const antes = this.i;
        const d = this.declaracaoTopo();
        if (d) decls.push(d);
        // Mesmo caso da forma única: `;` após `{...}` de uma definição é
        // `EmptyDecl` e não deve virar declaração extra no round-trip.
        if (d && d.kind !== 'EmptyDecl' && this.valor() === ';') this.avanca();
        if (this.i === antes) this.avancaOuConsome();
      }
      if (this.valor() === '}') this.avanca();
      else this.erro("'}'");
      return A.LinkageSpec(linguagem, decls, true, this.loc(ini));
    } else {
      // Declaração única: `extern "C" void f();`
      const d = this.declaracaoTopo();
      // `declaracaoSimples` consome o `;` de uma declaração sem corpo
      // (`extern "C" void f();`) mas NÃO o de uma DEFINIÇÃO
      // (`extern "C" void f(){}`), porque em C++ `;` depois de `{...}` é um
      // `EmptyDecl` próprio. Sem consumir aqui, o `;` do unparse voltava como
      // segunda declaração e o round-trip não fechava.
      if (d && d.kind !== 'EmptyDecl' && this.valor() === ';') this.avanca();
      return A.LinkageSpec(linguagem, d ? [d] : [], false, this.loc(ini));
    }
  }

  namespaceDecl() {
    const ini = this.este();
    this.avanca(); // namespace
    this.consumeUm('inline');

    let alias = null;
    let nome = null;
    if (this.este().type === 'ident' && this.valor() !== '{') {
      const nomeTok = this.este();
      if (this.olha(1).value === '=') {
        this.avanca();
        this.avanca();
        alias = this.declaratorAbstrato();
      } else {
        nome = String(nomeTok.value);
        this.avanca();
      }
    }

    if (this.valor() !== '{') {
      this.erro("'{'");
      // `namespace n;` apenas abre; não consuma o resto.
      return A.NamespaceDecl(nome, [], false, this.loc(ini));
    }

    this.avanca(); // {
    const decls = [];
    let guard = 0;
    while (this.este().type !== 'eof' && this.valor() !== '}' && guard++ < 1000000) {
      const antes = this.i;
      const d = this.declaracaoTopo();
      if (d) decls.push(d);
      if (this.i === antes) this.avancaOuConsome();
    }
    if (this.valor() === '}') this.avanca();
    else this.erro("'}'");

    return A.NamespaceDecl(nome, decls, this.inline, this.loc(ini));
  }

  consumeUm(v) {
    if (this.valor() === v) { this.avanca(); return true; }
    return false;
  }

  usingDecl() {
    const ini = this.este();
    this.avanca(); // using

    if (this.valor() === 'namespace') {
      this.avanca();
      const nome = this.qualifiedName();
      this.consumeUm(';');
      return A.UsingDecl(nome, nome, null, this.loc(ini));
    }

    // `using Alias = tipo;` ou `using ns::nome;`
    const nome = this.qualifiedName();
    if (nome === null) {
      this.erro('identificador');
      this.avancaOuConsome();
      this.sincroniza();
      return null;
    }

    if (this.valor() === '=') {
      this.avanca();
      const tipo = this.tryTipo() ?? new A.Identifier(null);
      this.consumeUm(';');
      // `using Alias = int;` — o NOME é o que veio antes do `=`, já lido em
      // `nome`. O alias é o TIPO.
      const alias = String(nome).split('::').pop();
      // P6: `using U = int;` declara `U` como NOME DE TIPO.
      this.declaraTipo(alias);
      return A.UsingDecl(alias, null, tipo, this.loc(ini));
    }

    this.consumeUm(';');
    const ultimo = String(nome).split('::').pop();
    return A.UsingDecl(ultimo, String(nome), null, this.loc(ini));
  }

  /** Nome qualificado: `a::b::c`. Devolve string ou null. */
  qualifiedName() {
    const partes = [];
    if (this.valor() === '::') this.avanca();
    let guard = 0;
    while (guard++ < 10000) {
      const t = this.este();
      if (t.type !== 'ident' && t.type !== 'type') break;
      partes.push(String(t.value));
      this.avanca();
      // P6: `x < y > z;` — o `<` aqui é COMPARAÇÃO, não template. Precisa
      // ser decidido ANTES de `tryTemplateArgs`, porque essa função consome
      // os tokens mesmo quando devolve false (ela só não devolve truthy).
      // Antes disso o nome virava `x<>` e o unparse produzia `x<>::z;`.
      if (this.valor() === '<') {
        // `eListaTemplateArgs(inicio)` olha a partir do `<`; o token ATUAL
        // já é o `<` porque o nome foi consumido acima.
        if (!this.eListaTemplateArgs(0)) break;
        this.tryTemplateArgs();
        partes[partes.length - 1] += '<>';
        continue;
      }
      if (this.valor() === '::') { this.avanca(); continue; }
      break;
    }
    if (partes.length === 0) return null;
    return partes.join('::');
  }

  /**
   * Índice do `>` (ou `>>`) que fecha o `template<...>` em curso, sem
   * atravessar parênteses, colchetes ou um `<...>` aninhado. -1 se não achar.
   */
  indiceDoFechaTemplate() {
    let prof = 0;
    for (let k = this.i; k < this.tokens.length; k++) {
      const v = this.tokens[k].value;
      if (v === '(' || v === '[' || v === '<') prof++;
      else if (v === ')' || v === ']') { if (prof === 0) return -1; prof--; }
      else if (v === '>') { if (prof === 0) return k; prof--; }
      else if (v === '>>') { if (prof === 0) return k; prof = Math.max(0, prof - 2); }
      else if (v === 'eof' || v === '') return -1;
    }
    return -1;
  }

  /**
   * Expressão constante dentro de `template<...>`: tem de PARAR no `>` de
   * fechamento. `constante()` sozinho não serve — parseia operador binário e
   * comeria o `>` como "maior", e `template<int N = 3>` virava `3 > struct`
   * (medido: 2 diagnósticos; `int N = 3;` fora de template dá 0).
   *
   * O truque é pôr um token INERTE no lugar do fechador enquanto a expressão
   * é lida, e restaurar logo depois. É a mesma surgery de token que
   * `tryTemplateArgs` já faz para partir `>>`.
   */
  constanteEmTemplate() {
    const k = this.indiceDoFechaTemplate();
    if (k < 0) return this.constante();
    const fechador = this.tokens[k];
    this.tokens[k] = { ...fechador, value: 'FIM-TEMPLATE-GT', type: 'punct' };
    try {
      return this.constante();
    } finally {
      this.tokens[k] = fechador;
    }
  }

  templateDecl() {
    const ini = this.este();
    this.avanca(); // template

    const params = [];
    if (this.valor() !== '<') {
      this.erro("'<'");
      this.avancaOuConsome();
      return A.TemplateDecl([], null, this.loc(ini));
    }
    this.avanca(); // <
    // `template<>` sem parâmetro é erro
    if (this.valor() === '>') { this.erro("'typename'"); this.avanca(); }

    let guard = 0;
    while (this.este().type !== 'eof' && this.valor() !== '>' && guard++ < 100000) {
      const antes = this.i;
      if (this.valor() === '>>') {
        // fecha este template e deixa um `>` de fora
        const tk = this.este();
        this.tokens[this.i] = { ...tk, value: '>' };
        break;
      }
      // `typename T`, `class T`, `int N`, `T... Args`
      // `ehTipo` decide o QUE pode seguir a um `=`: parâmetro de tipo
      // (`class`/`typename`) tem default tipo-id; parâmetro de VALOR
      // (`int N = 3`) tem expressão constante.
      const ehTipo = this.consumeUm('typename') || this.consumeUm('class');
      if (this.valor() === 'requires' || this.valor() === 'concept') {
        this.foraDoEscopo(E.CONCEITO);
      }
      const specs = [];
      while (this.este().type === 'type' || this.valor() === 'const') {
        specs.push(String(this.este().value));
        this.avanca();
      }
      const packs = this.valor() === '...';
      if (packs) this.avanca();
      // `declaratorAbstrato` NÃO consome o nome; `typename T` precisa dele.
      const d = this.declaratorSimples({ packs });
      if (d) params.push(d);
      if (this.valor() === '=') {
        // Argumento default. Tem de ser LIDO e GUARDADO em `d.default`:
        // descartar seria aceitação silenciosa com árvore incompleta, que é
        // o vício do S7(d) — `enum E` virou `EnumDecl` com `enumerators: []`.
        this.avanca();
        // `tryTipo` faz backtrack: devolve `null` e restaura a posição se o
        // que segue não for tipo. Serve para `= int`, `= T`, `= std::vector<int>`.
        let valor = ehTipo ? this.tryTipo(false) : null;
        // Parâmetro de valor: expressão constante que tem de PARAR no `>` de
        // fechamento. `constante()` sozinho não serve.
        if (!valor) valor = this.constanteEmTemplate();
        if (d) d.default = valor ?? null;
      }
      if (this.valor() === ',') { this.avanca(); continue; }
      if (this.i === antes) this.avancaOuConsome();
    }
    if (this.valor() === '>') this.avanca();
    else this.erro("'>'");

    // P6: `template<class T>` registra `T` como NOME DE TIPO durante o corpo
    // do template, e só durante ele. O escopo é aberto e fechado em volta do
    // `declaracaoTopo`, para `T` não vazar para o resto da unidade de tradução.
    this.abreEscopoTipos();
    let decl;
    try {
      for (const d of params) this.declaraTipo(d?.name);
      decl = this.declaracaoTopo();
    } finally {
      this.fechaEscopoTipos();
    }
    // `template<...>` tem de ser seguido de uma DECLARAÇÃO. Sem isso,
    // `template<class T>;` e `template<class T = int>;` eram aceitos em
    // silêncio — o g++ diz `expected unqualified-id before ';' token`.
    // Isto NÃO é do argumento default (que também rejeita sem ter default
    // nenhum: `template<class T>;`); é a ausência da declaração. Ver o
    // oráculo em reports/A2/p02-gpp-oraculo.log §3.2.
    if (!decl || decl.kind === 'EmptyDecl') {
      this.erro('declaração após template');
    }
    // O NOME do template (`template<class T> struct S`) continua sendo tipo
    // depois da declaração — `S<int> s;` precisa reconhecê-lo.
    const nomeTemplate = decl?.name ?? (decl?.kind === 'ClassDecl' || decl?.kind === 'EnumDecl'
      ? decl.name
      : (decl?.kind === 'VariableDecl' || decl?.kind === 'TypedefDecl'
        ? decl.declarators?.[0]?.name
        : null));
    this.declaraTipo(nomeTemplate);
    return A.TemplateDecl(params, decl, this.loc(ini));
  }

  staticAssert() {
    const ini = this.este();
    this.avanca(); // static_assert
    if (this.valor() !== '(') { this.erro("'('"); return A.StaticAssertDecl(null, null, this.loc(ini)); }
    this.avanca();
    const cond = this.constante();
    let msg = null;
    if (this.valor() === ',') {
      this.avanca();
      const t = this.este();
      if (t.type === 'string') { msg = A.Literal(String(t.value), 'string', null, this.loc(t)); this.avanca(); }
      else msg = this.constante();
    }
    if (this.valor() === ')') this.avanca();
    else this.erro("')'");
    this.consumeUm(';');
    return A.StaticAssertDecl(cond, msg, this.loc(ini));
  }

  // ---------------------------------------------------------- simples

  /**
   * Declaração que não é namespace/using/template: variável, função,
   * classe, enum, typedef ou friend.
   */
  declaracaoSimples(opts = {}) {
    const ini = this.este();
    const save = this.i;
    // `for (int i = 0; i < n; ...)` — o `;` é do for, não da declaração.
    const semPontoEVirgula = !!opts.semPontoEVirgula;
    // Em declarador ABSTRATO (`int *`, `int [3]`) não há nome por definição.
    const semDeclarador = !!opts.abstract;

    if (this.valor() === 'friend') {
      this.avanca();
      const d = this.declaracaoSimples();
      // `friend` sem declaração nenhuma não é declaração. Emitir
      // `FriendDecl` com `decl: null` fazia o unparse produzir `friend ;`,
      // que ao reparsear virava `friend ;;` — o round-trip não fechava.
      if (!d) return A.EmptyDecl(this.loc(ini));
      return A.FriendDecl([], d, this.loc(ini));
    }

    if (this.valor() === 'typedef') {
      this.avanca();
      const specs = this.especificadores();
      const decls = this.listaDeclaradores();
      this.consumeUm(';');
      // P6: `typedef int I;` declara `I` como NOME DE TIPO.
      for (const d of decls) this.declaraTipo(d?.name);
      return A.TypedefDecl(specs, decls, this.loc(ini));
    }

    // `alignas(...)`
    if (this.valor() === 'alignas' || this.valor() === 'thread_local') {
      this.foraDoEscopo(E.ALIGNAS);
      this.avanca();
      if (this.valor() === '(') this.consumeBlocoAte(')');
      if (this.valor() === ',') { this.avanca(); return this.declaracaoSimples(); }
      return this.declaracaoSimples();
    }

    // P6: `noTipo` FALSO aqui. `especificadores` tem `noTipo = true` por padrão
    // (listas de parâmetros, onde identificador solto é tipo), e essa
    // chamada em uma DECLARAÇÃO em escopo de bloco fazia `Local y;` virar
    // declaração com tipo `Local` mesmo sem `Local` estar na TypeNameScope.
    const specs = this.especificadores(false);

    // Construtor: `C()`, `C(int)`, `C() : x_(0)`. Sem tipo de retorno, e só
    // dentro de uma classe — por isso `this.dentroDeClasse`.
    if (this.dentroDeClasse && specs.length === 0
      && this.este().type === 'ident'
      && this.olha(1).value === '(') {
      const d = this.declaratorSimples();
      return this.funcaoDecl(specs, d ? [d] : [], ini);
    }

    // `operator int()`, `operator+()` — começa no nome, não no tipo
    if (specs.length === 0 && this.valor() === 'operator') {
      const d = this.declaratorSimples();
      if (d && d.temParams) return this.funcaoDecl(specs, [d], ini);
      if (d) return this.funcaoDecl(specs, [d], ini);
    }

    // `decltype(x) y;` — `decltype` não é especificador, é um tipo inteiro.
    // Precisa vir ANTES do `return null` abaixo, senão nunca chega aqui.
    if (specs.length === 0 && this.valor() === 'decltype') {
      const tipo = this.tryTipo(true);
      if (tipo && tipo.expr && tipo.expr.specifierText) {
        const d = this.declaratorSimples();
        if (d) {
          d.specifierText = tipo.expr.specifierText;
          d.tipoNoDeclarador = true;
          let init = null;
          if (this.valor() === '=') { this.avanca(); init = this.inicializador(); }
          this.consumeUm(';');
          return A.VariableDecl([], [d], init, this.loc(ini));
        }
      }
      this.i = save;
    }

    if (specs.length === 0) return null;

    // `enum` vem ANTES de class/struct: em `enum class E` os dois estão na
    // lista de especificadores, e 'class' não pode hacer o parser achar que
    // é uma definição de classe.
    if (specs.includes('enum')) return this.enumSpec(specs);

    // class / struct / union
    const tag = specs.find((s) => ['class', 'struct', 'union'].includes(s));
    if (tag) return this.classSpec(specs, tag);

    // A lista pode estar vazia: `struct {int x;};` já foi tratado acima.
    const decls = this.listaDeclaradores(opts);
    if (decls.length === 0) return null;

    // Atributo depois do declarador: `int x [[maybe_unused]] = 1;`
    while (this.valor() === '[' && this.olha(1).value === '[') {
      this.foraDoEscopo(E.ATRIBUTO);
      while (this.este().type !== 'eof' && this.valor() !== ']') this.avancaOuConsome();
      this.consumeBlocoAte(']');
    }
    // Numa declaração CONCRETA todo declarador precisa de nome:
    // `int = 1;` e `int [3] a;` não declaram nada. Um declarador com
    // `inner` (`int (*f)(int)`) TEM nome — está no declarador interno.
    const temNome = (d) => d.name !== null || d.inner !== null;
    if (!semDeclarador && !decls.every((d) => temNome(d) && !d.absAntesDoNome)) {
      this.erro('identificador');
    }

    // Função? O declarador JÁ consumiu os `(params)` e marcou `temParams`.
    if (this.eFuncao(decls[0])) {
      return this.funcaoDecl(specs, decls, ini);
    }

    let init = null;
    if (this.valor() === '=') {
      this.avanca();
      init = this.inicializador();
    } else if (this.valor() === '{' && decls.length > 0) {
      // `S s{1, 2};` — init-list sem `=`
      init = this.inicializador();
    }


    // `int a = 1, b = 2;` — os declaradores DEPOIS do primeiro podem ter
    // inicializador próprio. `listaDeclaradores` já parou na vírgula quando
    // encontrou `=`, então continuamos daqui.
    while (this.valor() === ',') {
      this.avanca();
      const d = this.declaratorSimples();
      if (d) {
        let di = null;
        if (this.valor() === '=') { this.avanca(); di = this.inicializador(); }
        else if (this.valor() === '{') di = this.inicializador();
        decls.push(di ? { ...d, init: di } : d);
      } else this.avancaOuConsome();
    }

    if (!semPontoEVirgula && !this.consumeUm(';')) {
      this.erro("';'");
    }

    return A.VariableDecl(specs, decls, init, this.loc(ini));
  }

  /** O declarador é de função? (isto é, tem lista de parâmetros) */
  eFuncao(d) {
    if (!d) return false;
    if (d.array && d.array.length > 0) return false;
    return d.temParams === true;
  }

  /**
   * `int f(...)`, `void f() const`, `int f() { corpo }`.
   * O tipo de retorno fica nos `specifiers`.
   */
  funcaoDecl(specs, decls, ini) {
    const d = decls[0];
    // Tipo de retorno corrente, para `return;` — ver returnStmt.
    const retornoAnterior = this.retornoAtual;
    this.retornoAtual = (specs.find((x) => TIPOS_BUILTIN_TEXT.has(x) && x !== 'signed'
      && x !== 'unsigned') ?? (specs.includes('void') ? 'void' : null));
    // Qualificadores depois dos params
    while (this.valor() === 'const' || this.valor() === 'volatile'
      || this.valor() === '&' || this.valor() === '&&' || this.valor() === 'noexcept') {
      if (this.valor() === 'const') d.cvConst = true;
      else if (this.valor() === 'volatile') d.cvVolatile = true;
      else if (this.valor() === '&') d.refQual = 'lvalue';
      else if (this.valor() === '&&') d.refQual = 'rvalue';
      else { this.avanca(); this.consumeBlocoAte(')'); }
      this.avanca();
    }
    if (this.valor() === '->') {
      this.avanca();
      d.retType = this.tryTipo();
    }

    // Lista de inicialização de membros: `C() : x_(0), y_{1} {}`
    let baseInit = null;
    if (this.dentroDeClasse && this.valor() === ':') {
      this.avanca();
      baseInit = [];
      let guard = 0;
      while (guard++ < 1000 && this.este().type !== 'eof') {
        if (this.valor() === '{' || this.valor() === ')' || this.valor() === ';') break;
        const nome = this.este();
        if (nome.type === 'ident') this.avanca();
        const args = [];
        if (this.valor() === '(') {
          this.avanca();
          let g2 = 0;
          while (g2++ < 1000 && this.valor() !== ')' && this.este().type !== 'eof') {
            if (this.valor() === ',') { this.avanca(); continue; }
            const antes = this.i;
            args.push(this.atribuicao());
            if (this.i === antes) this.avancaOuConsome();
          }
          if (this.valor() === ')') this.avanca(); else this.erro("')'");
        } else if (this.valor() === '{') {
          // `y_{2}` — init-list sem parênteses, também válido
          args.push(...this.initList().elements);
        }
        baseInit.push(A.Assign(A.Identifier(String(nome.value ?? '')), A.InitList(args)));
        if (this.valor() === ',') { this.avanca(); continue; }
        break;
      }
    }
    d.baseInit = baseInit;

    let body = null;
    if (this.valor() === '{') {
      body = this.bloco();
    } else {
      this.consumeUm(';');
      if (this.valor() === '=') { // `= default` / `= delete`
        this.avanca();
        // Guardado no declarador: sem isso o unparse perdia a informação e o
        // round-trip não fechava.
        d.defaultDelete = String(this.valor() === 'default' || this.valor() === 'delete'
          ? this.valor() : this.valor());
        this.avanca();
      }
    }

    const extra = decls.slice(1);
    const fn = A.FunctionDecl(specs, d, body, this.loc(ini));
    if (extra.length > 0) {
      // `int f(), g();` — as extras viram declarações separadas.
      this.extrasDeFuncao = (this.extrasDeFuncao ?? []).concat(extra);
    }
    // restaura o contexto de retorno
    this.retornoAtual = retornoAnterior;
    return fn;
  }

  classSpec(specs, tag) {
    const ini = this.este();
    let nome = null;
    let bases = [];

    // nome pode ser um qualified-id
    if (this.este().type === 'ident' || this.este().type === 'type') {
      if (this.valor() === 'template') {
        this.foraDoEscopo(E.CONCEITO);
      }
      const nomeTok = this.este();
      nome = String(nomeTok.value);
      this.avanca();
      if (this.valor() === '<') this.tryTemplateArgs();
    }

    if (this.valor() === ':') {
      this.avanca();
      bases = this.listaBases();
    }

    const members = [];
    // P6: o nome da classe é TIPO dentro do próprio corpo — `struct S { S* p; }`
    // — e continua sendo depois. Registrar ANTES do corpo, não depois.
    this.declaraTipo(nome);
    if (this.valor() === '{') {
      this.avanca();
      const antes = this.dentroDeClasse;
      const classeAntes = this.classeAtual;
      this.dentroDeClasse = true;
      this.classeAtual = nome;
      members.push(...this.membros());
      this.dentroDeClasse = antes;
      this.classeAtual = classeAntes;
      if (this.valor() === '}') this.avanca();
      else this.erro("'}'");
      // `struct S { int x; };` — o `;` de fora também é nosso
      this.consumeUm(';');
    } else {
      this.consumeUm(';'); // declaração de classe adiante
    }

    // `struct { int x; };` — definição anônima solta não declara nada.
    // Só é válida com um declarador (`struct { int x; } var;`) ou dentro de
    // um typedef.
    if (!nome && !this.temDeclaradorApos) this.erro('identificador');

    return A.ClassDecl(specs, nome, members, { tagKind: tag, bases }, this.loc(ini));
  }

  listaBases() {
    const bases = [];
    let guard = 0;
    while (guard++ < 10000) {
      let access = null;
      if (this.valor() === 'public' || this.valor() === 'private' || this.valor() === 'virtual') {
        if (this.valor() !== 'virtual') access = String(this.valor());
        this.avanca();
      }
      if (this.valor() === '...') {
        this.avanca();
        bases.push(A.BaseSpecifier(null, access, [], true));
      } else if (this.este().type === 'ident' || this.este().type === 'type') {
        const nome = this.qualifiedName() ?? '';
        if (!nome) this.erro('identificador');
        const args = [];
        if (this.valor() === '<') {
          this.tentarArgsTemplate(args);
        }
        bases.push(A.BaseSpecifier(nome, access, args));
      } else {
        // `struct S : { ... }` — sinal de base sem nome de base
        this.erro('identificador');
        break;
      }
      if (this.valor() === ',') { this.avanca(); continue; }
      break;
    }
    return bases;
  }

  tentarArgsTemplate(saida) {
    if (this.valor() !== '<') return;
    this.avanca();
    let guard = 0;
    while (this.este().type !== 'eof' && this.valor() !== '>' && guard++ < 4096) {
      if (this.valor() === '>>') {
        const tk = this.este();
        this.tokens[this.i] = { ...tk, value: '>' };
        break;
      }
      if (this.valor() === ',') { this.avanca(); continue; }
      const antes = this.i;
      const t = this.tryTipo();
      if (t) saida.push(t);
      if (this.i === antes) this.avancaOuConsome();
    }
    if (this.valor() === '>') this.avanca();
  }

  membros() {
    const lista = [];
    let guard = 0;
    while (this.este().type !== 'eof' && this.valor() !== '}' && guard++ < 1000000) {
      const antes = this.i;
      const m = this.membro();
      if (m) lista.push(m);
      if (this.i === antes) this.avancaOuConsome();
    }
    return lista;
  }

  membro() {
    // public: / private: / protected:
    if (this.valor() === 'public' && this.olha(1).value === ':') {
      this.avanca(); this.avanca();
      return A.AccessSpec('public');
    }
    if (this.valor() === 'private' && this.olha(1).value === ':') {
      this.avanca(); this.avanca();
      return A.AccessSpec('private');
    }
    if (this.valor() === 'protected' && this.olha(1).value === ':') {
      this.avanca(); this.avanca();
      return A.AccessSpec('protected');
    }
    if (this.valor() === ';') { this.avanca(); return A.EmptyDecl(); }

    if (this.valor() === 'template') return this.templateDecl();
    if (this.valor() === 'using') return this.usingDecl();
    if (this.valor() === 'static_assert') return this.staticAssert();
    if (this.valor() === 'friend') {
      const ini = this.este();
      this.avanca();
      const d = this.membro();
      return A.FriendDecl([], d, this.loc(ini));
    }
    if (this.valor() === '[' && this.olha(1).value === '[') {
      this.foraDoEscopo(E.ATRIBUTO);
      while (this.este().type !== 'eof' && this.valor() !== ']') this.avancaOuConsome();
      this.consumeBlocoAte(']');
      return this.membro();
    }
    if (this.valor() === '~') {
      // destrutor: `~S()`. O nome da classe vem do `classSpec` em curso.
      const ini = this.este();
      const specs = this.especificadores();
      this.avanca(); // ~
      const d = this.declaratorSimples();
      if (d) {
        // `nomeDoDeclarador` guardou só `~`; o nome da classe vem de fora.
        if (!d.name || d.name === '~') d.name = `~${this.classeAtual ?? ''}`;
        d.temParams = true;
        const params = this.listaParametros();
        d.params = params; d.temParams = true;
      }
      this.consumeUm(';');
      if (this.valor() === '=') { this.avanca(); this.consumeUm('default'); this.consumeUm('delete'); this.consumeUm('0'); this.consumeUm(';'); }
      return A.FunctionDecl(specs, d, null, this.loc(ini));
    }

    const d = this.declaracaoSimples();
    return d;
  }

  enumSpec(specs) {
    const ini = this.este();
    let nome = null;
    if (this.este().type === 'ident' || this.este().type === 'type') {
      nome = String(this.este().value);
      this.avanca();
    }
    // `enum class E : int`
    if (this.valor() === ':') {
      this.avanca();
      this.tryTipo(true);
    }
    const enumeradores = [];
    if (this.valor() === '{') {
      this.avanca();
      let guard = 0;
      while (this.este().type !== 'eof' && this.valor() !== '}' && guard++ < 100000) {
        if (this.este().type !== 'ident') { this.avancaOuConsome(); continue; }
        const nomeE = this.este();
        this.avanca();
        let valor = null;
        if (this.valor() === '=') { this.avanca(); valor = this.constante(); }
        enumeradores.push(A.Enumerator(String(nomeE.value), valor));
        if (this.valor() === ',') { this.avanca(); continue; }
        if (this.valor() === '}') break;
        if (this.este().type !== 'ident') this.avancaOuConsome();
      }
      if (this.valor() === '}') this.avanca();
      else this.erro("'}'");
    }
    this.consumeUm(';');
    // P6: `enum E{}` declara `E` como NOME DE TIPO.
    this.declaraTipo(nome);
    return A.EnumDecl(specs, nome, enumeradores, {}, this.loc(ini));
  }

  // ---------------------------------------------------------- especificadores

  /**
   * Consome especificadores de declaração (`static const int`, `class`, …).
   * Devolve a lista na ordem do texto.
   *
   * `int`, `char`, `void` e companhia chegam do lexer como `keyword`, não
   * como `type` — `KEYWORDS` e `TYPES_BUILTIN` se sobrepõem e o lexer testa
   * `KEYWORDS` primeiro. Só `size_t` e os demais tipos de biblioteca saem
   * como `type`. Por isso aceitamos os dois, filtrados por
   * `TIPOS_BUILTIN_TEXT`.
   */
  especificadores(noTipo = true) {
    const lista = [];
    let guard = 0;
    while (guard++ < 1000) {
      const t = this.este();
      const v = String(t.value ?? '');
      const ehTipoLexico = t.type === 'type'
        || ((t.type === 'keyword' || t.type === 'ident') && TIPOS_BUILTIN_TEXT.has(v));

      if (ehTipoLexico) {
        lista.push(v); this.avanca(); continue;
      }
      if (t.type === 'keyword') {
        if (v === 'class' || v === 'struct' || v === 'enum' || v === 'typename') {
          lista.push(v); this.avanca(); continue;
        }
        if (PALAVRAS_ESPECIFICADOR.has(v)) {
          if (v === 'thread_local') this.foraDoEscopo(E.ALIGNAS);
          lista.push(v); this.avanca(); continue;
        }
        // `operator` é o COMEÇO DO NOME (`operator+`, `operator int()`),
        // não um especificador — tratá-lo como tal comia o nome.
        if (v === 'operator') break;
      }
      if (t.type === 'ident' && PALAVRAS_ESPECIFICADOR.has(v)) {
        lista.push(v); this.avanca(); continue;
      }
      if (t.type === 'ident' && (v === 'unsigned' || v === 'signed')) {
        lista.push(v); this.avanca(); continue;
      }
      // um nome de tipo definido pelo usuário, mas só se vier seguido de
      // identificador ou `::` — senão é o nome da variável
      if (this.isTypeName(noTipo)) {
        const nome = this.comeQualquerNome(noTipo);
        if (nome) { lista.push(nome); continue; }
      }
      break;
    }
    return lista;
  }

  /**
   * Consome um nome (identificador, tipo ou qualificado) como especificador.
   *
   * O ponto delicado: em `int f()`, o `f` NÃO é um tipo — é o declarador.
   * Um tipo definido pelo usuário é seguido por outra coisa que continue o
   * TIPO (outro identificador, `::`, `*`, `&`, `[`). Se o que vem depois é
   * `(`, é lista de parâmetros de função e é obrigatório PARAR aqui — senão
   * `int f()` perde o nome e vira `int()`.
   */
  comeQualquerNome(noTipo = false) {
    const t = this.este();
    if (t.type !== 'ident' && t.type !== 'type') return null;
    const nome = String(t.value);
    if (PALAVRAS_ESPECIFICADOR.has(nome) || TIPOS_BUILTIN_TEXT.has(nome)) return null;
    const prox = this.olha(1);
    // `[` NÃO continua um tipo: em `int arr[10]` o `[` vem depois do
    // declarador. Aceitar aqui fazia `arr` virar especificador e o
    // declarador ficava sem nome.
    const continua = prox.type === 'ident' || prox.type === 'type'
      || ['*', '&', '::'].includes(String(prox.value))
      // `Vec3 operator+(...)` — `Vec3` é o tipo de retorno e `operator` começa
      // o nome. Sem esta linha `Vec3` não é reconhecido como especificador.
      || String(prox.value) === 'operator'
      // `new T(1)`, `new T{1}` — só no contexto de `new`, onde o que segue o
      // tipo é o construtor. Em `especificadores` normal (`noTipo` verdadeiro
      // por padrão para listas de parâmetros) isto seria ambiguo demais.
      || (this.emNew && ['(', '{'].includes(String(prox.value)))
      // `S<int> x;` — `<` só continua se fechar antes de qualquer `;`
      || (String(prox.value) === '<' && this.eListaTemplateArgs(1));
    if (!continua) return null;
    this.avanca();
    let texto = nome;
    if (this.valor() === '::') {
      this.avanca();
      const t2 = this.este();
      // `std::string` — `string` é `keyword` (está em NOMES_STD), não
      // `ident`. Sem aceitar keyword aqui, `std::string out;` não tem tipo.
      if (t2.type === 'ident' || t2.type === 'type' || t2.type === 'keyword') {
        texto += `::${this.valor()}`;
        this.avanca();
      }
    }
    if (this.valor() === '<') this.tryTemplateArgs();
    return texto;
  }

  // ---------------------------------------------------------- declaradores

  /** `int a, b, c` → lista de declaradores. */
  listaDeclaradores(opts = {}) {
    const lista = [];
    let guard = 0;
    while (guard++ < 10000) {
      const d = this.declaratorSimples(opts);
      if (d) lista.push(d);
      if (this.valor() === ',') { this.avanca(); continue; }
      break;
    }
    return lista;
  }

  /**
   * Declarador concreto ou abstrato.
   *
   * `noTipo` liga o modo de lista de parâmetros: dentro dele um identificador
   * solto é um TIPO, não o nome da variável. É o que desambigua
   * `int f(T)` (T é tipo) de `int f(x)` (variável).
   */
  declaratorSimples(opts = {}) {
    const noTipo = opts.noTipo ?? false;
    const antes = this.i;
    let d = this.declaratorAbstrato(opts);
    if (!d) return null;
    // `int (*f)(int)` — o nome está no declarador INTERNO. Procurar um nome
    // aqui tentaria consumir `(int)` como se fosse o nome.
    if (!opts.somenteTipo && !d.inner) d = this.nomeDoDeclarator(d, noTipo, opts);
    // Se `declaratorAbstrato` já consumiu `[`/`(` ANTES de vermos um nome,
    // isto é um declarador abstrato — inválido onde a gramática exige nome
    // (`int [3] a;`).
    // O sufixo veio ANTES do nome: `int [3] a;` é declarador abstrato usado
    // onde a gramática exige nome. Em `int (*f)(int)` isso é normal — o
    // sufixo abre com `(` e o nome está no declarador interno.
    d.absAntesDoNome = opts.abstract !== true && !!d.temSufixoAntes
      && d.inner === null;
    return d;
  }

  /**
   * A parte de prefixes de um declarador: `*`, `&`, `&&`, com cv, e
   * `(*name)(params)` para ponteiro de função.
   */
  declaratorAbstrato(opts = {}) {
    const d = A.Declarator(null, { packs: !!opts.packs });
    let guard = 0;
    while (guard++ < 1000) {
      const v = this.valor();
      if (v === '*') {
        this.avanca();
        const p = A.PtrOperator('*');
        while (PALAVRAS_CV.has(this.valor())) {
          if (this.valor() === 'const') p.cvConst = true;
          if (this.valor() === 'volatile') p.cvVolatile = true;
          this.avanca();
        }
        d.ptr.push(p);
        continue;
      }
      if (v === '&') { this.avanca(); d.ptr.push(A.PtrOperator('&')); continue; }
      if (v === '&&') {
        // `&&` como referência. Num declarador não há comparação, então
        // qualquer `&&` aqui é referência a右 valor.
        this.avanca(); d.ptr.push(A.PtrOperator('&&')); continue;
      }
      // `(*nome)` : ponteiro para função ou array
      if (v === '(' && (this.olha(1).value === '*' || this.olha(1).value === '&')) {
        this.avanca(); // (
        // `noTipo: false`: dentro dos parênteses o identificador é o NOME
        // (`(*f)`), não um tipo.
        const inner = this.declaratorSimples();
        if (this.valor() === ')') this.avanca();
        else this.erro("')'");
        d.inner = inner;
        continue;
      }
      break;
    }

    // sufixos: `[N]` e `(params)`
    const antesSufixo = this.i;
    this.sufixosDeDeclarador(d, /* permitirParams */ true);
    d.temSufixoAntes = this.i !== antesSufixo;

    return d;
  }

  /**
   * Sufixos de declarador: `[N]`, `(params)`, cv, noexcept, ref-qualifier.
   *
   * Chamado duas vezes: uma antes do nome (para declaradores abstratos como
   * `int (*)(int)`) e uma depois (para `f(int) const`, onde os parênteses só
   * aparecem DEPOIS do identificador).
   */
  sufixosDeDeclarador(d, permitirParams = true) {
    let g2 = 0;
    while (g2++ < 1000) {
      // `[[` é atributo C++20, não array. `int x [[deprecated]];`
      if (this.valor() === '[' && this.olha(1).value === '[') break;
      if (this.valor() === '[') {
        this.avanca();
        if (this.valor() === ']') { this.avanca(); d.array.push(null); continue; }
        const n = this.constante();
        if (this.valor() === ']') this.avanca();
        else this.erro("']'");
        d.array.push(n);
        continue;
      }
      if (this.valor() === '(' && permitirParams && this.eListaDeParametros()) {
        this.avanca();
        d.params = this.listaParametros();
        d.temParams = true;
        // Qualificadores cv e noexcept
        let g3 = 0;
        while (g3++ < 100) {
          if (this.valor() === 'const') { d.cvConst = true; this.avanca(); continue; }
          if (this.valor() === 'volatile') { d.cvVolatile = true; this.avanca(); continue; }
          if (this.valor() === 'noexcept') {
            this.avanca();
            if (this.valor() === '(') this.consumeBlocoAte(')');
            continue;
          }
          if (this.valor() === '&' && this.olha(1).value !== '&') { d.refQual = 'lvalue'; this.avanca(); continue; }
          if (this.valor() === '&&') { d.refQual = 'rvalue'; this.avanca(); continue; }
          if (this.valor() === 'throw') {
            this.avanca();
            if (this.valor() === '(') this.consumeBlocoAte(')');
            continue;
          }
          break;
        }
        continue;
      }
      break;
    }
    return d;
  }

  /** Erro `]` faltando. Existe separado para não confundir com o genérico. */
  erco(espera) {
    return this.erro(espera);
  }

  /** O `(` atual abre uma lista de parâmetros (e não uma chamada/expressão)? */
  eListaDeParametros() {
    if (this.valor() !== '(') return false;
    const prox = this.olha(1);
    if (prox.value === ')') return true;
    if (prox.type === 'type') return true;
    // `int`, `const`, `void` chegam como keyword, não como type
    if (prox.type === 'keyword'
      && (TIPOS_BUILTIN_TEXT.has(String(prox.value)) || PALAVRAS_CV.has(String(prox.value)))) {
      return true;
    }
    if (prox.type === 'ident') {
      const nome = String(prox.value);
      if (TIPOS_BUILTIN_TEXT.has(nome)) return true;
      // `MeuTipo x`, `ns::T x`
      if (this.olha(2).value === '::') return true;
      if (this.olha(2).value === '*' || this.olha(2).value === '&') return true;
      if (this.olha(2).value === '&' && this.olha(3).value === '&') return true;
      if (nome[0] >= 'A' && nome[0] <= 'Z' && nome.length > 1) return true;
      // `isTypeName` olha o token ATUAL, que aqui ainda é `(`. O token que
      // importa é o seguinte.
      if (this.isTypeName(true, 1)) return true;
    }
    if (prox.value === '...') return true; // C em C++
    if (prox.value === '[') return true;   // array como parâmetro em C
    return false;
  }

  /**
   * O nome depois dos prefixes de um declarador. No modo `noTipo` (lista de
   * parâmetros) um identificador solto é TIPO, então não vira nome.
   */
  nomeDoDeclarator(d, noTipo, opts = {}) {
    const t = this.este();
    const ehNome = t.type === 'ident' || t.type === 'type' || t.type === 'keyword'
      || this.valor() === '~' || this.valor() === 'operator';

    if (ehNome && !noTipo) {
      // `~S()` — o `t` capturado é o `~`; sobrescrever com ele perderia o
      // nome da classe. Marcamos e deixamos o nome montado à parte.
      const ehDestrutor = this.valor() === '~';
      if (ehDestrutor) { this.avanca(); d.name = '~'; }
      if (ehDestrutor) {
        if (this.este().type === 'ident' || this.este().type === 'type') this.avanca();
      } else if (this.valor() === 'operator') {
        this.avanca();
        let nome = 'operator';
        // `operator int()`, `operator+`, `operator[]`, `operator bool`
        if (this.este().type === 'type' || this.este().type === 'keyword') {
          nome += this.valor();
          this.avanca();
          if (this.valor() === '*') { nome += '*'; this.avanca(); }
          if (this.valor() === '&') { nome += '&'; this.avanca(); }
          if (this.valor() === 'const') { nome += ' const'; this.avanca(); }
        } else {
          // `operator()`, `operator[]`, `operator<=>`, `operator->*`: o par de
          // delimitadores fecha o nome. `operator+(` NÃO consome o `(` — ali
          // ele abre a lista de parâmetros, não o nome `operator()`.
          const delim = this.valor();
          nome += delim;
          this.avanca();
          const fecha = delim === '(' ? ')' : (delim === '[' ? ']' : null);
          if (fecha !== null && this.valor() === fecha) {
            nome += fecha;
            this.avanca();
          }
        }
        d.name = nome;
      } else {
        d.name = String(t.value);
        this.avanca();
      }
      if (this.valor() === '<') this.tryTemplateArgs();
    }

    // Sobraram sufixos depois do nome: `int a[3]`, `int f() const`.
    this.sufixosDeDeclarador(d, true);
    // bit-field: `int x : 1;`  (`::` é escopo, não bit-field).
    // Em `for (int x : v)` o `:` é do range-for, daí o flag. E em
    // `C() : x_(1)` o `:` é a LISTA DE INICIALIZAÇÃO — por isso bit-field
    // exige declarador SEM parâmetros: função não tem bit-field.
    if (this.valor() === ':' && this.olha(1).value !== ':'
      && !opts.semBitField && !d.temParams && d.params.length === 0) {
      this.avanca();
      this.constante();
    }
    return d;
  }

  /**
   * Lista de parâmetros. Cada um vira um `VariableDecl` com seus
   * especificadores, porque `int a` perde o `int` se guardarmos só o nome.
   */
  listaParametros() {
    const params = [];
    let guard = 0;
    while (this.este().type !== 'eof' && this.valor() !== ')' && guard++ < 10000) {
      if (this.valor() === '...') {
        this.avanca();
        params.push(A.VariableDecl(['...'], [A.Declarator(null)]));
        continue;
      }
      const antes = this.i;
      // `int`, `const char*`, `T`, `std::vector<int>`
      // `noTipo: true` acima (nos especificadores) trata `S` como TIPO; aqui o
      // `s` de `int f(S s)` é o NOME da variável, então `noTipo` é falso.
      const specs = this.especificadores(true);
      const d = this.declaratorSimples();
      if (d && (d.name || d.ptr.length || d.array.length) && specs.length > 0) {
        params.push(A.VariableDecl(specs, [d]));
      } else if (d && (d.name || d.ptr.length || d.array.length)) {
        // parâmetro com nome mas SEM tipo: `int f(int a,);`
        this.erro('tipo');
        params.push(A.VariableDecl(specs, [d]));
      } else if (specs.length > 0) {
        // `void f(int)` — tipo sem nome
        const semNome = A.Declarator(null);
        semNome.ptr = d ? d.ptr : [];
        semNome.array = d ? d.array : [];
        params.push(A.VariableDecl(specs, [semNome]));
      }
      if (this.valor() === '=') { this.avanca(); this.constante(); }
      if (this.valor() === ',') {
        this.avanca();
        if (this.valor() === ')') this.erro('tipo'); // `int f(int a,);`
        continue;
      }
      if (this.i === antes) this.avancaOuConsome();
    }
    if (this.valor() === ')') this.avanca();
    else this.erro("')'");
    return params;
  }

  // ================================================================
  // Statements
  // ================================================================

  bloco() {
    if (this.valor() !== '{') {
      this.erro("'{'");
      return A.CompoundStmt([]);
    }
    this.avanca();
    // P6: o corpo de função é um ESCOPO de nomes de tipo. `struct Local{}`
    // declarado dentro dele é tipo aqui e NUNCA fora (teste P6-S01).
    this.abreEscopoTipos();
    const stmts = [];
    let guard = 0;
    try {
      while (this.este().type !== 'eof' && this.valor() !== '}' && guard++ < 1000000) {
        const antes = this.i;
        const s = this.statement();
        if (s) stmts.push(s);
        if (this.i === antes) {
          this.erro('statement');
          this.avancaOuConsome();
        }
      }
    } finally {
      this.fechaEscopoTipos();
    }
    if (this.valor() === '}') this.avanca();
    else this.erro("'}'");
    return A.CompoundStmt(stmts);
  }

  statement() {
    const ini = this.este();
    const v = this.valor();

    if (v === '{') return this.bloco();
    if (v === ';') { this.avanca(); return A.NullStmt(); }
    if (v === '}') return null;

    if (this.este().type === 'keyword') {
      switch (v) {
        case 'if': return this.ifStmt();
        case 'while': return this.whileStmt();
        case 'do': return this.doStmt();
        case 'for': return this.forStmt();
        case 'switch': return this.switchStmt();
        case 'case': return this.caseStmt();
        case 'default': return this.defaultStmt();
        case 'break': this.avanca(); this.consumeUm(';'); return A.BreakStmt();
        case 'continue': this.avanca(); this.consumeUm(';'); return A.ContinueStmt();
        case 'return': return this.returnStmt();
        case 'goto': return this.gotoStmt();
        case 'try': return this.tryStmt();
        case 'throw': {
          this.avanca();
          const e = this.valor() === ';' ? null : this.expressao();
          this.consumeUm(';');
          return A.ExprStmt(A.ThrowExpr(e), this.loc(ini));
        }
        case 'using': return A.DeclStmt(this.usingDecl(), this.loc(ini));
        case 'namespace': return A.DeclStmt(this.namespaceDecl(), this.loc(ini));
        case 'template': return A.DeclStmt(this.templateDecl(), this.loc(ini));
        case 'static_assert': return A.DeclStmt(this.staticAssert(), this.loc(ini));
        case 'asm': {
          this.foraDoEscopo(E.ASM);
          this.avanca();
          this.consumeBlocoAte(';');
          return A.EmptyDecl();
        }
        case 'consteval': case 'constinit': case 'co_await': case 'co_yield':
        case 'co_return': {
          this.foraDoEscopo(v === 'co_return' ? E.COROUTINA : E.GENERICO);
          this.avanca();
          return this.statement();
        }
        case 'goto': return this.gotoStmt();
        default: break;
      }
      if (v === 'alignas' || v === 'thread_local') {
        this.foraDoEscopo(E.ALIGNAS);
        this.avanca();
        if (this.valor() === '(') this.consumeBlocoAte(')');
        if (this.valor() === ',') { this.avanca(); return this.statement(); }
        return this.statement();
      }
    }

    // rótulo: `ident :` (não é `ident ::`)
    if (this.este().type === 'ident' && this.olha(1).value === ':'
      && this.olha(2).value !== ':') {
      const label = String(this.este().value);
      this.avanca(); this.avanca();
      this.foraDoEscopo(E.GOTO);
      const body = this.valor() === '}' ? null : this.statement();
      return A.LabeledStmt(label, body, this.loc(ini));
    }

    // `[atributo]` antes de statement
    if (v === '[' && this.olha(1).value === '[') {
      this.foraDoEscopo(E.ATRIBUTO);
      while (this.este().type !== 'eof' && this.valor() !== ']') this.avancaOuConsome();
      this.consumeBlocoAte(']');
      return this.statement();
    }

    // Declaração ou expressão? Se vier um especificador de tipo, é declaração.
    if (this.eDeclaracao()) {
      const d = this.declaracaoSimples();
      if (d) return A.DeclStmt(d, this.loc(ini));
    }

    const e = this.expressao();
    if (this.valor() !== ';') this.erro("';'");
    else this.avanca();
    return A.ExprStmt(e, this.loc(ini));
  }

  /** O que vem agora é uma declaração, e não uma expressão? */
  eDeclaracao() {
    const t = this.este();
    const v = String(t.value ?? '');
    if (t.type === 'type') return true;
    if (t.type === 'keyword') {
      // `int`, `void`, `auto` chegam como keyword, não como type
      if (TIPOS_BUILTIN_TEXT.has(v) || PALAVRAS_ESPECIFICADOR.has(v)) return true;
      return ['class', 'struct', 'union', 'enum', 'typedef', 'namespace',
        'template', 'using', 'static_assert', 'export', 'decltype'].includes(v);
    }
    if (t.type !== 'ident') return false;
    if (PALAVRAS_ESPECIFICADOR.has(v)) return true;
    if (v === 'unsigned' || v === 'signed') return true;
    // Qualquer nome que `isTypeName` reconhece como tipo inicia uma
    // declaração. Delegar aqui cobre `MeuTipo x;`, `std::string out;` e
    // `T x{};` sem duplicar a heurística de maiúscula em dois lugares.
    if (this.isTypeName()) return true;
    // `MeuTipo x;` — identificador capitalizado seguido de identificador
    if (v[0] >= 'A' && v[0] <= 'Z' && v.length > 1) {
      const prox = this.olha(1);
      if (prox.type === 'ident' && !['.match', '.matches'].includes(String(prox.value))) {
        return !['(', '.', '[', '::', '+', '-', '*', '/', '%', '<', '>', '==', '!=',
          '<=', '>=', '&&', '||', '<<', '>>', '=', '+='].includes(String(prox.value));
      }
      if (prox.value === '::') return true;
      // `Vec3 operator+(...)` — `operator` é keyword, não ident, então a
      // regra de identificador-capitalizado acima não pega. `MeuTipo operator+`
      // ainda é declaração.
      if (prox.value === 'operator') return true;
    }
    return false;
  }

  ifStmt() {
    const ini = this.este();
    this.avanca(); // if
    // `if constexpr (x)` / `if consteval`
    this.consumeUm('constexpr');
    this.consumeUm('consteval');
    if (this.valor() !== '(') { this.erro("'('"); return A.IfStmt(null, A.NullStmt(), null, {}, this.loc(ini)); }
    this.avanca();

    let condInit = null;
    let cond = null;
    if (this.eDeclaracao()) {
      const d = this.declaracaoSimples();
      condInit = d;
      cond = d?.init ?? null;
    } else {
      cond = this.expressao();
    }
    if (this.valor() === ')') this.avanca();
    else this.erro("')'");

    const then = this.statement() ?? A.NullStmt();
    let els = null;
    if (this.valor() === 'else') {
      this.avanca();
      els = this.statement() ?? A.NullStmt();
    }
    return A.IfStmt(cond, then, els, { condInit }, this.loc(ini));
  }

  whileStmt() {
    const ini = this.este();
    this.avanca();
    if (this.valor() !== '(') { this.erro("'('"); return A.WhileStmt(null, A.NullStmt()); }
    this.avanca();
    const cond = this.expressao();
    if (this.valor() === ')') this.avanca();
    else this.erro("')'");
    const body = this.statement() ?? A.NullStmt();
    return A.WhileStmt(cond, body, this.loc(ini));
  }

  doStmt() {
    const ini = this.este();
    this.avanca();
    const body = this.statement() ?? A.NullStmt();
    if (this.valor() === 'while') this.avanca();
    else this.erro("'while'");
    if (this.valor() === '(') this.avanca(); else this.erro("'('");
    const cond = this.expressao();
    if (this.valor() === ')') this.avanca();
    else this.erro("')'");
    if (this.valor() === ';') this.avanca();
    else this.erro("';'");
    return A.DoStmt(body, cond, this.loc(ini));
  }

  forStmt() {
    const ini = this.este();
    this.avanca();
    if (this.valor() !== '(') { this.erro("'('"); return A.ForStmt(null, null, null, A.NullStmt()); }
    this.avanca();

    // range-for? `for (T x : range)`
    const save = this.i;
    let decl = null;
    let range = null;

    let ehRange = false;
    if (this.eDeclaracao()) {
      const d = this.declaracaoSimples({ semPontoEVirgula: true, semBitField: true });
      if (d && this.valor() === ':') { decl = d; ehRange = true; }
      else { this.i = save; }
    }
    if (!ehRange) {
      // `for (x : v)` sem tipo declarado
      const antes = this.i;
      const e = this.tryExpressaoSimples();
      if (e && this.valor() === ':') { range = e; ehRange = true; }
      else this.i = antes;
    }
    if (ehRange) {
      this.avanca(); // :
      if (!range) range = this.expressao();
      if (this.valor() === ')') this.avanca(); else this.erro("')'");
      const body = this.statement() ?? A.NullStmt();
      return A.RangeForStmt(decl, range, body, this.loc(ini));
    }

    // for normal
    let init = null;
    if (this.valor() !== ';') {
      if (this.eDeclaracao()) {
        const d = this.declaracaoSimples({ semPontoEVirgula: true, semBitField: true });
        init = A.DeclStmt(d);
      } else {
        init = A.ExprStmt(this.expressao());
      }
    }
    if (this.valor() === ';') this.avanca(); else this.erro("';'");

    const cond = this.valor() === ';' ? null : this.expressao();
    if (this.valor() === ';') this.avanca(); else this.erro("';'");

    const update = this.valor() === ')' ? null : this.expressao();
    if (this.valor() === ')') this.avanca(); else this.erro("')'");

    const body = this.statement();
    if (!body) this.erro('statement');
    return A.ForStmt(init, cond, update, body ?? A.NullStmt(), this.loc(ini));
  }

  switchStmt() {
    const ini = this.este();
    this.avanca();
    if (this.valor() !== '(') { this.erro("'('"); return A.SwitchStmt(null, []); }
    this.avanca();
    let init = null;
    let cond = null;
    if (this.eDeclaracao()) {
      const d = this.declaracaoSimples();
      init = d;
      cond = d?.init ?? null;
    } else {
      cond = this.expressao();
    }
    if (this.valor() === ')') this.avanca(); else this.erro("')'");

    const cases = [];
    if (this.valor() === '{') {
      this.avanca();
      let guard = 0;
      while (this.este().type !== 'eof' && this.valor() !== '}' && guard++ < 100000) {
        const antes = this.i;
        if (this.valor() === 'case') {
          const c = this.caseStmt();
          if (c) cases.push(c);
        } else if (this.valor() === 'default') {
          const c = this.defaultStmt();
          if (c) cases.push(c);
        } else {
          const s = this.statement();
          void s;
        }
        if (this.i === antes) this.avancaOuConsome();
      }
      if (this.valor() === '}') this.avanca(); else this.erro("'}'");
    } else {
      this.erro("'{'");
    }
    return A.SwitchStmt(cond, cases, init, this.loc(ini));
  }

  caseStmt() {
    const ini = this.este();
    this.avanca(); // case
    const valor = this.constante();
    if (this.valor() === ':') this.avanca();
    else this.erro("':'");
    const corpo = [];
    let guard = 0;
    while (guard++ < 100000) {
      if (this.este().type === 'eof' || this.valor() === '}'
        || this.valor() === 'case' || this.valor() === 'default') break;
      const antes = this.i;
      const s = this.statement();
      if (s) corpo.push(s);
      if (this.i === antes) this.avancaOuConsome();
    }
    // `case 1: { ... }` — um único bloco É o corpo. Embrulhar de novo
    // fazia o round-trip aninhar um `{` a cada passada.
    const corpoUnico = (corpo.length === 1 && corpo[0].kind === 'CompoundStmt')
      ? corpo[0] : A.CompoundStmt(corpo);
    return A.CaseStmt(valor, corpoUnico, this.loc(ini));
  }

  defaultStmt() {
    const ini = this.este();
    this.avanca(); // default
    if (this.valor() === ':') this.avanca();
    else this.erro("':'");
    const corpo = [];
    let guard = 0;
    while (guard++ < 100000) {
      if (this.este().type === 'eof' || this.valor() === '}'
        || this.valor() === 'case' || this.valor() === 'default') break;
      const antes = this.i;
      const s = this.statement();
      if (s) corpo.push(s);
      if (this.i === antes) this.avancaOuConsome();
    }
    const corpoUnico = (corpo.length === 1 && corpo[0].kind === 'CompoundStmt')
      ? corpo[0] : A.CompoundStmt(corpo);
    return A.DefaultStmt(corpoUnico, this.loc(ini));
  }

  returnStmt() {
    const ini = this.este();
    this.avanca(); // return
    const e = this.valor() === ';' ? null : this.expressao();
    // `return;` sem valor só é válido em função que retorna void. g++
    // rejeita `int f() { return; }`; nós também.
    if (e === null && this.retornoAtual && this.retornoAtual !== 'void') {
      this.erro('expressão');
    }
    if (this.valor() === ';') this.avanca();
    else this.erro("';'");
    return A.ReturnStmt(e, this.loc(ini));
  }

  gotoStmt() {
    const ini = this.este();
    this.foraDoEscopo(E.GOTO);
    this.avanca(); // goto
    const label = this.este().type === 'ident' ? String(this.este().value) : null;
    if (label) this.avanca();
    this.consumeUm(';');
    return A.GotoStmt(label, this.loc(ini));
  }

  tryStmt() {
    const ini = this.este();
    this.avanca(); // try
    const body = this.bloco();
    const catches = [];
    let guard = 0;
    while (guard++ < 100) {
      if (this.valor() === 'catch') {
        const cIni = this.este();
        this.avanca();
        if (this.valor() === '(') this.avanca();
        const specs = [];
        let d = null;
        if (this.eDeclaracao()) {
          specs.push(...this.especificadores(true));
          d = this.declaratorSimples({ noTipo: true });
        } else {
          this.consumeUm('...');
        }
        if (this.valor() === ')') this.avanca();
        else this.erro("')'");
        const cbody = this.bloco();
        catches.push(A.CatchClause(d ? A.VariableDecl(specs, [d]) : null, cbody, this.loc(cIni)));
        continue;
      }
      break;
    }
    return A.TryStmt(body, catches, this.loc(ini));
  }

  // ================================================================
  // Expressões
  // ================================================================

  /**
   * Expressão completa, com o operador vírgula no nível mais baixo.
   * `a, b, c` é uma expressão; dentro de argumentos de chamada é que a
   * vírgula separa argumentos.
   */
  expressao() {
    let e = this.atribuicao();
    while (this.valor() === ',') {
      const ini = this.este();
      this.avanca();
      const d = this.atribuicao();
      e = A.Binary(',', e, d, this.loc(ini));
    }
    return e;
  }

  /** Versão que nunca exige `;` depois — usada por `for` e por tentativas. */
  tryExpressaoSimples() {
    const antes = this.i;
    const n = this.diagnostics.length;
    const e = this.atribuicao();
    if (this.i === antes && this.diagnostics.length === n) return e;
    if (this.diagnostics.length > n) { this.diagnostics.length = n; this.i = antes; return null; }
    return e;
  }

  atribuicao() {
    const esquerda = this.condicional();
    const v = this.valor();
    const ops = ['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '^=', '|='];
    if (ops.includes(v)) {
      const ini = this.este();
      this.avanca();
      const direita = this.atribuicao();
      return A.Assign(esquerda, direita, v, this.loc(ini));
    }
    return esquerda;
  }

  condicional() {
    const cond = this.binarioOu();
    if (this.valor() !== '?') return cond;
    const ini = this.este();
    this.avanca();
    const a = this.expressao();
    if (this.valor() === ':') this.avanca();
    else this.erro("':'");
    const b = this.atribuicao();
    return A.Ternary(cond, a, b, this.loc(ini));
  }

  binarioOu() { return this.binarioNivel(0); }

  /**
   * Climbing de precedência: cada nível da tabela sabe quais operadores
   * aceita. Um laço por nível, cada um consumindo token — nunca trava.
   */
  binarioNivel(nivel) {
    const nivelAtual = nivel === 0
      ? this.binarioOuNivel()
      : (nivel === 1 ? this.logicoE() : this.binarioCom(this.nivelAtual(nivel)));
    return nivelAtual;
  }

  nivelAtual(n) { return n; }

  binarioOuNivel() {
    let esq = this.logicoE();
    while (this.valor() === '||') {
      const ini = this.este();
      this.avanca();
      const dir = this.logicoE();
      esq = A.Binary('||', esq, dir, this.loc(ini));
    }
    return esq;
  }

  logicoE() {
    let esq = this.bitwiseOu();
    while (this.valor() === '&&') {
      const ini = this.este();
      this.avanca();
      const dir = this.bitwiseOu();
      esq = A.Binary('&&', esq, dir, this.loc(ini));
    }
    return esq;
  }

  bitwiseOu() {
    let esq = this.bitwiseXor();
    while (this.valor() === '|' && this.valor() !== '||') {
      const ini = this.este();
      this.avanca();
      esq = A.Binary('|', esq, this.bitwiseXor(), this.loc(ini));
    }
    return esq;
  }

  bitwiseXor() {
    let esq = this.bitwiseE();
    while (this.valor() === '^') {
      const ini = this.este();
      this.avanca();
      esq = A.Binary('^', esq, this.bitwiseE(), this.loc(ini));
    }
    return esq;
  }

  bitwiseE() {
    let esq = this.igualdade();
    while (this.valor() === '&' && this.valor() !== '&&') {
      const ini = this.este();
      this.avanca();
      esq = A.Binary('&', esq, this.igualdade(), this.loc(ini));
    }
    return esq;
  }

  igualdade() {
    let esq = this.relacional();
    while (this.valor() === '==' || this.valor() === '!=') {
      const ini = this.este();
      const op = this.valor();
      this.avanca();
      esq = A.Binary(op, esq, this.relacional(), this.loc(ini));
    }
    return esq;
  }

  relacional() {
    let esq = this.shift();
    while (['<', '>', '<=', '>='].includes(this.valor())) {
      const ini = this.este();
      const op = this.valor();
      // `>` não fecha template aqui: já foi tratado nos declaradores
      this.avanca();
      esq = A.Binary(op, esq, this.shift(), this.loc(ini));
    }
    return esq;
  }

  shift() {
    let esq = this.aditivo();
    while (this.valor() === '<<' || this.valor() === '>>') {
      const ini = this.este();
      const op = this.valor();
      this.avanca();
      esq = A.Binary(op, esq, this.aditivo(), this.loc(ini));
    }
    return esq;
  }

  aditivo() {
    let esq = this.multiplicativo();
    while (this.valor() === '+' || this.valor() === '-') {
      const ini = this.este();
      const op = this.valor();
      this.avanca();
      esq = A.Binary(op, esq, this.multiplicativo(), this.loc(ini));
    }
    return esq;
  }

  multiplicativo() {
    let esq = this.unario();
    while (this.valor() === '*' || this.valor() === '/' || this.valor() === '%') {
      const ini = this.este();
      const op = this.valor();
      this.avanca();
      esq = A.Binary(op, esq, this.unario(), this.loc(ini));
    }
    return esq;
  }

  unario() {
    const v = this.valor();
    const t = this.este();

    if (v === '++' || v === '--') {
      const ini = t; this.avanca();
      return A.Unary(v, this.unario(), true, this.loc(ini));
    }
    if (v === '!' || v === '-' || v === '+' || v === '~') {
      const ini = t; this.avanca();
      return A.Unary(v, this.unario(), true, this.loc(ini));
    }
    if (v === '*' || v === '&') {
      const ini = t;
      // `int x = * 1;` — um literal nunca é ponteiro. g++ rejeita; nós também.
      const alvo = this.olha(1);
      this.avanca();
      if (alvo.type === 'number' || alvo.type === 'char' || alvo.type === 'string') {
        this.erro('expressão');
      }
      return A.Unary(v, this.unario(), true, this.loc(ini));
    }
    if (v === 'sizeof') {
      const ini = t; this.avanca();
      if (this.valor() === '(') {
        const save = this.i;
        this.avanca();
        if (this.isTypeName(true)) {
          const tipo = this.tryTipo();
          if (this.valor() === ')') { this.avanca(); return A.Sizeof(tipo, true, this.loc(ini)); }
        }
        this.i = save;
      }
      return A.Sizeof(this.unario(), false, this.loc(ini));
    }
    if (v === 'alignof') {
      const ini = t; this.avanca();
      if (this.valor() === '(') {
        const save = this.i;
        this.avanca();
        if (this.isTypeName(true)) {
          const tipo = this.tryTipo();
          if (this.valor() === ')') { this.avanca(); return A.Alignof(tipo, true, this.loc(ini)); }
        }
        this.i = save;
      }
      return A.Alignof(this.unario(), false, this.loc(ini));
    }
    if (v === 'new') return this.newExpr();
    if (v === 'delete') return this.deleteExpr();
    if (v === 'throw') {
      const ini = t; this.avanca();
      const e = (this.valor() === ')' || this.valor() === ';' || this.valor() === ',')
        ? null : this.atribuicao();
      return A.ThrowExpr(e, this.loc(ini));
    }
    if (v === 'noexcept') {
      const ini = t; this.avanca();
      if (this.valor() === '(') {
        const save = this.i;
        this.avanca();
        if (this.isTypeName(true)) {
          const tipo = this.tryTipo();
          if (this.valor() === ')') { this.avanca(); return A.Noexcept(tipo, this.loc(ini)); }
        }
        this.i = save;
        this.avanca(); // (
        const e = this.expressao();
        if (this.valor() === ')') this.avanca();
        return A.Noexcept(e, this.loc(ini));
      }
      return A.Noexcept(null, this.loc(ini));
    }
    // `co_await` etc
    if (t.type === 'keyword' && ['co_await', 'co_yield', 'co_return'].includes(v)) {
      this.foraDoEscopo(E.COROUTINA);
      this.avanca();
      return this.unario();
    }

    // Cast nomeado: `static_cast<T>(e)`
    const nomeado = this.castNomeado();
    if (nomeado) return nomeado;

    // Cast no estilo C: `(T)expr`
    if (v === '(') {
      const cast = this.tentaCast();
      if (cast) return cast;
    }

    // `std::function<int(int)>` — é tipo, não expressão
    return this.posfixo();
  }

  /** `static_cast<T>(e)`, `const_cast`, `reinterpret_cast`, `dynamic_cast`. */
  castNomeado() {
    const estilo = this.valor();
    if (!['static_cast', 'const_cast', 'reinterpret_cast', 'dynamic_cast']
      .includes(estilo)) return null;
    const ini = this.este();
    this.avanca(); // static_cast
    if (this.valor() !== '<') return null;
    this.avanca();
    const tipo = this.tryTipo(true);
    if (!tipo) return null;
    let guard = 0;
    while (guard++ < 100 && this.valor() !== '>' && this.este().type !== 'eof') {
      if (this.valor() === '>>') {
        const tk = this.este();
        this.tokens[this.i] = { ...tk, value: '>' };
        break;
      }
      const antes = this.i;
      const t = this.tryTipo(true);
      void t;
      if (this.i === antes) this.avancaOuConsome();
    }
    if (this.valor() === '>') this.avanca();
    else { this.erro("'>'"); return null; }
    if (this.valor() !== '(') { this.erro("'('"); return null; }
    this.avanca();
    let e = null;
    if (this.valor() !== ')') e = this.expressao();
    if (this.valor() === ')') this.avanca();
    else this.erro("')'");
    return A.Cast(tipo, e, estilo, this.loc(ini));
  }

  /**
   * Tenta ler `(T)expr` como cast. Devolve null e NÃO consome nada se não for
   * um cast — é o único ponto em que o parser volta atrás, e o estado é
   * restaurado inteiro antes de devolver.
   */
  tentaCast() {
    const saveI = this.i;
    const saveDiag = this.diagnostics.length;

    this.avanca(); // (
    if (!this.isTypeName(true)) { this.i = saveI; return null; }

    const tipo = this.tryTipo();
    if (!tipo || this.valor() !== ')') {
      this.i = saveI;
      this.diagnostics.length = saveDiag;
      return null;
    }
    this.avanca(); // )

    // Depois do `)` tem de vir algo que possa ser operando de cast.
    const prox = this.este();
    const v = String(prox.value ?? '');
    const podeSer = prox.type === 'ident' || prox.type === 'number'
      || prox.type === 'char' || prox.type === 'string' || prox.type === 'type'
      || prox.type === 'keyword'
      || ['(', '[', '!', '~', '+', '-', '*', '&', '++', '--'].includes(v);
    if (!podeSer) {
      this.i = saveI;
      this.diagnostics.length = saveDiag;
      return null;
    }

    const ini = this.tokens[saveI] ?? this.este();
    const alvo = this.unario();
    return A.Cast(tipo, alvo, 'implicit', this.loc(ini));
  }

  newExpr() {
    const ini = this.este();
    this.avanca(); // new
    // new (T) ...
    if (this.valor() === '(') { this.avanca(); }

    // `new Foo<T>{}`
    // `emNew` faz `comeQualquerNome` aceitar `T(`/`T{`: o que vem depois do
    // tipo, em `new`, é o construtor — não o nome de uma variável.
    this.emNew = true;
    let tipo;
    try {
      tipo = this.tryTipoNQ() ?? A.Identifier(null);
    } finally {
      this.emNew = false;
    }

    // `new T[n]`: o declarator do TIPO pode ter absorvido o `[n]` como array
    // suffix. Ele pertence ao `New`, não ao tipo — extraímos.
    const dims = [];
    const baseTipo = tipo && tipo.kind === 'TypeId' && tipo.expr
      && tipo.expr.kind === 'Declarator' ? tipo.expr : null;
    if (baseTipo) {
      while (baseTipo.array.length > 0) {
        dims.unshift(baseTipo.array.pop());
      }
      if (dims.length > 0) {
        // `new int[3]{1,2,3}` — o `{...}` vem DEPOIS do `]` e pertence ao New.
        if (this.valor() === '{') {
          return A.New(tipo, dims, true, { init: this.initList() }, this.loc(ini));
        }
        return A.New(tipo, dims, true, {}, this.loc(ini));
      }
    }

    // `new T(1)`: o declarador do TIPO pode ter absorvido o `(1)` como lista de
    // parâmetros (`int(int)` é uma declaração de função válida). Em `new` o
    // parêntese é sempre lista de argumentos do construtor — devolvemos.
    const params = baseTipo?.params ?? [];
    if (baseTipo && baseTipo.temParams) {
      baseTipo.temParams = false;
      baseTipo.params = [];
      return A.New(tipo, params, false, {}, this.loc(ini));
    }

    // alocação por array?
    if (this.valor() === '[') {
      this.avanca();
      const args = [];
      if (this.valor() !== ']') {
        let guard = 0;
        while (guard++ < 1000 && this.valor() !== ']') {
          if (this.valor() === ',') { this.avanca(); continue; }
          const antes = this.i;
          args.push(this.atribuicao());
          if (this.i === antes) this.avancaOuConsome();
        }
      }
      if (this.valor() === ']') this.avanca();
      else this.erro("']'");

      // `new T[n]{...}` — inicializador com chaves após array
      if (this.valor() === '{') {
        this.avanca();
        const elems = [];
        let guard = 0;
        while (guard++ < 10000 && this.valor() !== '}' && this.este().type !== 'eof') {
          if (this.valor() === ',') { this.avanca(); continue; }
          const antes = this.i;
          elems.push(this.atribuicao());
          if (this.i === antes) this.avancaOuConsome();
        }
        if (this.valor() === '}') this.avanca();
        else this.erro("'}'");
        return A.New(tipo, args, true, { init: A.InitList(elems) }, this.loc(ini));
      }

      return A.New(tipo, args, true, {}, this.loc(ini));
    }

    const args = [];
    if (this.valor() === '(') {
      this.avanca();
      let guard = 0;
      while (guard++ < 10000 && this.valor() !== ')' && this.este().type !== 'eof') {
        if (this.valor() === ',') { this.avanca(); continue; }
        const antes = this.i;
        args.push(this.atribuicao());
        if (this.i === antes) this.avancaOuConsome();
      }
      if (this.valor() === ')') this.avanca();
      else this.erro("')'");
    } else if (this.valor() === '{') {
      // `new T{1,2}`
      const save = this.i;
      this.avanca();
      const elems = [];
      let guard = 0;
      while (guard++ < 10000 && this.valor() !== '}' && this.este().type !== 'eof') {
        if (this.valor() === ',') { this.avanca(); continue; }
        const antes = this.i;
        elems.push(this.atribuicao());
        if (this.i === antes) this.avancaOuConsome();
      }
      if (this.valor() === '}') this.avanca();
      else { this.i = save; }
      args.push(A.InitList(elems));
    } else {
      // `new int;` — sem `(...)`, `[...]` nem `{...}` não há alocação
      this.erro("'('");
    }

    return A.New(tipo, args, false, {}, this.loc(ini));
  }

  deleteExpr() {
    const ini = this.este();
    this.avanca(); // delete
    // `[]` são DOIS tokens no lexer (`[` e `]`), não um só.
    let arr = false;
    if (this.valor() === '[' && this.olha(1).value === ']') {
      this.avanca();
      this.avanca();
      arr = true;
    }
    const e = this.unario();
    return A.Delete(e, arr, this.loc(ini));
  }

  /**
   * Operador posfixo + chamadas + índices + membros.
   * `unario` chama isto; `delete` também.
   */
  posfixoUnario() { return this.posfixo(); }

  posfixo() {
    let e = this.primario();

    let guard = 0;
    while (guard++ < 100000) {
      const v = this.valor();

      if (v === '(') {
        const ini = this.este();
        this.avanca();
        const args = [];
        let g2 = 0;
        while (g2++ < 10000 && this.valor() !== ')' && this.este().type !== 'eof') {
          if (this.valor() === ',') { this.avanca(); continue; }
          const antes = this.i;
          args.push(this.atribuicao());
          if (this.i === antes) this.avancaOuConsome();
        }
        if (this.valor() === ')') this.avanca();
        else this.erro("')'");
        e = A.Call(e, args, this.loc(ini));
        continue;
      }

      if (v === '[') {
        const ini = this.este();
        this.avanca();
        const idx = this.expressao();
        if (this.valor() === ']') this.avanca();
        else this.erro("']'");
        e = A.Index(e, idx, this.loc(ini));
        continue;
      }

      // `.*` e `->*` são tokens únicos no lexer: ponteiro-para-membro.
      if (v === '.*' || v === '->*') {
        const ini = this.este();
        this.avanca();
        const nome = this.valor();
        if (this.este().type === 'ident' || this.este().type === 'type') this.avanca();
        e = A.Member(e, nome, v === '->*', this.loc(ini));
        continue;
      }

      if (v === '.' || v === '->') {
        const ini = this.este();
        this.avanca();
        const nome = String(this.valor());
        if (this.este().type !== 'ident' && this.este().type !== 'type'
          && this.este().type !== 'keyword') {
          this.erro('identificador');
          this.avancaOuConsome();
          continue;
        }
        this.avanca();
        if (this.valor() === '<') this.tryTemplateArgs();
        e = A.Member(e, nome, v === '->', this.loc(ini));
        continue;
      }

      if (v === '++' || v === '--') {
        const ini = this.este();
        this.avanca();
        e = A.PostfixUnary(v, e, this.loc(ini));
        continue;
      }

      break;
    }
    return e;
  }

  /** Um `template` explícito depois de `::`: `x.template f<int>()`. */
  primario() {
    const t = this.este();
    const v = String(t.value ?? '');

    if (t.type === 'number') {
      this.avanca();
      return A.Literal(t.value, t.literalKind ?? 'int', t.text ?? null, this.loc(t));
    }
    if (t.type === 'char') {
      this.avanca();
      if (t.prefix && t.prefix !== '') this.foraDoEscopo(E.STRING_LARGO, t);
      return A.Literal(t.value, 'char', t.text ?? null, this.loc(t));
    }
    if (t.type === 'string') {
      this.avanca();
      if (t.prefix && t.prefix !== '') this.foraDoEscopo(E.STRING_LARGO, t);
      // strings adjacentes concatenam: `"a" "b"` é um literal só
      let valor = String(t.value);
      let guard = 0;
      while (this.este().type === 'string' && guard++ < 10000) {
        valor += String(this.este().value);
        this.avanca();
      }
      return A.Literal(valor, 'string', null, this.loc(t));
    }
    if (t.type === 'keyword' && (v === 'true' || v === 'false')) {
      this.avanca();
      return A.Literal(v === 'true', 'bool', v, this.loc(t));
    }
    if (t.type === 'keyword' && v === 'nullptr') {
      this.avanca();
      return A.Literal(null, 'nullptr', 'nullptr', this.loc(t));
    }
    if (v === 'this') { this.avanca(); return A.This(this.loc(t)); }
    if (v === 'nullptr') { this.avanca(); return A.Literal(null, 'nullptr', 'nullptr', this.loc(t)); }

    if (t.type === 'keyword' && v === 'typeid') {
      const ini = t;
      this.avanca();
      let ehTipo = false;
      let alvo = null;
      if (this.valor() === '(') {
        const save = this.i;
        this.avanca();
        if (this.isTypeName(true)) {
          const tipo = this.tryTipo();
          if (this.valor() === ')') { this.avanca(); alvo = tipo; ehTipo = true; }
          else this.i = save;
        }
        if (!ehTipo) {
          this.i = save;
          this.avanca();
          alvo = this.expressao();
          if (this.valor() === ')') this.avanca();
          else this.erro("')'");
        }
      }
      return A.TypeId(alvo, ehTipo, this.loc(ini));
    }

    // `[` inicia lambda — com uma ressalva: `delete[] p` tem `[` seguido de
    // `]` e depois um IDENTIFICADOR. `[]() {}` com captura vazia É lambda.
    // O que decide é o que vem depois do `]`.
    if (v === '[' && this.olha(1).value !== '[') {
      const fecha = this.olha(1).value === ']';
      const depois = fecha ? this.olha(2) : null;
      const ehLambda = !fecha
        || depois.value === '(' || depois.value === '{'
        || depois.type === 'keyword';
      if (ehLambda) return this.lambda();
    }

    // `(` — pode ser parenthesizada ou lambda param
    if (v === '(') {
      const ini = t;
      this.avanca();
      const e = this.expressao();
      if (this.valor() === ')') this.avanca();
      else this.erro("')'");
      return A.Paren(e, this.loc(ini));
    }

    // `{` — init-list
    if (v === '{') return this.initList();

    if (t.type === 'type') {
      // `int(5)` — construcao funcional com tipo embutido
      const tipo = this.tryTipoNQ();
      if (this.valor() === '(') {
        const save = this.i;
        this.avanca();
        const args = [];
        let guard = 0;
        while (guard++ < 10000 && this.valor() !== ')' && this.este().type !== 'eof') {
          if (this.valor() === ',') { this.avanca(); continue; }
          const antes = this.i;
          args.push(this.atribuicao());
          if (this.i === antes) this.avancaOuConsome();
        }
        if (this.valor() === ')') {
          this.avanca();
          return A.Call(A.Cast(tipo, null, 'functional', this.loc(t)), args, this.loc(t));
        }
        this.i = save;
      }
      return A.Cast(tipo, null, 'functional', this.loc(t));
    }

    if (t.type === 'ident' || this.isQualifiedId()) {
      const ini = t;
      const save = this.i;
      const nome = this.qualifiedName();
      if (this.este().type === 'template') this.avanca();

      // `Color{255,255,255}`, `std::vector<std::vector<int>>{{1,2},{3}}`
      // O `{` logo após um NOME indica construção por chaves, não bloco.
      // O `>>` de `vector<vector<int>>` já foi dividido em dois `>` por
      // `tryTemplateArgs`, então chega aqui como `>` e o `{` em seguida.
      if (nome && this.valor() === '{' && this.eChaveDeConstrucao()) {
        return A.BraceInit(
          this.tipoDeNome(nome, this.loc(ini)),
          this.initList(),
          this.loc(ini),
        );
      }

      if (nome) return A.Identifier(nome, this.loc(ini));
      this.i = save;
      // não era nome: consome para não travar
      this.erro('identificador');
      this.avancaOuConsome();
      return A.Identifier(null, this.loc(ini));
    }

    this.erro('expressão');
    this.avancaOuConsome();
    return A.Identifier(null, this.loc(t));
  }

  /**
   * O `{` atual, logo após um nome em posição de EXPRESSÃO, abre construção
   * por chaves: `T{1,2}`.
   *
   * É sempre sim, e a justificativa é a gramática: um bloco (`compound-statement`)
   * é *statement*, nunca expressão. Quem chama `primario()` já está em
   * contexto de expressão, então `if (c) {`, `else {`, `do {`, `T f() {` e
   * `[]{...}` nunca chegam aqui — cada um é tratado antes, por
   * `statement()`/`ifStmt()`/`declaracaoSimples()`/`primario()` (lambda).
   */
  eChaveDeConstrucao() {
    return String(this.este().value) === '{';
  }

  /**
   * Reconstrói o `TypeId` de um nome já qualificado, para `BraceInit`.
   * O `TypeId` precisa de um `Declarator` para o `unparse` emitir o texto.
   */
  tipoDeNome(nome, loc) {
    const d = A.Declarator(null, { ptr: [], array: [], loc });
    d.specifierText = nome;
    d.specifiers = [nome];
    return A.TypeId(d, true, loc);
  }

  initList() {
    const ini = this.este();
    this.avanca(); // {
    const elements = [];
    let guard = 0;
    while (guard++ < 100000 && this.valor() !== '}' && this.este().type !== 'eof') {
      if (this.valor() === ',') { this.avanca(); continue; }
      // `{.x = 1}` — designador C++20. É a única forma de T2.1 que a ordem
      // manda NÃO parsear: E03xx (semântico), não E0100.
      if (this.valor() === '.' && (this.olha(1).type === 'ident' || this.olha(1).type === 'type')) {
        const dloc = this.loc(this.este());
        const dtoken = this.este();
        this.avanca(); // .
        const campo = String(this.valor());
        this.avanca();
        if (this.valor() === '=') this.avanca();
        const valor = this.atribuicao();
        elements.push(A.Designator(campo, valor, dloc));
        this.erroCom(E03.DESIGNATED_INITIALIZER_UNSUPPORTED,
          `designador C++20 '.${campo}' não suportado`, dtoken);
        continue;
      }
      const antes = this.i;
      if (this.valor() === '{') elements.push(this.initList());
      else elements.push(this.atribuicao());
      if (this.i === antes) this.avancaOuConsome();
    }
    if (this.valor() === '}') this.avanca();
    else this.erro("'}'");
    return A.InitList(elements, this.loc(ini));
  }

  lambda() {
    const ini = this.este();
    this.avanca(); // [
    const captures = [];
    let guard = 0;
    while (guard++ < 1000 && this.valor() !== ']' && this.este().type !== 'eof') {
      if (this.valor() === ',') { this.avanca(); continue; }
      if (this.valor() === 'this') {
        const t = this.este();
        this.avanca();
        captures.push({ kind: 'this', loc: this.loc(t) });
      } else if (this.valor() === '&') {
        // P7: a captura precisa de `loc` — o teste "toda declaração do
        // projeto tem loc com linha e coluna" percorre a AST inteira e
        // `src/examples/particles.cpp` tem `auto rnd = [&](){...}`.
        const t = this.este();
        this.avanca();
        // `&` sozinho captura tudo por referência: `[&]`. Depois vem `]`,
        // não um nome.
        if (this.este().type === 'ident') {
          captures.push({ kind: 'porRef', name: String(this.este().value), loc: this.loc(t) });
          this.avanca();
        } else {
          captures.push({ kind: 'porRef', name: '', loc: this.loc(t) });
        }
      } else if (this.este().type === 'ident') {
        const nome = String(this.este().value);
        this.avanca();
        if (this.valor() === '=') {
          this.avanca();
          const init = this.atribuicao();
          captures.push({ kind: 'initCapture', name: nome, init: A.unparse(init) });
        } else if (this.valor() === '...') {
          this.avanca();
          captures.push({ kind: 'variadico', name: nome });
        } else {
          captures.push({ kind: 'porValor', name: nome });
        }
      } else {
        this.avancaOuConsome();
      }
    }
    if (this.valor() === ']') this.avanca();
    else this.erro("']'");

    // params
    let params = [];
    if (this.valor() === '(') {
      this.avanca();
      params = this.listaParametros();
    }

    // qualificadores
    const qualifiers = [];
    let g2 = 0;
    while (g2++ < 100) {
      if (this.valor() === 'mutable') { qualifiers.push('mutable'); this.avanca(); continue; }
      if (this.valor() === 'constexpr') { qualifiers.push('constexpr'); this.avanca(); continue; }
      if (this.valor() === 'consteval') { qualifiers.push('consteval'); this.avanca(); continue; }
      if (this.valor() === 'noexcept') {
        qualifiers.push('noexcept');
        this.avanca();
        if (this.valor() === '(') this.consumeBlocoAte(')');
        continue;
      }
      if (this.valor() === '->') {
        this.avanca();
        const save = this.i;
        const ret = this.tryTipo(true);
        if (ret && ret.kind !== 'NullStmt') { this.retLambda = ret; break; }
        this.i = save;
        break;
      }
      break;
    }

    const body = this.valor() === '{' ? this.bloco() : A.CompoundStmt([]);
    return A.Lambda(captures, params, body, qualifiers, { retType: this.retLambda ?? null }, this.loc(ini));
  }

  // ---------------------------------------------------------- tipos

  /**
   * Lê um tipo. Devolve null se o que está aqui não é tipo — e nesse caso
   * NÃO consome nada.
   */
  tryTipo(noTipo = true) {
    const save = this.i;
    const saveDiag = this.diagnostics.length;

    // `decltype(x)` — o tipo vem de uma expressão
    if (this.valor() === 'decltype') {
      const ini = this.este();
      this.avanca();
      if (this.valor() !== '(') { this.i = save; return null; }
      this.avanca();
      const alvo = this.expressao();
      if (this.valor() === ')') this.avanca();
      else { this.i = save; this.diagnostics.length = saveDiag; return null; }
      const base = A.Declarator(null, { ptr: [], array: [] });
      base.specifiers = ['decltype'];
      base.specifierText = `decltype(${A.unparse(alvo)})`;
      const comPtr = this.declaratorAbstrato();
      const t = A.TypeId(base, true, this.loc(ini));
      if (comPtr && (comPtr.ptr.length || comPtr.array.length)) {
        t.expr.ptr = comPtr.ptr;
        t.expr.array = comPtr.array;
      }
      return t;
    }

    const specs = this.especificadores(noTipo);
    if (specs.length === 0) {
      this.i = save;
      return null;
    }
    if (this.valor() === '::') this.avanca();
    while (this.este().type === 'ident' || this.este().type === 'type'
      || this.este().type === 'template') {
      if (this.este().type === 'template') {
        this.foraDoEscopo(E.CONCEITO);
        this.avanca();
        continue;
      }
      if (this.olha(1).value !== '::' && this.olha(1).value !== '<') break;
      this.avanca();
      if (this.valor() === '<') this.tryTemplateArgs();
      if (this.valor() === '::') { this.avanca(); continue; }
      break;
    }
    // ptr/ref e array do tipo
    const d = this.declaratorAbstrato();
    void 0;
    if (d) {
      d.name = d.name ?? null;
      return d.specifierText ? d : this.comTipo(specs, d);
    }
    this.diagnostics.length = saveDiag;
    this.i = save;
    return null;
  }

  /** tryTipo sem o prefixo `noTipo` (para `new Foo<T>`). */
  tryTipoNQ(noTipo = true) { return this.tryTipo(noTipo); }

  /** Junta `int` + `*` num único nó TypeId para o unparse. */
  comTipo(specs, d) {
    const t = A.Declarator(null, { ptr: d.ptr, array: d.array });
    t.specifierText = specs.join(' ');
    t.specifiers = specs;
    return A.TypeId(t, true);
  }

  /** Inicializador: `{...}` ou expressão. */
  inicializador() {
    if (this.valor() === '{') return this.initList();
    // `(` NÃO é inicializador: em `int x = (1 + 2) * 3` o parêntese abre uma
    // sub-expressão e o `* 3` continua fora dela. Consumir o `(` aqui
    // engolia o resto da expressão.
    return this.atribuicao();
  }

  /** Constante para `[N]`, `case`, `enum = X`, `#if`. */
  constante() {
    const e = this.condicional();
    return e;
  }
}

export default Parser;