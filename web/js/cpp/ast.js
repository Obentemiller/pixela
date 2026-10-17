/**
 * js/cpp/ast.js — a árvore sintática e o unparse.
 *
 * ## Princípios
 *
 * 1. **Nada lança.** Todo construtor aceita entrada incompleta e devolve um
 *    nó. `unparse` devolve string para qualquer coisa, inclusive `null` e um
 *    objeto `{kind:'BugDesconhecido'}`. Quem chama decide o que fazer com o
 *    diagnóstico.
 *
 * 2. **Serializable.** Nenhum nó guarda referência ao token, ao arquivo ou a
 *    qualquer estrutura cíclica. Só dados primitivos e nós filhos. Isso
 *    permite `JSON.stringify` para comparar goldens e para mandar o AST
 *    entre o Worker e a thread principal.
 *
 * 3. **Locations sãoRIA.** `node.loc` é `{line, column}` do início, e
 *    `node.locEnd` o do fim, quando o parser souber. Sem token guardado,
 *    então um nó pode ter `loc: undefined` — `unparse` não se importa.
 *
 * 4. **Round-trip é identidade.** `parse → unparse → parse` devolve a mesma
 *    árvore. Isso é o que torna os goldens utilizáveis por outra
 *    ferramenta; `tests/unit/ast-roundtrip.test.js` verifica em todos os
 *    fixtures do projeto.
 *
 * ## Formato
 *
 * `kind` é a única propriedade que toda函 nó tem. `isExpression`,
 * `isStatement` e `isDeclaration` classificam pelo `kind`, sem tabela
 * paralela — assim não há como um nó novo ser esquecido na classificação.
 *
 * Ver docs/ast.md para o catálogo completo de nós.
 */

// ------------------------------------------------------------------ base

const LOC_VAZIO = Object.freeze({ line: 0, column: 0 });

/**
 * Nó base. `props` é mesclado por cima, mas uma chave presente com valor
 * `undefined` é DESCARTADA: senão `Identifier('x')`, que passa `loc`
 * explicitamente como `undefined`, acabaria com `loc: undefined` e quebraria
 * a garantia de que todo nó tem loc.
 */
function no(kind, props = {}) {
  const base = { kind, loc: LOC_VAZIO };
  for (const k of Object.keys(props)) {
    if (props[k] !== undefined) base[k] = props[k];
  }
  return base;
}

// --------------------------------------------------- classificação

const FAMOUS_EXPRESSAO = new Set([
  'Identifier', 'Literal', 'Unary', 'PostfixUnary', 'Binary', 'Ternary',
  'Call', 'Index', 'Member', 'Assign', 'Cast', 'Sizeof', 'Alignof',
  'New', 'Delete', 'Lambda', 'InitList', 'BraceInit', 'Designator', 'Paren', 'This', 'TypeId',
  'CompoundLiteral', 'ThrowExpr', 'Noexcept',
]);

const FAMILIA_STATEMENT = new Set([
  'CompoundStmt', 'ExprStmt', 'DeclStmt', 'IfStmt', 'WhileStmt', 'DoStmt',
  'ForStmt', 'RangeForStmt', 'SwitchStmt', 'CaseStmt', 'DefaultStmt',
  'BreakStmt', 'ContinueStmt', 'ReturnStmt', 'GotoStmt', 'LabeledStmt',
  'TryStmt', 'CatchClause', 'NullStmt',
]);

const FAMILIA_DECLARACAO = new Set([
  'TranslationUnit', 'VariableDecl', 'FunctionDecl', 'ClassDecl', 'EnumDecl',
  'NamespaceDecl', 'UsingDecl', 'TypedefDecl', 'TemplateDecl',
  'StaticAssertDecl', 'EmptyDecl', 'BaseSpecifier', 'Enumerator',
  'FriendDecl', 'AccessSpec',
]);

export const isExpression = (n) => !!n && FAMOUS_EXPRESSAO.has(n.kind);
export const isStatement = (n) => !!n && FAMILIA_STATEMENT.has(n.kind);
export const isDeclaration = (n) => !!n && FAMILIA_DECLARACAO.has(n.kind);

// ---------------------------------------------------翻译 unit

export function TranslationUnit(decls = [], loc) {
  return   no('TranslationUnit', { decls, loc });
}

// --------------------------------------------------- declarators

/**
 * Um qualificador de ponteiro: `*`, `* const`, `&`, `&&`.
 * `kind` distingue: '*' | '&' | '&&'.
 */
export function PtrOperator(kind = '*', cvConst = false, cvVolatile = false) {
  return   no('PtrOperator', { kind: kind || '*', cvConst: !!cvConst, cvVolatile: !!cvVolatile });
}

/**
 * Declarator: nome + qualificadores de ponteiro + sufixo de array + params.
 *
 * O declarador é a parte mais difícil do C++ e é representada como a gramática
 * do padrão descreve — de dentro para fora. `int *f(int)` tem params em `f`;
 * `int (*f)(int)` tem um `inner` que é o `*f` e params no declarador externo.
 *
 * @param {string|null} name `null` = declarador abstrato (cast, template).
 * @param {object} opts
 *   ptr      PtrOperator[]  prefixos de ponteiro/referência
 *   array    Expression[]   sufixos `[N]`
 *   params   Declarator[]   `()` — lista de parâmetros (vazio = sem protótipo)
 *   temParams bool           distingue `f()` de `f`
 *   cvConst/cvVolatile       qualificadores cv no fim
 *   refQual   'lvalue'|'rvalue'
 *   inner    Declarator      para `(*f)(int)`
 *   virt      'virtual'      apenas para anotação de função virtual
 *   packs     bool           é um template parameter pack (`Args...`)
 *   default   Expression|null  argumento default (`template<class T = int>`)
 */
