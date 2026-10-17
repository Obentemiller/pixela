# AST — o contrato entre o parser e tudo que vem depois

Documento **normativo**. O parser, a sema, o codegen, os goldens e os
diferenciais com `g++`/`clang` dependem dele. Se o código e este documento
divergirem, o documento está errado — corrija o documento junto.

## 1. Princípios

1. **Nada lança.** Todo construtor aceita entrada incompleta e devolve um nó.
   `unparse` devolve string para qualquer coisa, inclusive `null` e um objeto
   `{kind:'BugDesconhecido'}`. O parser nunca lança; ele devolve
   `{ast, diagnostics}`.
2. **Progresso garantido.** Cada iteração do laço do parser consome **pelo
   menos um token**. Um `while` que não consome nada é um bug de laço infinito,
   não um caso raro.
3. **Serializable.** Nenhum nó guarda referência a token, arquivo ou qualquer
   estrutura cíclica. Só dados primitivos e nós filhos. Isso permite
   `JSON.stringify` para comparar goldens e para mandar o AST entre o Worker e
   a thread principal.
4. **Round-trip é identidade.** `parse → unparse → parse` devolve a mesma
   árvore. Verificado em todos os fixtures do projeto por
   `tests/unit/ast-roundtrip.test.js`.

## 2. Anatomia de um nó

Toda função construtora em `js/cpp/ast.js` devolve um objeto com:

| Campo | Tipo | Significado |
|---|---|---|
| `kind` | `string` | Única propriedade obrigatória. Identifica o nó. |
| `loc` | `{line, column}` | Início. Nunca `undefined` — se não houver, é `{line:0, column:0}`. |
| `locEnd` | `{line, column}` | Fim, quando o parser souber. Opcional. |

Propriedades com valor `undefined` são **descartadas** na construção. Sem isso
`Identifier('x')`, que passa `loc` explicitamente como `undefined`, quebraria a
garantia de que todo nó tem `loc`.

Chaves `kind`, `loc` e `locEnd` não são percorridas por `walk`.

## 3. Famílias

`isExpression`, `isStatement` e `isDeclaration` classificam pelo `kind` contra
três conjuntos, **não** contra uma tabela paralela. Um nó novo não pode ser
esquecido na classificação: se o `kind` não está no conjunto, cai em
`declTexto` no unparse e o bug aparece imediatamente.

### 3.1 Expressões

`Identifier`, `Literal`, `Unary`, `PostfixUnary`, `Binary`, `Ternary`, `Call`,
`Index`, `Member`, `Assign`, `Cast`, `Sizeof`, `Alignof`, `New`, `Delete`,
`Lambda`, `InitList`, `Paren`, `This`, `TypeId`, `CompoundLiteral`,
`ThrowExpr`, `Noexcept`

### 3.2 Statements

`CompoundStmt`, `ExprStmt`, `DeclStmt`, `IfStmt`, `WhileStmt`, `DoStmt`,
`ForStmt`, `RangeForStmt`, `SwitchStmt`, `CaseStmt`, `DefaultStmt`,
`BreakStmt`, `ContinueStmt`, `ReturnStmt`, `GotoStmt`, `LabeledStmt`,
`TryStmt`, `CatchClause`, `NullStmt`

### 3.3 Declarações

`TranslationUnit`, `VariableDecl`, `FunctionDecl`, `ClassDecl`, `EnumDecl`,
`NamespaceDecl`, `UsingDecl`, `TypedefDecl`, `TemplateDecl`,
`StaticAssertDecl`, `EmptyDecl`, `BaseSpecifier`, `Enumerator`, `FriendDecl`,
`AccessSpec`

## 4. Catálogo

### 4.1 Expressions

