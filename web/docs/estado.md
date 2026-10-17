# Estado de `js/cpp/` — gerado por `tests/tools/gen-estado.mjs`

> **Não edite este arquivo à mão.** Regenerar com `npm run gen-estado`.
> Gerado em 2026-10-16T02:13:34.334Z

## Regra de status

- **funcional** — `>= 10` testes automatizados PASSANDO no módulo
- **pouco testado** — de 1 a 9 testes passando
- **SEM teste automatizado** — 0 testes passando
- **QUEBRADO** — falha em `node --check` ou no `import()`

A contagem vem da **execução real** das suítes (`node --test --test-reporter=tap`),
não de uma contagem de referências no código. O mapeamento módulo→testes
está em `tests/tools/module-map.json` (mantido à mão e revisado).

## Tabela

| Arquivo | Linhas | `node --check` | Importa em Node | Testes executados | Passaram | Status |
|---|---:|---|---|---:|---:|---|
| `js/cpp/ast.js` | 1037 | ok | ok | 1 arquivo(s) | 20 | funcional (20 testes passando) |
| `js/cpp/codegen.js` | 603 | ok | ok | 1 arquivo(s) | 11 | funcional (11 testes passando) |
| `js/cpp/core.js` | 100 | ok | ok | 0 arquivo(s) | 0 | SEM teste automatizado |
| `js/cpp/diagnostics.js` | 247 | ok | ok | 2 arquivo(s) | 11 | funcional (11 testes passando) |
| `js/cpp/index.js` | 17 | ok | ok | 0 arquivo(s) | 0 | SEM teste automatizado |
| `js/cpp/lexer.js` | 1034 | ok | ok | 4 arquivo(s) | 43 | funcional (43 testes passando) |
| `js/cpp/parser.js` | 3035 | ok | ok | 6 arquivo(s) | 851 | funcional (851 testes passando) |
| `js/cpp/preprocessor.js` | 1479 | ok | ok | 6 arquivo(s) | 171 | funcional (171 testes passando) |
| `js/cpp/scope.js` | 205 | ok | ok | 1 arquivo(s) | 5 | pouco testado (5 de 10 testes passando) |
| `js/cpp/sema.js` | 483 | ok | ok | 1 arquivo(s) | 11 | funcional (11 testes passando) |
| `js/cpp/source.js` | 106 | ok | ok | 2 arquivo(s) | 12 | funcional (12 testes passando) |
| `js/cpp/types.js` | 153 | ok | ok | 1 arquivo(s) | 5 | pouco testado (5 de 10 testes passando) |
| `js/cpp/worker.js` | 205 | ok | n/a (self) | 4 arquivo(s) | 0 | SEM teste automatizado [módulo de Worker: usa self] |

## Consistência

- Soma de `pass` por **arquivo de teste** (Node): 1141
- Total de `node --test` (todos os arquivos): 1141
- Divergência: 0 ✓
- Testes browser (Playwright, à parte): 0 passam

## Detalhes por arquivo

### `js/cpp/ast.js`

- **Linhas:** 1037
- **node --check:** ok (exit 0)
- **import em Node:** ok — exports: `AccessSpec`, `Alignof`, `Assign`, `BaseSpecifier`, `Binary`, `BraceInit`, `BreakStmt`, `Call`, `CaseStmt`, `Cast`, `CatchClause`, `ClassDecl`, `CompoundLiteral`, `CompoundStmt`, `ContinueStmt`, `DeclStmt`, `Declarator`, `DefaultStmt`, `Delete`, `Designator`, `DoStmt`, `EmptyDecl`, `EnumDecl`, `Enumerator`, `ExprStmt`, `ForStmt`, `FriendDecl`, `FunctionDecl`, `GotoStmt`, `Identifier`, `IfStmt`, `Index`, `InitList`, `LabeledStmt`, `Lambda`, `LinkageSpec`, `Literal`, `Member`, `NamespaceDecl`, `New`, `Noexcept`, `NullStmt`, `Paren`, `PostfixUnary`, `PtrOperator`, `RangeForStmt`, `ReturnStmt`, `Sizeof`, `StaticAssertDecl`, `SwitchStmt`, `TemplateDecl`, `Ternary`, `This`, `ThrowExpr`, `TranslationUnit`, `TryStmt`, `TypeId`, `TypedefDecl`, `Unary`, `UsingDecl`, `VariableDecl`, `WhileStmt`, `count`, `default`, `find`, `isDeclaration`, `isExpression`, `isStatement`, `unparse`, `walk`
- **Arquivos de teste no mapa:** `tests/unit/ast.test.js`
- **Testes passando / falhando:** 20 / 0
- **Status:** funcional (20 testes passando)

### `js/cpp/codegen.js`

- **Linhas:** 603
- **node --check:** ok (exit 0)
- **import em Node:** ok — exports: `CodeGenerator`
- **Arquivos de teste no mapa:** `tests/unit/caracterizacao-sema-codegen.test.js`
- **Testes passando / falhando:** 11 / 0
- **Status:** funcional (11 testes passando)

### `js/cpp/core.js`

- **Linhas:** 100
- **node --check:** ok (exit 0)
- **import em Node:** ok — exports: `compile`
- **Arquivos de teste no mapa:** (nenhum)
- **Testes passando / falhando:** 0 / 0
- **Status:** SEM teste automatizado

### `js/cpp/diagnostics.js`