export function Declarator(name = null, opts = {}) {
  return   no('Declarator', {
    name,
    ptr: opts.ptr ?? [],
    array: opts.array ?? [],
    params: opts.params ?? [],
    temParams: opts.temParams ?? (opts.params !== undefined),
    cvConst: !!opts.cvConst,
    cvVolatile: !!opts.cvVolatile,
    refQual: opts.refQual ?? null,
    inner: opts.inner ?? null,
    virt: opts.virt ?? null,
    packs: !!opts.packs,
    default: opts.default ?? null,
    init: opts.init ?? null,
    defaultDelete: opts.defaultDelete ?? null,
    tipoNoDeclarador: !!opts.tipoNoDeclarador,
    loc: opts.loc,
  });
}

/** Specificador de classe base: `public Base<int>`. */
export function BaseSpecifier(name = null, access = null, args = [], ellipsis = false) {
  return   no('BaseSpecifier', { name, access, args, ellipsis: !!ellipsis });
}

/** Enumerador: `vermelho = 3`. */
export function Enumerator(name = null, value = null) {
  return   no('Enumerator', { name, value });
}

// --------------------------------------------------- declarações

const lista = (x) => (Array.isArray(x) ? x : []);

/**
 * Declaração de variável. Também cobre a forma simples de `typedef` e de
 * structured binding quando `structured` é true.
 *
 * @param {string[]} specifiers  `['const','int']` na ordem do texto
 * @param {Declarator[]} declarators
 * @param {Expression} init  inicializador único (`int x = 1`)
 */
export function VariableDecl(specifiers = [], declarators = [], init = null, loc) {
  return   no('VariableDecl', { specifiers: lista(specifiers), declarators: lista(declarators), init, loc });
}

/** Função. `declarator` é o declarador completo (com params e tipo de retorno). */
export function FunctionDecl(specifiers = [], declarator = null, body = null, loc) {
  return   no('FunctionDecl', {
    specifiers: lista(specifiers), declarator, body, loc,
    templateParams: [],
  });
}

/** class / struct / union. `tagKind` é 'class' | 'struct' | 'union'. */
export function ClassDecl(specifiers = [], name = null, members = [], opts = {}) {
  return   no('ClassDecl', {
    specifiers: lista(specifiers), name, members: lista(members), ...opts, loc: opts.loc,
  });
}

export function EnumDecl(specifiers = [], name = null, enumerators = [], opts = {}) {
  return   no('EnumDecl', {
    specifiers: lista(specifiers), name, enumerators: lista(enumerators), ...opts, loc: opts.loc,
  });
}

export function NamespaceDecl(name = null, decls = [], inline = false, loc) {
  return   no('NamespaceDecl', { name, decls: lista(decls), inline: !!inline, loc });
}

/** Especificação de ligação: `extern "C" ...` ou `extern "C" { ... }`. */
export function LinkageSpec(language = 'C', body = [], braced = false, loc) {
  return no('LinkageSpec', { language, body: lista(body), braced, loc });
}

/**
 * `using N;`, `using ns::nome;` ou `using Alias = tipo;`.
 * `name` é o último identificador; `qualified` é o caminho completo.
 */
export function UsingDecl(name = null, qualified = null, alias = null, loc) {
  return   no('UsingDecl', { name, qualified, alias, loc });
}

export function TypedefDecl(specifiers = [], declarators = [], loc) {
  return   no('TypedefDecl', { specifiers: lista(specifiers), declarators: lista(declarators), loc });
}

export function TemplateDecl(params = [], decl = null, loc) {
  return   no('TemplateDecl', { params: lista(params), decl, loc });
}

export function StaticAssertDecl(cond = null, message = null, loc) {
  return   no('StaticAssertDecl', { cond, message, loc });
}

export function EmptyDecl(loc) {
  return no('EmptyDecl', { loc });
}

export function FriendDecl(specifiers = [], decl = null, loc) {
  return   no('FriendDecl', { specifiers: lista(specifiers), decl, loc });
}

export function AccessSpec(name = 'public', loc) {
  return no('AccessSpec', { name, loc });
}

// --------------------------------------------------- expressões

export function Identifier(name = null, loc) {
  return no('Identifier', { name, loc });
}

/**
 * Literal. `literalKind` é 'int' | 'float' | 'char' | 'string' | 'bool' |
 * 'nullptr' | 'rawstring'. `text` preserva a grafia original (`0x1F`,
 * `1'000`, `'a'`) para o unparse e para o codegen.
 */
export function Literal(value = null, literalKind = 'int', text = null, loc) {
  return   no('Literal', { value, literalKind, text, loc });
}

/** `op` é '!', '-', '+', '~', '++', '--' (prefixo) ou `*`, `&`. */
export function Unary(op = null, expr = null, prefix = true, loc) {
  return   no('Unary', { op, expr, prefix: prefix !== false, loc });
}

/** Operador pós-fixo: `x++`, `x--`. */
export function PostfixUnary(op = null, expr = null, loc) {
  return   no('PostfixUnary', { op, expr, loc });
}

/** `op` é um operador binário: `+ - * / % < > <= >= == != && || | ^ & << >> = ,` etc. */
export function Binary(op = null, left = null, right = null, loc) {
  return   no('Binary', { op, left, right, loc });
}

export function Ternary(cond = null, then = null, other = null, loc) {
  return   no('Ternary', { cond, then, other, loc });
}

export function Call(callee = null, args = [], loc) {
  return   no('Call', { callee, args: lista(args), loc });
}

export function Index(base = null, index = null, loc) {
  return   no('Index', { base, index, loc });
}

/** `arrow` true = `p->x`, false = `p.x`. `name` null quando é `p->template`. */
export function Member(base = null, name = null, arrow = false, loc) {
  return   no('Member', { base, name, arrow: !!arrow, loc });
}