| Nó | Campos | `unparse` |
|---|---|---|
| `Identifier` | `name` | `name` |
| `Literal` | `value`, `literalKind`, `text` | `text`, ou o valor com aspas |
| `Paren` | `expr` | `(expr)` |
| `InitList` | `elements[]` | `{a, b}` |
| `This` | — | `this` |
| `Unary` | `op`, `expr`, `prefix` | `op expr` |
| `PostfixUnary` | `op`, `expr` | `expr op` |
| `Sizeof` / `Alignof` | `target`, `isType` | `sizeof x` / `sizeof(Tipo)` |
| `Noexcept` | `expr` | `noexcept(e)` |
| `Binary` | `op`, `left`, `right` | `l op r` |
| `Ternary` | `cond`, `then`, `other` | `c ? a : b` |
| `Assign` | `target`, `value`, `op` | `t op v` |
| `Call` | `callee`, `args[]` | `c(a, b)` |
| `Index` | `base`, `index` | `b[i]` |
| `Member` | `base`, `name`, `arrow` | `b.x` / `b->x` |
| `Cast` | `typeId`, `expr`, `style` | `(T)e`, `static_cast<T>(e)` |
| `New` | `typeId`, `args[]`, `array` | `new T(x)` / `new T[n]` |
| `Delete` | `expr`, `array` | `delete p` / `delete[] p` |
| `Lambda` | `captures[]`, `params[]`, `body`, `qualifiers[]`, `retType` | `[c](p) qual body` |
| `TypeId` | `expr`, `isType` | `typeid(e)` / `typeid(Tipo)` |
| `ThrowExpr` | `expr` | `throw e` |
| `CompoundLiteral` | `typeId`, `init` | `(T){...}` |

**`TypeId.isType`** existe porque `typeid(1)` e `typeid(int)` são ambos
`typeid(...)` no texto, mas o conteúdo é expressão num caso e tipo no outro.
Sem a flag, o unparse imprime `1` em vez de `typeid(1)`.

### 4.2 Declarators

`Declarator` é a parte mais difícil do C++ e é representada como a gramática do
padrão descreve — de dentro para fora.

| Campo | Significado |
|---|---|
| `name` | `string` ou `null` (declarador abstrato, usado em cast e template) |
| `ptr[]` | `PtrOperator[]` — prefixos `*`, `&`, `&&`, com cv |
| `array[]` | `Expression[]` — sufixos `[N]`, na ordem do texto |
| `params[]` | parâmetros: `VariableDecl` quando há tipo, `Declarator` quando não |
| `temParams` | distingue `f` (não é função) de `f()` (função sem parâmetros) |
| `cvConst` / `cvVolatile` | qualificadores no fim do declarador |
| `refQual` | `'lvalue'` (`&`) ou `'rvalue'` (`&&`) |
| `inner` | `Declarator` — para `int (*f)(int)` |
| `packs` | é parameter pack (`Args...`) |
| `default` | `Expression`\|`null` — argumento default de template (`template<class T = int>`) |

**Por que `params` aceita `VariableDecl`:** um parâmetro é
`<specifier> <declarator>` — `int a`, `const char* nome`. Guardar só o
declarador perderia o tipo e `void f(int a)` sairia como `void f(a)`.

**Ponto de parênteses em `declaradorTexto`:** o `*` é impresso com um espaço
depois (`* x`, `int* a`). Vale para qualquer forma — `*[4]`, `(* f)(int)` — e
o round-trip continua fechando. O alternativo `*x` também compila; o espaço
existe só porque a forma colada lê melhor nos goldens.

### 4.3 Statements

| Nó | Campos |
|---|---|
| `CompoundStmt` | `stmts[]` |
| `ExprStmt` | `expr` |
| `DeclStmt` | `decl` |
| `NullStmt` | — |
| `IfStmt` | `cond`, `then`, `els`, `condInit` |
| `WhileStmt` | `cond`, `body` |
| `DoStmt` | `body`, `cond` |
| `ForStmt` | `init`, `cond`, `update`, `body` |
| `RangeForStmt` | `decl`, `range`, `body` |
| `SwitchStmt` | `cond`, `cases[]`, `init` |
| `CaseStmt` | `value`, `body` |
| `DefaultStmt` | `body` |
| `BreakStmt` / `ContinueStmt` | — |
| `ReturnStmt` | `expr` |
| `GotoStmt` | `label` |
| `LabeledStmt` | `label`, `body` |
| `TryStmt` | `body`, `catches[]` |
| `CatchClause` | `param`, `body` |

`SwitchStmt.cases` guarda `CaseStmt`/`DefaultStmt` **na ordem do texto**, não
em tabelas separadas. A ordem importa para o unparse e para a sema.

### 4.4 Declarações

| Nó | Campos |
|---|---|
| `TranslationUnit` | `decls[]` |
| `VariableDecl` | `specifiers[]`, `declarators[]`, `init` |
| `FunctionDecl` | `specifiers[]`, `declarator`, `body`, `templateParams[]` |
| `ClassDecl` | `specifiers[]`, `name`, `members[]`, `bases[]` |
| `EnumDecl` | `specifiers[]`, `name`, `enumerators[]` |
| `NamespaceDecl` | `name`, `decls[]`, `inline` |
| `UsingDecl` | `name`, `qualified`, `alias` |
| `TypedefDecl` | `specifiers[]`, `declarators[]` |
| `TemplateDecl` | `params[]`, `decl` |