- **Linhas:** 247
- **node --check:** ok (exit 0)
- **import em Node:** ok — exports: `Diagnostic`, `Diagnostics`, `ErrorCodes`, `formatDiagnostic`
- **Arquivos de teste no mapa:** `tests/unit/diagnostics.test.js`, `tests/unit/diagnostics-snapshot.test.js`
- **Testes passando / falhando:** 11 / 0
- **Status:** funcional (11 testes passando)

### `js/cpp/index.js`

- **Linhas:** 17
- **node --check:** ok (exit 0)
- **import em Node:** ok — exports: `CodeGenerator`, `Diagnostic`, `ErrorCodes`, `Lexer`, `Parser`, `Preprocessor`, `Sema`, `SourceFile`, `Token`, `Type`, `compile`, `cppTypeToJS`
- **Arquivos de teste no mapa:** (nenhum)
- **Testes passando / falhando:** 0 / 0
- **Status:** SEM teste automatizado

### `js/cpp/lexer.js`

- **Linhas:** 1034
- **node --check:** ok (exit 0)
- **import em Node:** ok — exports: `KEYWORDS`, `Lexer`, `MODELO_LP64`, `MODELO_WASM32`, `OPERADORES`, `PUNCTUADORES`, `SIMBOLOS`, `TYPES_BUILTIN`, `Token`, `default`, `literalType`, `valorExato`
- **Arquivos de teste no mapa:** `tests/unit/lexer.test.js`, `tests/unit/literal-type.test.js`, `tests/unit/fuzz.test.js`, `tests/unit/bench.test.js`
- **Testes passando / falhando:** 43 / 0
- **Status:** funcional (43 testes passando)

### `js/cpp/parser.js`

- **Linhas:** 3035
- **node --check:** ok (exit 0)
- **import em Node:** ok — exports: `Parser`, `default`
- **Arquivos de teste no mapa:** `tests/unit/parser.test.js`, `tests/unit/parser-fuzz.test.js`, `tests/unit/roundtrip-projeto.test.js`, `tests/unit/projeto.test.js`, `tests/unit/goldens.test.js`, `tests/unit/parser-type-nome.test.js`
- **Testes passando / falhando:** 851 / 0
- **Status:** funcional (851 testes passando)

### `js/cpp/preprocessor.js`

- **Linhas:** 1479
- **node --check:** ok (exit 0)
- **import em Node:** ok — exports: `Preprocessor`, `default`, `resolve`, `splitMacroArgs`
- **Arquivos de teste no mapa:** `tests/unit/preprocessor.test.js`, `tests/unit/preludio.test.js`, `tests/unit/pp-inc.test.js`, `tests/unit/pp-ordem-busca.test.js`, `tests/unit/verify-reports.test.js`, `tests/unit/pp-hideset.test.js`
- **Testes passando / falhando:** 171 / 0
- **Status:** funcional (171 testes passando)

### `js/cpp/scope.js`

- **Linhas:** 205
- **node --check:** ok (exit 0)
- **import em Node:** ok — exports: `Namespace`, `ScopeManager`, `Symbol`
- **Arquivos de teste no mapa:** `tests/unit/scope.test.js`
- **Testes passando / falhando:** 5 / 0
- **Status:** pouco testado (5 de 10 testes passando)

### `js/cpp/sema.js`

- **Linhas:** 483
- **node --check:** ok (exit 0)
- **import em Node:** ok — exports: `Sema`
- **Arquivos de teste no mapa:** `tests/unit/caracterizacao-sema-codegen.test.js`
- **Testes passando / falhando:** 11 / 0
- **Status:** funcional (11 testes passando)

### `js/cpp/source.js`

- **Linhas:** 106
- **node --check:** ok (exit 0)
- **import em Node:** ok — exports: `SourceFile`
- **Arquivos de teste no mapa:** `tests/unit/source.test.js`, `tests/unit/source.prop.test.js`
- **Testes passando / falhando:** 12 / 0
- **Status:** funcional (12 testes passando)

### `js/cpp/types.js`

- **Linhas:** 153
- **node --check:** ok (exit 0)
- **import em Node:** ok — exports: `Type`, `cppTypeToJS`, `rankOverloadConversion`
- **Arquivos de teste no mapa:** `tests/unit/types.test.js`
- **Testes passando / falhando:** 5 / 0
- **Status:** pouco testado (5 de 10 testes passando)

### `js/cpp/worker.js`

- **Linhas:** 205
- **node --check:** ok (exit 0)
- **import em Node:** não aplicável — usa `self`, roda em Worker (ReferenceError: self is not defined)
- **Arquivos de teste no mapa:** `tests/platform/spec-t1-t2-t7.spec.js`, `tests/platform/spec-t4-t6.spec.js`, `tests/e2e/regressao-app.spec.js`, `tests/e2e/browser-version.spec.js`
- **Testes passando / falhando:** 0 / 0
- **Não executados:** tests/platform/spec-t1-t2-t7.spec.js (servidor estático não está no ar (rode `npm run serve`)), tests/platform/spec-t4-t6.spec.js (servidor estático não está no ar (rode `npm run serve`)), tests/e2e/regressao-app.spec.js (servidor estático não está no ar (rode `npm run serve`)), tests/e2e/browser-version.spec.js (servidor estático não está no ar (rode `npm run serve`))
- **Status:** SEM teste automatizado [módulo de Worker: usa self]