/** `op` é `=` ou um composto: `+= -= *= /= %= <<= >>= &= |= ^=`. */
export function Assign(target = null, value = null, op = '=', loc) {
  return   no('Assign', { target, value, op, loc });
}

/**
 * Conversão. `style`: 'implicit' (`(int)x`), 'static_cast' | 'const_cast' |
 * 'reinterpret_cast' | 'dynamic_cast', ou 'functional' (`int(x)`).
 * `style: 'c'` marca o cast estilo C `(T)e` quando há tipo dentro de parênteses.
 */
export function Cast(typeId = null, expr = null, style = 'implicit', loc) {
  return   no('Cast', { typeId, expr, style, loc });
}

export function Sizeof(target = null, isType = false, loc) {
  return   no('Sizeof', { target, isType: !!isType, loc });
}

export function Alignof(target = null, isType = false, loc) {
  return   no('Alignof', { target, isType: !!isType, loc });
}

/** `array` true = `new T[n]`. `init` pode ser `InitList`. */
export function New(typeId = null, args = [], array = false, opts = {}, loc) {
  return   no('New', { typeId, args: lista(args), array: !!array, ...opts, loc });
}

export function Delete(expr = null, array = false, loc) {
  return   no('Delete', { expr, array: !!array, loc });
}

/**
 * Lambda `[captures](params) -> ret { body }`.
 * `captures`: array de `{kind:'porValor'|'porRef'|'this'|'initCapture', name}`
 * `params`: Declarator[]
 * `qualifiers`: `['mutable','constexpr','noexcept']`
 * `retType`: TypeId|null
 */
export function Lambda(captures = [], params = [], body = null, qualifiers = [], opts = {}, loc) {
  return   no('Lambda', {
    captures: lista(captures), params: lista(params), body,
    qualifiers: lista(qualifiers), retType: opts.retType ?? null, loc,
  });
}

/** Lista de inicialização `{a, b, c}`. Também é init-list de construtor. */
export function InitList(elements = [], loc) {
  return   no('InitList', { elements: lista(elements), loc });
}

/**
 * Designador de inicializador C++20: `{.x = 1}`. O parser o reconhece e
 * emite E0308 (não suportado), mas o nó existe para o unparse preservar a
 * forma original quando o trecho éecoado.
 */
export function Designator(field = null, value = null, loc) {
  return no('Designator', { field, value, loc });
}

/**
 * Construção por chaves: `T{1, 2}` em posição de EXPRESSÃO.
 * `type` é o `TypeId`/nome que precede a chave (null quando só havia `{`).
 * `init` é sempre um `InitList`.
 */
export function BraceInit(type = null, init = null, loc) {
  return no('BraceInit', { type, init: init ?? InitList([], loc), loc });
}

export function Paren(expr = null, loc) {
  return no('Paren', { expr, loc });
}

export function This(loc) {
  return no('This', { loc });
}

/**
 * `typeid(...)`. `isType` true quando o conteúdo é um TIPO (`typeid(int)`);
 * false quando é uma EXPRESSÃO (`typeid(x)`). Sem essa flag os dois casos
 * são indistinguíveis e o unparse imprime `1` em vez de `typeid(1)`.
 */
export function TypeId(expr = null, isType = false, loc) {
  return no('TypeId', { expr, isType: !!isType, loc });
}

export function Noexcept(expr = null, loc) {
  return no('Noexcept', { expr, loc });
}

/** `throw e` como expressão. */
export function ThrowExpr(expr = null, loc) {
  return no('ThrowExpr', { expr, loc });
}

/** `(Tipo){...}` — compound literal, extension GNU, raro em C++. */
export function CompoundLiteral(typeId = null, init = null, loc) {
  return   no('CompoundLiteral', { typeId, init, loc });
}

// --------------------------------------------------- statements

export function CompoundStmt(stmts = [], loc) {
  return   no('CompoundStmt', { stmts: lista(stmts), loc });
}

export function ExprStmt(expr = null, loc) {
  return no('ExprStmt', { expr, loc });
}

export function DeclStmt(decl = null, loc) {
  return no('DeclStmt', { decl, loc });
}

export function NullStmt(loc) {
  return no('NullStmt', { loc });
}

/** `else` null quando não há. `condInit` cobre `if (T x = f())`. */
export function IfStmt(cond = null, then = null, els = null, opts = {}, loc) {
  return   no('IfStmt', { cond, then, els, condInit: opts.condInit ?? null, loc });
}

export function WhileStmt(cond = null, body = null, loc) {
  return   no('WhileStmt', { cond, body, loc });
}

export function DoStmt(body = null, cond = null, loc) {
  return   no('DoStmt', { body, cond, loc });
}

export function ForStmt(init = null, cond = null, update = null, body = null, loc) {
  return   no('ForStmt', { init, cond, update, body, loc });
}

/** `for (T x : range)`. `range` é a expressão da faixa. */
export function RangeForStmt(decl = null, range = null, body = null, loc) {
  return   no('RangeForStmt', { decl, range, body, loc });
}

/**
 * Switch. `init` é o `switch (T x = f())`.
 * `cases` é a lista de CaseStmt/DefaultStmt, na ordem do texto.
 */
export function SwitchStmt(cond = null, cases = [], init = null, loc) {
  return   no('SwitchStmt', { cond, cases: lista(cases), init, loc });
}

export function CaseStmt(value = null, body = null, loc) {
  return   no('CaseStmt', { value, body, loc });
}

export function DefaultStmt(body = null, loc) {
  return no('DefaultStmt', { body, loc });
}

export function BreakStmt(loc) {
  return no('BreakStmt', { loc });
}

export function ContinueStmt(loc) {
  return no('ContinueStmt', { loc });
}

export function ReturnStmt(expr = null, loc) {
  return no('ReturnStmt', { expr, loc });
}