`TemplateDecl.params[]` são `Declarator`, e cada um pode trazer
`default` (§4.2): `template<class T = int>` dá
`params[0].default = TypeId{int}`, e `template<int N = 3>` dá
`params[0].default = Literal{3}`. Sem default, o campo vale `null` —
**nunca `undefined`**, para o schema ser uniforme.

`default` é preenchido, nunca descartado. Descartá-lo daria aceitação
silenciosa com árvore incompleta, que é a classe de defeito que
`enum E` → `EnumDecl{enumerators: []}` exemplify.
| `StaticAssertDecl` | `cond`, `message` |
| `EmptyDecl` | — |
| `BaseSpecifier` | `name`, `access`, `args[]`, `ellipsis` |
| `Enumerator` | `name`, `value` |

`specifiers[]` guarda a **ordem do texto** (`['const', 'int']`), não um tipo
composto. Quem calcula o tipo é a sema, na Fase 3.

## 5. Precedência do unparse

`unparse` só imprime parênteses quando eles são necessários para que
`parse(unparse(n))` devolva `n`. A tabela:

| Nível | Operadores |
|---|---|
| 1 | `,` |
| 2 | `= += -= *= /= %= <<= >>= &= ^= \|=` |
| 3 | `?:` |
| 4 | `\|\|` |
| 5 | `&&` |
| 6 | `\|` |
| 7 | `^` |
| 8 | `&` |
| 9 | `== !=` |
| 10 | `< > <= >=` |
| 11 | `<< >>` |
| 12 | `+ -` |
| 13 | `* / %` |
| 14 | unários, `sizeof`, `new`, `delete`, `throw`, casts |
| 16 | `. ->` |
| 17 | `()` `[]` |
| 20 | literais, identificadores |
| 21 | `( )` explícitos |

Regras especiais:
- Filho **mais fraco** que o pai ganha parênteses (`1 + (2 * 3)` não precisa de
  parênteses em `1 + 2 * 3`).
- Filho de **mesma** precedência e associatividade à esquerda ganha parênteses
  quando é o lado direito: `a - (b - c)`, mas `a - b - c` não.
- O **callee** de uma chamada só precisa de parênteses abaixo da precedência de
  `.`, porque membro e chamada têm a mesma precedência e são associativos à
  esquerda: `obj->f(1)` não vira `(obj->f)(1)`.

## 6. Fora do escopo — e como isso é reportado

Construções reconhecidas mas não implementadas **não** produzem "token
inesperado". Produzem um diagnóstico com código `E02xx` e mensagem que nomeia a
construção.

> **Desvio do enunciado.** O pedido original era `E03xx`. A banda `E03xx` já
> está ocupada por erros **semânticos** (`UNDECLARED_IDENTIFIER`, `TYPE_MISMATCH`,
> `NO_VIABLE_OVERLOAD`, …) em `js/cpp/diagnostics.js`. Usar `E03xx` para
> "construção fora do escopo" faria o mesmo código significar duas coisas
> diferentes. A banda **`E02xx`** (`FEATURE_NOT_SUPPORTED` e afins) é a que já
> existe para isso, e é ela que o parser usa.

Códigos usados:

| Código | Construção |
|---|---|
| `E0201` | `asm` |
| `E0202` | `goto` / rótulos |
| `E0203` | `alignas`, `thread_local` |
| `E0204` | `co_await` / `co_yield` / `co_return` (C++20) |
| `E0205` | operador `operator` sobrecarregado |
| `E0206` | `import` de módulo |
| `E0207` | literais de string largos (`u"..."`, `U"..."`, `L"..."`) |
| `E0208` | atributo `[[...]]` |
| `E0209` | `concept` / `requires` (C++20) |

A regra é: **se o parser reconhece a construção, ele a nomeia no diagnóstico.**
Se ele não reconhece, aí sim é token inesperado — e aí é bug do parser.

## 6.1 Nomes de tipo — TypeNameScope

Um identificador é nome de TIPO se, e somente se, a **TypeNameScope** disser
(`js/cpp/parser.js`, `tiposDoEscopo` / `declaraTipo` / `abreEscopoTipos` /
`fechaEscopoTipos`). As fontes são:

| fonte | exemplo | quem registra |
|---|---|---|
| palavra-chave de tipo built-in | `int`, `char`, `void` | o lexer |
| nome do prelúdio declarado | `std::vector`, `size_t`, `uint8_t` | os headers virtuais (§6.2) |
| declaração vista no arquivo | `struct S{}`, `enum E{}`, `typedef … X`, `using X = …` | `classSpec`, `enumSpec`, `TypedefDecl`, `usingDecl` |
| parâmetro de template | `template<class T>` | `templateDecl` |
| lista de parâmetros | `f(T x)` | `noTipo` |

Os escopos são uma **pilha**: entrar num corpo de função (`bloco()`) ou num
template (`templateDecl`) empilha um conjunto que herda os tipos do pai mas
não os devolve. Um `struct Local {}` declarado dentro de uma função não é tipo
fora dela (teste `P6-S01`).

**Não existe heurística de "nome capitalizado é tipo".** Houve uma
(`463cab7`, `nome.length === 1 && nome[0] >= 'A'`) e ela quebrava `a * b`,
`x < y > z`, `i & j` e `a[i]` — ver `reports/A2/p6.log`.

## 6.2 Prelúdio declarado (§6.2 de T2.5)

Os headers virtuais de `DEFAULT_HEADERS` (`js/cpp/preprocessor.js`) **não são
placeholders vazios**: contêm declarações em C++ mínimo. O pré-processador
cola esse texto antes do parse, e o parser registra cada `struct`/`using`/
`typedef` que vê.

```
< vector >   namespace std { template<class T, class A> struct vector { … }; }
< cstdint >  typedef unsigned char uint8_t; typedef long long int64_t; …
< cstddef >  typedef unsigned long size_t;
< memory >   namespace std { template<class T> struct unique_ptr { … }; … }
```

Isto é **a declaração**, não a implementação — a implementação é a stdlib da
Fase 3. O que a Fase 2 precisa é saber o NOME.

### O virtual NUNCA sombreia um arquivo do disco (R6)

A ordem de busca de `#include` é a normativa — a do compilador:

```
"x"  →  (1) diretório do INCLUDER  →  (2) `includeDirs`  →  (3) virtual
<x>  →  (1) `includeDirs`           →  (2) diretório do INCLUDER  →  (3) virtual
```

O virtual é o **último** passo de propósito. Um header virtual é um STUB do
que o projeto realmente tem em `src/`; se ele vier primeiro, um
`#include "pixela.hpp"` do bridge resolve para `int pix_width()` em vez de
`src/pixela.hpp`, e `class Canvas` nunca chega ao parser — e nada acusava,
porque o arquivo "parseava sem diagnóstico" sem a classe real.

Consequências, todas com teste:

| regra | onde |
|---|---|
| arquivo local com o MESMO nome de um virtual vence, em `"x"` e em `<x>` | `tests/unit/pp-ordem-nomativa.test.js` |
| não existe header virtual `pixela.hpp` (o virtual da API livre é `pixela.h`) | `js/cpp/preprocessor.js` `DEFAULT_HEADERS` |
| o resultado expõe `resolvidos`: os caminhos canônicos que entraram | `Preprocessor.process()` |
| `mesh3d.cpp` carrega `src/pixela.hpp` REAL, com `class Canvas`, 1 vez | `pp-ordem-nomativa.test.js` |

Até o R6 a ordem era `virtual → includeDirs → includer → grafia`, e o
`caso22` era um DESVIO declarado por causa disso. A ordem foi corrigida, o
virtual `pixela.hpp` foi removido e o caso voltou a bater com o `g++`.

### DESVIO: `NOMES_STD_TIPO` ainda existe no parser

`js/cpp/parser.js` mantém `NOMES_STD` / `NOMES_STD_TIPO` / `NOMES_STD_VALOR`
como **último recurso** em `isTypeName`: se o header NÃO foi incluído,
`std::vector` ainda é reconhecido.

Isso é um desvio do princípio acima — o tipo deveria existir só se
declarado. Motivo de ficar: os 12 arquivos do projeto usam `std::` sem que o
cabeçalho virtual correspondente entre antes do uso em todos os casos, e
remover a lista agora quebraria T2.4.

Remoção prevista: quando A1 resolver include dentro do `Preprocessor`
(instead do mapa montado em `tests/tools/parse-project.mjs`), os arquivos
reais terão seus `#include <vector>` resolvidos e o teste
`tests/unit/preludio.test.js::T2.5-X01` passa a exigir que a lista SUMA.

## 7. Percurso da árvore

- `walk(no, fn, pai)` — profundidade; `fn(no, pai)` pode devolver `false` para
  não descer.
- `find(raiz, kind)` — primeiro nó com aquele `kind`, ou `null`.
- `count(raiz, kind)` — quantos.