export function GotoStmt(label = null, loc) {
  return no('GotoStmt', { label, loc });
}

export function LabeledStmt(label = null, body = null, loc) {
  return   no('LabeledStmt', { label, body, loc });
}

export function TryStmt(body = null, catches = [], loc) {
  return   no('TryStmt', { body, catches: lista(catches), loc });
}

export function CatchClause(param = null, body = null, loc) {
  return   no('CatchClause', { param, body, loc });
}

// ------------------------------------------------------------------ unparse

/**
 * Precedência dos operadores binários. Maior = cola mais forte.
 * A tabela segue [expr.pre], com o operador de atribuição no nível mais baixo
 * depois da vírgula. Usada para decidir parênteses: só imprimimos quando o
 * filho é mais fraco que o pai, ou quando associatividade exige.
 */
const PRECEDENCIA = {
  ',': 1,
  '=': 2, '+=': 2, '-=': 2, '*=': 2, '/=': 2, '%=': 2,
  '<<=': 2, '>>=': 2, '&=': 2, '^=': 2, '|=': 2,
  '?': 3,
  '||': 4,
  '&&': 5,
  '|': 6,
  '^': 7,
  '&': 8,
  '==': 9, '!=': 9,
  '<': 10, '>': 10, '<=': 10, '>=': 10,
  '<<': 11, '>>': 11,
  '+': 12, '-': 12,
  '*': 13, '/': 13, '%': 13,
  '->': 16, '.': 16,
  '()': 17, '[]': 17,
};

const PREC_ATRIBUICAO = 2;
const PREC_VIRGULA = 1;

const precedenciaDe = (n) => {
  if (!n || typeof n.kind !== 'string') return 0;
  switch (n.kind) {
    case 'Binary': return PRECEDENCIA[n.op] ?? 0;
    case 'Assign': return PREC_ATRIBUICAO;
    case 'Ternary': return PRECEDENCIA['?'];
    case 'Cast': return 15;
    case 'Unary': case 'PostfixUnary': case 'Sizeof': case 'Alignof':
    case 'New': case 'Delete': case 'ThrowExpr': return 14;
    case 'Call': return PRECEDENCIA['()'];
    case 'Index': case 'Member': return PRECEDENCIA['.'];
    case 'Identifier': case 'Literal': case 'This': return 20;
    case 'InitList': return 20;
    case 'Designator': return 20;
    // `T{1,2}` é primário: liga mais forte que qualquer operador binário,
    // mas precisa de parênteses como operando da atribuição/arredondamento.
    case 'BraceInit': return 20;
    case 'Paren': return 21;
    default: return 0;
  }
};

/** Associatividade à direita: atribuição, ternário, `**`-likes. */
const DIREITA = new Set(['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '^=', '|=']);

/**
 * `prec` é a precedência do contexto onde a expressão aparece.
 * Devolve o texto com parênteses apenas onde eles são necessários — de modo
 * que `parse(unparse(n))` volte a dar `n`.
 */
function expr(n, prec = 0) {
  const meu = precedenciaDe(n);
  const texto = exprCrua(n, meu);
  const precisa = meu < prec;
  return precisa ? `(${texto})` : texto;
}

function exprCrua(n, meu) {
  if (!n || typeof n.kind !== 'string') return '';
  const p = (filho) => expr(filho, meu);

  switch (n.kind) {
    case 'Identifier': return n.name ?? '';
    case 'Literal': return literalTexto(n);
    case 'This': return 'this';
    case 'Paren': return `(${expr(n.expr, 0)})`;
    case 'InitList': return `{${n.elements.map((e) => expr(e, 0)).join(', ')}}`;
    case 'Designator': return `.${n.field} = ${expr(n.value, 0)}`;
    case 'BraceInit': {
      // `T{1,2}` / `{1,2}` (sem tipo). O tipo é reemitido por `tipoTexto`
      // quando existe; `expr` não é usado porque um `TypeId` no meio de
      // expressão perde os especificadores no round-trip.
      const t = n.type ? tipoTexto(n.type) : '';
      return `${t}${exprCrua(n.init, meu)}`;
    }

    case 'Unary':
      // `sizeof (int)*x` precisa de parênteses: -x tem precedência 14.
      return `${n.op}${expr(n.expr, meu)}`;
    case 'PostfixUnary':
      return `${expr(n.expr, meu + 1)}${n.op ?? ''}`;
    case 'Sizeof':
      return n.isType ? `sizeof(${tipoTexto(n.target)})` : `sizeof ${expr(n.target, meu + 1)}`;
    case 'Alignof':
      return n.isType ? `alignof(${tipoTexto(n.target)})` : `alignof ${expr(n.target, meu + 1)}`;
    case 'Noexcept':
      return `noexcept(${expr(n.expr, 0)})`;

    case 'Binary': {
      // O lado direito de `-`, `/`, `%`, `<<` e `>>` associa à esquerda e
      // precisa de parênteses quando é outraBinária da mesma precedência.
      const assocEsq = meu && meu === precedenciaDe(n.right) && !DIREITA.has(n.op);
      const esq = expr(n.left, meu);
      const dir = assocEsq ? `(${exprCrua(n.right, meu)})` : expr(n.right, meu + 1);
      return `${esq} ${n.op} ${dir}`;
    }

    case 'Ternary': {
      const c = expr(n.cond, meu + 1);
      const t = expr(n.then, 0);
      const o = expr(n.other, meu);
      return `${c} ? ${t} : ${o}`;
    }

    case 'Assign':
      return `${expr(n.target, meu + 1)} ${n.op ?? '='} ${expr(n.value, meu)}`;

    case 'Call': {
      // `(*p)(x)` precisa de parênteses no callee; `obj->f(x)` não, porque
      // membro tem a MESMA precedência que a chamada e é associativo à
      // esquerda. Por isso o limite é a precedência de `.`, não a de `()`.
      const c = expr(n.callee, PRECEDENCIA['.']);
      return `${c}(${n.args.map((a) => expr(a, 0)).join(', ')})`;
    }
    case 'Index':
      // `a.b[i]` — membro e índice têm a MESMA precedência e são
      // associativos à esquerda. Usar o limite de `()` imprimia `(a.b)[i]`,
      // que ao reparsear virava `Index(Paren(Member), i)` — AST diferente.
      return `${expr(n.base, PRECEDENCIA['.'])}[${expr(n.index, 0)}]`;
    case 'Member':
      // A base usa a MESMA precedência, não uma maior: `m.a.b` e `a[i].b` são
      // cadeias associativas à esquerda e `m.a.b.resize(3)` não precisa de
      // parênteses. Pedir `PRECEDENCIA['.'] + 1` punha `(m.a).b` no unparse;
      // ao reparsear, `m.a` virava nó `Paren` e o `Member` interno perdia o
      // campo `arrow` — o round-trip do projeto quebrava em `pixela.hpp`.
      return `${expr(n.base, PRECEDENCIA['.'])}${n.arrow ? '->' : '.'}${n.name ?? ''}`;

    case 'Cast': {
      if (n.style === 'static_cast' || n.style === 'const_cast'
        || n.style === 'reinterpret_cast' || n.style === 'dynamic_cast') {
        return `${n.style}<${tipoTexto(n.typeId)}>(${expr(n.expr, 0)})`;
      }
      return `(${tipoTexto(n.typeId)})${expr(n.expr, meu)}`;
    }

    case 'New': {
      const t = tipoTexto(n.typeId);
      if (n.array) {
        return `new ${t}[${n.args.map((a) => expr(a, 0)).join('')}]`;
      }
      return `new ${t}(${n.args.map((a) => expr(a, 0)).join(', ')})`;
    }
    case 'Delete':
      return `delete${n.array ? '[]' : ''} ${expr(n.expr, meu)}`.trim();

    case 'Lambda': {
      const caps = n.captures.map((c) => {
        if (typeof c === 'string') return c;
        if (c.kind === 'this') return 'this';
        if (c.kind === 'initCapture') return `${c.init ?? ''} ${c.name}`;
        if (c.kind === 'porRef') return c.name ? `&${c.name}` : '&';
        return c.name ?? '';
      });
      const params = n.params.map(paramTexto).join(', ');
      const ret = n.retType ? ` -> ${tipoTexto(n.retType)}` : '';
      const q = n.qualifiers.length ? ` ${n.qualifiers.join(' ')}` : '';
      return `[${caps.join(', ')}](${params})${ret}${q} ${blocoTexto(n.body)}`;
    }

    case 'TypeId':
      return `typeid(${n.isType ? tipoTexto(n.expr) : expr(n.expr, 0)})`;

    case 'ThrowExpr':
      return `throw${n.expr ? ` ${expr(n.expr, 0)}` : ''}`;

    case 'CompoundLiteral':
      return `(${tipoTexto(n.typeId)}) ${expr(n.init, 0)}`;

    default:
      return '';
  }
}

/** Texto de um literal, preservando a grafia original quando existe. */
function literalTexto(n) {
  if (n.text !== null && n.text !== undefined) return n.text;
  switch (n.literalKind) {
    case 'string': return JSON.stringify(String(n.value));
    case 'char': return `'${n.value}'`;
    case 'bool': return n.value ? 'true' : 'false';
    case 'nullptr': return 'nullptr';
    case 'float': return String(n.value);
    default: return String(n.value);
  }
}

/** Texto de um declarador, do mais interno ao mais externo. */
/**
 * Texto de um TIPO. O tipo chega de três formas, dependendo de onde foi
 * escrito no texto:
 *   - `TypeId`   — quando vinha de `typeid(T)` ou do tipo de um cast;
 *   - `Declarator` abstrato — quando vinha de `new T[...]` ou `sizeof(T)`;
 *   - `Declarator` concreto — quando tinha nome.
 * Sem isto, `new int[7]` sairia como `new [7]`: o `int` se perde.
 */
function tipoTexto(t) {
  if (!t || typeof t !== 'object') return '';
  if (t.kind === 'TypeId') return t.isType ? tipoTexto(t.expr) : expr(t.expr, 0);
  if (t.kind === 'Declarator') return declaradorTexto(t);
  return expr(t, 0);
}

/**
 * Texto de um PARÂMETRO.
 *
 * Um parâmetro é `<specifier> <declarator>`: `int a`, `const char* nome`.
 * Só guardar o declarador perderia o tipo — `void f(int a)` sairia como
 * `void f(a)`. Por isso o parser passa o parâmetro como `VariableDecl`
 * (specifiers + declarators) e, quando não há nome (`void f(int)`), como um
 * declarador puro.
 */
function paramTexto(p) {
  if (!p) return '';
  if (p.kind === 'VariableDecl') {
    const spec = (p.specifiers ?? []).join(' ');
    const nomes = (p.declarators ?? []).map(declaradorTexto).join(', ');
    // `int* a` e o estilo usual; `int *a` tambem compila, mas o espaco
    // some se o declarador comeca por `*` ou `&`.
    const sep = nomes === '' ? '' : (nomes.startsWith('*') || nomes.startsWith('&') ? '' : ' ');
    const comSpec = spec ? spec + sep + nomes : nomes;
    const init = p.init ? ` = ${expr(p.init, 0)}` : '';
    return `${comSpec}${init}`;
  }
  if (p.kind === 'Declarator') {
    // Declarador puro não tem tipo; se o parser não deu os specifiers, é o
    // máximo que dá para imprimir.
    return declaradorTexto(p);
  }
  return expr(p, 0);
}

function declaradorTexto_UNUSED(d) {
  if (p.kind === 'VariableDecl') {
    const spec = (p.specifiers ?? []).join(' ');
    const nomes = (p.declarators ?? []).map(declaradorTexto).join(', ');
    const init = p.init ? ` = ${expr(p.init, 0)}` : '';
    return `${spec ? `${spec} ` : ''}${nomes}${init}`;
  }
  if (p.kind === 'Declarator') {
    // Declarador puro não tem tipo; se o parser não deu os specifiers, é o
    // máximo que dá para imprimir.
    return declaradorTexto(p);
  }
  return expr(p, 0);
}

function declaradorTexto(d) {
  if (!d || d.kind !== 'Declarator') return '';
  let base = d.name ?? '';

  // `specifierText` existe quando o declarador é ABSTRATO e carrega o tipo
  // como texto (`int`, `std::vector<int>`, `decltype(x)`). Sem ele, um
  // declarador sem nome imprimiria só o array e o tipo sumiria.
  // Só declaradores ABSTRATOS (name === null) carregam o tipo dentro deles;
  // os concretos tiram o tipo do pai (VariableDecl.specifiers). Aplicar nos
  // dois duplicaria `int int x`.
  // `decltype(x) y;` tem o tipo DENTRO do declarador nomeado; nesse caso
  // `tipoNoDeclarador` está ligado. Sem o sinalizador, a regra seria
  // `name === null` e o `decltype` sumiria do unparse.
  const prefixoTipo = (d.specifierText && (d.name === null || d.tipoNoDeclarador))
    ? `${d.specifierText} ` : '';
  if (prefixoTipo) base = `${prefixoTipo}${base}`;

  // Qualificadores de cv applied ao tipo que o declarador nomeia.
  const cv = [d.cvConst && 'const', d.cvVolatile && 'volatile'].filter(Boolean).join(' ');
  const arr = d.array.map((a) => `[${a === null || a === undefined ? '' : expr(a, 0)}]`).join('');

  if (d.params !== undefined && d.temParams) {
    const params = d.params.map(paramTexto).join(', ');
    const sufixo = [cv, d.refQual === 'lvalue' ? '&' : d.refQual === 'rvalue' ? '&&' : '']
      .filter(Boolean).join(' ');
    base = `${base}(${params})${sufixo ? ` ${sufixo}` : ''}`;
  } else {
    const sufixo = [cv, d.refQual === 'lvalue' ? '&' : d.refQual === 'rvalue' ? '&&' : '']
      .filter(Boolean).join(' ');
    base = `${base}${sufixo ? ` ${sufixo}` : ''}`;
  }

  base += arr;
  base += d.packs ? '...' : '';

  // Argumento default de parâmetro de template: `template<class T = int>`.
  // PRECISA voltar no unparse — sem isto o default sumiria na segunda
  // passada e o round-trip perderia a informação que o parser teve o
  // trabalho de guardar. É o mesmo raciocínio do `baseInit` abaixo.
  if (d.default !== null && d.default !== undefined) {
    // `tipoTexto`, não `expr`: um default tipo é um `TypeId` com `isType`, e
    // `expr()` o impressa como `typeid(...)`. `tipoTexto` respeita `isType`.
    base += ` = ${tipoTexto(d.default)}`;
  }

  // Lista de inicialização de membros do construtor: `C() : x_(1), y_(2)`.
  // O `Declarator` a guarda em `baseInit` e ela PRECISA voltar no unparse:
  // sem isto a lista inteira sumia na segunda passada e o round-trip do
  // projeto quebrava em `src/pixela.hpp` (construtor `Canvas`).
  if (Array.isArray(d.baseInit) && d.baseInit.length > 0) {
    const campos = d.baseInit.map((m) => {
      const nome = m?.target?.name ?? '';
      const args = (m?.value?.elements ?? []).map((a) => expr(a, 0)).join(', ');
      return `${nome}(${args})`;
    }).join(', ');
    base = `${base} : ${campos}`;
  }

  // Prefixos de ponteiro/reference.
  for (const p of d.ptr) {
    if (!p) continue;
    const q = [p.cvConst && 'const', p.cvVolatile && 'volatile'].filter(Boolean).join(' ');
    const prefixo = p.kind === '&' ? '&' : p.kind === '&&' ? '&&' : '*';
    base = `${prefixo}${q ? ` ${q} ` : ' '}${base}`;
  }

  if (d.inner) return `(${declaradorTexto(d.inner)})${base}`;
  return base;
}

function blocoTexto(b) {
  if (!b) return '{}';
  if (b.kind === 'CompoundStmt') return `{${b.stmts.map(stmtTexto).join('')}}`;
  return stmtTexto(b);
}

function declTexto(d) {
  if (!d || typeof d.kind !== 'string') return '';
  const spec = d.specifiers ? d.specifiers.join(' ') : '';

  switch (d.kind) {
    case 'TranslationUnit':
      return d.decls.map(declTexto).join(' ');
    case 'EmptyDecl': return ';';
    case 'NullStmt': return ';';
    case 'AccessSpec': return `${d.name}:`;

    case 'VariableDecl': {
      const partes = [];
      d.declarators.forEach((decl, i) => {
        let t = declaradorTexto(decl);
        // O inicializador do PRIMEIRO declarador fica em `d.init`; os dos
        // demais, em `decl.init`. Sem o índice, `double vx = 1.1, vy = 0.8;`
        // saía como `vx = 1.1, vy = 1.1` — o segundo herdava o do primeiro.
        const init = (i === 0 && d.init) ? d.init : decl.init;
        if (init) t += ` = ${expr(init, 0)}`;
        partes.push(t);
      });
      const prefixo = spec ? `${spec} ` : '';
      return `${prefixo}${partes.join(', ')};`;
    }

    case 'TypedefDecl':
      return `typedef ${spec} ${d.declarators.map(declaradorTexto).join(', ')};`;

    case 'FunctionDecl': {
      const nome = declaradorTexto(d.declarator);
      const decl = d.declarator;
      const ret = decl?.retType ? `${expr(decl.retType, 0)} ` : '';
      const tpl = d.templateParams && d.templateParams.length
        ? `template<${d.templateParams.map((p) => declaradorTexto(p) || p).join(', ')}> ` : '';
      const virt = decl?.virt === 'virtual' ? 'virtual ' : '';
      const pre = d.specifiers.includes('explicit') ? '' : '';
      // Sem corpo é DECLARAÇÃO (`int f();`), não definição — não invente `{}`.
      const corpo = d.body ? blocoTexto(d.body) : '';
      const dd = decl?.defaultDelete ? ` = ${decl.defaultDelete}` : '';
      return `${tpl}${spec ? `${spec} ` : ''}${pre}${virt}${ret}${nome}${dd}${corpo}`;
    }

    case 'ClassDecl': {
      const tag = d.specifiers.find((s) => ['class', 'struct', 'union'].includes(s)) ?? 'class';
      const bases = d.bases && d.bases.length
        ? ` : ${d.bases.map((b) => `${b.access ?? 'public'} ${tipoTexto(b.name) || b.name}`
          + `${b.args && b.args.length ? `<${b.args.map((a) => expr(a, 0)).join(', ')}>` : ''}`
          + `${b.ellipsis ? '...' : ''}`).join(', ')}`
        : '';
      return `${spec ? `${spec} ` : ''}${d.name ?? ''}${bases} {${d.members.map(memberTexto).join('')}}`;
    }

    case 'EnumDecl': {
      const vals = d.enumerators.map((e) => `${e.name ?? ''}${e.value ? ` = ${expr(e.value, 0)}` : ''}`);
      return `${spec} ${d.name ?? ''} {${vals.join(', ')}};`;
    }

    case 'NamespaceDecl': {
      const an = d.alias ? ` ${declaradorTexto(d.alias)}` : '';
      return `namespace${d.inline ? ' inline' : ''} ${d.name ?? ''}${an} {${d.decls.map(declTexto).join('')}}`;
    }

    case 'LinkageSpec': {
      const lang = d.language ?? 'C';
      // `declTexto` JÁ emite o `;` das declarações que precisam dele
      // (variável, typedef, classe, `EmptyDecl`) e NÃO emite para
      // `FunctionDecl`, que pode ou não ter corpo. Acrescentar `; ` em
      // cima disso produzia `extern "C" void f(){}; ;` no unparse e o
      // round-trip não fechava.
      const partes = d.body.map(declTexto)
        .filter((t) => t !== '')
        .map((t) => (t.endsWith(';') ? t : `${t};`));
      if (d.braced) {
        return `extern "${lang}" {${partes.join(' ')}}`;
      }
      return `extern "${lang}" ${partes.join(' ')}`;
    }

    case 'UsingDecl':
      if (d.alias) {
        const tipo = d.alias.kind === 'TypeId' ? expr(d.alias.expr, 0) : declaradorTexto(d.alias);
        return `using ${d.name} = ${tipo};`;
      }
      return `using ${d.qualified ?? d.name};`;

    case 'TemplateDecl':
      return `template<${d.params.map((p) => `typename ${declaradorTexto(p)}`).join(', ')}> ${declTexto(d.decl)}`;

    case 'StaticAssertDecl':
      return `static_assert(${expr(d.cond, 0)}${d.message ? `, ${literalTexto(d.message)}` : ''});`;

    case 'FriendDecl':
      if (!d.decl) return '';
      return `friend ${d.specifiers.join(' ')} ${declTexto(d.decl)}`;

    case 'Enumerator':
      return `${d.name ?? ''}${d.value ? ` = ${expr(d.value, 0)}` : ''}`;

    case 'PtrOperator':
      return d.kind;

    default:
      return '';
  }
}

/** Texto de um statement. */
function stmtTexto(s) {
  if (!s || typeof s.kind !== 'string') return '';

  switch (s.kind) {
    case 'CompoundStmt': return `{${s.stmts.map(stmtTexto).join('')}}`;
    case 'NullStmt': return ';';
    case 'ExprStmt': {
      // `(void)0;` e `this;` ainda são statements válidos.
      return `${expr(s.expr, PREC_VIRGULA)};`;
    }
    case 'DeclStmt': return declTexto(s.decl);
    case 'IfStmt': {
      const init = s.condInit ? `${declTexto(s.condInit)} ` : '';
      const base = `if (${init}${expr(s.cond, 0)}) ${stmtOuBloco(s.then)}`;
      return s.els ? `${base} else ${stmtOuBloco(s.els)}` : base;
    }
    case 'WhileStmt': return `while (${expr(s.cond, 0)}) ${stmtOuBloco(s.body)}`;
    case 'DoStmt': return `do ${stmtOuBloco(s.body)} while (${expr(s.cond, 0)});`;
    case 'ForStmt':
      return `for (${forPartes(s)}) ${stmtOuBloco(s.body)}`;
    case 'RangeForStmt': {
      const decl = s.decl ? declTexto({ ...s.decl, init: null }).replace(/;$/, '') : '';
      return `for (${decl} : ${expr(s.range, 0)}) ${stmtOuBloco(s.body)}`;
    }
    case 'SwitchStmt': {
      const init = s.init ? `${declTexto(s.init)} ` : '';
      return `switch (${init}${expr(s.cond, 0)}) {${s.cases.map(stmtTexto).join('')}}`;
    }
    case 'CaseStmt':
      return s.value ? `case ${expr(s.value, 0)}: ${stmtOuBloco(s.body)}` : 'case ?: ;';
    case 'DefaultStmt': return `default: ${stmtOuBloco(s.body)}`;
    case 'BreakStmt': return 'break;';
    case 'ContinueStmt': return 'continue;';
    case 'ReturnStmt': return s.expr ? `return ${expr(s.expr, PREC_VIRGULA)};` : 'return;';
    case 'GotoStmt': return `goto ${s.label};`;
    case 'LabeledStmt': return `${s.label}: ${stmtOuBloco(s.body)}`;
    case 'TryStmt':
      return `try ${stmtOuBloco(s.body)} ${s.catches.map(catchTexto).join(' ')}`;
    case 'CatchClause': return catchTexto(s);
    default:
      return declTexto(s);
  }
}

function catchTexto(c) {
  const p = c.param ? declaradorTexto(c.param) : '';
  return `catch (${p}) ${stmtOuBloco(c.body)}`;
}

function memberTexto(m) {
  if (m && m.kind === 'VariableDecl' && m.specifiers && m.specifiers.length
    && !m.declarators.some((d) => d.name)) {
    return `${m.specifiers.join(' ')};`;
  }
  // Uma DECLARAÇÃO de membro (sem corpo) precisa do `;` que a separa da
  // próxima. Sem ele, `size_t size() const` + `const char* c_str() const`
  // viravam `size_t size() const const char * c_str() const` e o `const` do
  // método passava a qualificar o tipo de retorno da função seguinte — o
  // round-trip do projeto quebrava com `specifiers: ["const","char"]` virando
  // `["char"]`.
  // `= default` / `= delete` JÁ trazem o `;` (o `declTexto` emite
  // `S() = default` e o `;` é do statement). Não acrescentar outro.
  if (m && m.kind === 'FunctionDecl' && !m.body && !m.declarator?.defaultDelete) {
    return `${declTexto(m)}; `;
  }
  // Demais membros: separados por ESPAÇO, porque uma DEFINIÇÃO já traz as
  // próprias chaves e um `;` extra viraria `EmptyDecl` na segunda passada.
  return `${declTexto(m)} `;
}

function stmtOuBloco(s) {
  if (!s) return ';';
  // `if (c) x;` sem bloco precisa de ponto e vírgula; um bloco já traz o seu.
  if (s.kind === 'CompoundStmt') return blocoTexto(s);
  // `case 1:` e `default:` já imprimem o próprio bloco depois do `:`.
  if (s.kind === 'CaseStmt' || s.kind === 'DefaultStmt') return stmtTexto(s);
  if (s.kind === 'NullStmt') return ';';
  if (s.kind === 'IfStmt' || s.kind === 'ForStmt' || s.kind === 'WhileStmt'
    || s.kind === 'SwitchStmt' || s.kind === 'RangeForStmt') return stmtTexto(s);
  return stmtTexto(s);
}

function forPartes(s) {
  const init = s.init
    ? (s.init.kind === 'DeclStmt' ? declTexto(s.init.decl).replace(/;$/, '') : expr(s.init.expr, 0))
    : '';
  const cond = s.cond ? expr(s.cond, 0) : '';
  const upd = s.update ? expr(s.update, 0) : '';
  return `${init}; ${cond}; ${upd}`;
}

/**
 * Converte qualquer nó (ou lista de nós) em texto C++.
 * Aceita `null`, `undefined` e objetos desconhecidos sem lançar — devolve
 * string vazia. É a função usada pelo round-trip.
 */
export function unparse(n) {
  if (n === null || n === undefined) return '';
  if (Array.isArray(n)) return n.map(declTexto).join('');
  if (typeof n !== 'object') return String(n);
  if (n.kind === 'Declarator') return tipoTexto(n);
  if (isExpression(n)) return expr(n, 0);
  if (isStatement(n)) return stmtTexto(n);
  return declTexto(n);
}

// ------------------------------------------------------------------ walk

/**
 * Percorre a árvore em profundidade, chamando `fn(no, pai)` para cada nó.
 * `fn` pode devolver `false` para não descer nos filhos desse nó.
 */
export function walk(no, fn, pai = null) {
  if (!no || typeof no !== 'object') return;
  if (Array.isArray(no)) {
    for (const item of no) walk(item, fn, pai);
    return;
  }
  if (typeof no.kind !== 'string') return;
  if (fn(no, pai) === false) return;
  for (const k of Object.keys(no)) {
    if (k === 'kind' || k === 'loc' || k === 'locEnd') continue;
    const v = no[k];
    if (v && typeof v === 'object') walk(v, fn, no);
  }
}

/** Primeiro nó com o `kind` dado, ou null. */
export function find(raiz, kind) {
  let achado = null;
  walk(raiz, (n) => {
    if (n.kind === kind) { achado = n; return false; }
    return true;
  });
  return achado;
}

/** Quantos nós têm o `kind` dado. */
export function count(raiz, kind) {
  let n = 0;
  walk(raiz, (x) => { if (x.kind === kind) n++; return true; });
  return n;
}

export default {
  TranslationUnit, Declarator, PtrOperator, VariableDecl, FunctionDecl,
  ClassDecl, EnumDecl, NamespaceDecl, UsingDecl, TypedefDecl, TemplateDecl,
  StaticAssertDecl, EmptyDecl, LinkageSpec, Identifier, Literal, Unary, Binary, Ternary,
  Call, Index, Member, Assign, Cast, New, Delete, Lambda, InitList, BraceInit,
  Designator, Paren,
  This, TypeId, CompoundLiteral, CompoundStmt, ExprStmt, DeclStmt, IfStmt,
  WhileStmt, DoStmt, ForStmt, RangeForStmt, SwitchStmt, CaseStmt,
  DefaultStmt, BreakStmt, ContinueStmt, ReturnStmt, GotoStmt, LabeledStmt,
  TryStmt, ThrowExpr, BaseSpecifier, Enumerator, isDeclaration, isStatement,
  isExpression, unparse, walk, find, count,
};