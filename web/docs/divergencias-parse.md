# Divergências do parser contra `g++` — A3 v2

Medido em `wt-a3` (HEAD `12dd763`), parser de `68ae1b9` + A2 (R6/R7).
Comparador: `g++ -std=c++17 -fsyntax-only` sobre **stub + fixture** — o mesmo
texto que o parser recebe.

Reproduzir:

```sh
cd ../wt-a3
node tests/tools/validate-fixtures.mjs --versao v2   # 108 válidos, 53 inválidos
node tests/tools/diff-parse.mjs --versao v2           # 180 processados
```

---

## 0. Proveniência (S1a)

| | v1 | v2 |
|---|---|---|
| root (abs) | `/home/vtbentemiller/Documentos/pixela-main/wt-a3-base` | `/home/vtbentemiller/Documentos/pixela-main/wt-a3` |
| `git rev-parse HEAD` | `68ae1b91d8835087b6f0d61abb2cad0fe4e0235f` | `12dd763da4374d3c266586e472fb1df6ef96b5a2` |
| `lexer.js` | `ff218890e43e4adb12da0b385c2bc810783e12f6` | `2c278962e95d6f4dbf481d2236cb5e9032dbf399` |
| `preprocessor.js` | `15182f833a480d488c92c1b6dfe3577b3209c417` | `b67b5110994a2fb958832a351a6396795d463a33` |
| `parser.js` | `7ebe655e53c0285e5693ef32d862be4824158b95` | **`c6b325e44250d66b04456954e2933a4b5e28582e`** |
| `ast.js` | `6db58ba61a8acdbd3dcb2ed9a2f820d9de052731` | **`a23cf0fef0ed0b091c2dbb902db1a29df421cb97`** |

`parser.js` e `ast.js` **diferem**. A afirmação anterior "v2 idêntico a v1
porque A2 só mexeu no preprocessor" era **falsa**; a causa real está em §1.

### Prova direta, sem o harness (S1b)

```js
// struct Color{int a,b,c;};
// int main(){ int *p = new int[3]{1,2,3}; Color c = Color{1,2,3}; return c.a; }
=== BASE (68ae1b9) ===
  erros: 4
    E0100 2:32 Esperava ';', encontrado '{'
    E0100 2:38 Esperava ';', encontrado '}'
    E0100 2:56 Esperava ';', encontrado '{'
    E0100 2:62 Esperava ';', encontrado '}'
=== HEAD (e9b6cea) ===
  erros: 0
```

Log: `reports/A3/s1b-prova-direta.log`.

---

## 1. Por que v1 e v2 davam o mesmo número (S2)

**O `std-stub.h` não parseava.** Todo fixture válido divergia por erro **do
stub**, não do fixture.

Stub sozinho, sem nenhum fixture:

```
=== BASE (68ae1b9) ===   parse: 4 diagnósticos
=== HEAD (e9b6cea) ===   parse: 0 diagnósticos
```

Duas construções do stub estavam fora do subconjunto do parser (e foram
removidas, com os bugs registrados em `reports/A3/divergencias-stub.md`):

- `template<class T, class A = int>` — argumento padrão de template
- `extern T x;` — variável com linkage externo

**Guarda de infraestrutura (S2b).** `comStub()` devolve `offsetFixture`; todo
diagnóstico com `loc.line < offsetFixture` é `INFRA` e **faz o harness sair
com exit 2**, em vez de virar contagem de divergência. Sem essa guarda, um stub
quebrado produz "divergências" que não são do parser.

Com a guarda, v1 agora sai com **exit 2** (o base não parseia o stub) e v2 com
**exit 1** (divergências reais).

---

## 2. Reconciliação: 180 escritos, 161 finais (S2c)

```
válidos finais:  108
inválidos finais:  53
escritos:        180
descartados:     19
```

108 + 53 + 19 = **180**. Os 19 descartados estão em
`reports/A3/s2-validate-v2.log`, com o motivo de cada um. Nenhum
"sumiu".

---

## 3. Mapa `kind` do clang ↔ nó nosso (usado por `diff-ast.mjs`)

| clang | nosso | nota |
|---|---|---|
| `FunctionDecl` | `FunctionDecl` | |
| `CXXMethod` | `MethodDecl` | |
| `CXXConstructor` | `CtorDecl` | |
| `CXXDestructor` | `DtorDecl` | |
| `VarDecl` | `VariableDecl` | |
| `FieldDecl` | `FieldDecl` | |
| `RecordDecl` | `ClassDecl` | |
| `ClassTemplateDecl` | `TemplateDecl` | |
| `FunctionTemplateDecl` | `FunctionTemplateDecl` | |
| `TypedefDecl` | `TypedefDecl` | |
| `TypeAliasDecl` | `UsingDecl` | `using X = Y;` |
| `EnumDecl` | `EnumDecl` | |
| `EnumConstantDecl` | `EnumValueDecl` | |
| `NamespaceDecl` | `NamespaceDecl` | |
| `UsingDirectiveDecl` | — | sem nó |
| `UsingDeclaration` | `UsingDecl` | `using a::x;` conflita com o alias |
| `LinkageSpecDecl` | `LinkageSpec` | |
| `StaticAssertDecl` | `StaticAssertDecl` | |

A forma do tipo é comparada por `{base, constEsq, constDir, ptrDepth, ref,
arrayDims}`, extraída do `qualType` do clang por um normalizador e do nosso AST
por outro. **Nunca** se compara string crua.

---

## 4. As 68 divergências de v2 (reconciliadas em S7)

> **Atualizado em S7.** A versão anterior deste arquivo dizia 82 divergências e
> "59 bug do parser", com números que não reconciliavam: o harness media os
> **180 arquivos escritos**, não os **161** que o `g++` aceitou. A tabela de
> classificação abaixo é a reconciliada — **34 bug do parser**, 8 fora de
> escopo, 26 de posição.

```
corpus: 161 processados, 19 descartados
válidos  (108): ok=93  rejeita-indevidamente=15
inválidos(53): ok=0  aceita-indevidamente=16  multiplos-erros=11  posicao=26
soma: 108 + 53 + 19 = 180
```

### 4.0 Classificação (só v2, population = 68)

| divergência | classificação | nº |
|---|---|---:|
| `aceita-indevidamente` | bug do parser (sintático) | 9 |
| `aceita-indevidamente` | fora de escopo (Sema, E02xx) | 7 |
| `rejeita-indevidamente` | bug do parser | 15 |
| `multiplos-erros` | bug do parser | 10 |
| `multiplos-erros` | fora de escopo (Sema, E02xx) | 1 |
| `posicao` | eixo separado (detecta, linha errada) | 26 |
| bug da fixture | — | **0** |
| infraestrutura | — | **0** |
| | **bug do parser** | **34** |
| | **fora de escopo** | **8** |

Classificações permitidas: `bug do parser` | `fora de escopo declarado` (com
E03xx esperado) | `bug da fixture` | `infraestrutura`.
"Fora de escopo" **sem** E03xx esperado não é permitido.

### 4.1 `rejeita-indevidamente` — 22 fixtures válidos que o parser recusa

| fixture | primeiro erro | classificação | repro mínimo |
|---|---|---|---|
| `100-extern-c-linkage.cpp` | `Esperava string literal após extern, encontrado 'int'` | **bug do parser** (A2-BUG-2) | `extern "C" { extern int x; }` |
| `103-trailing-return-template.cpp` | `Esperava declaração, encontrado 'T'` | **bug do parser** | `template<class T> auto f(T x) -> T { return x; }` |
| `17-class-default.cpp` | `Esperava expressão, encontrado 'default'` | **bug do parser** | `struct S { S() = default; ~S() = default; };` |
| `29-ns-alias.cpp` | `Esperava '{', encontrado 'a'` | **bug do parser** | `namespace a { int x; } namespace b = a;` |
| `30-ns-inline.cpp` | `Esperava ';', encontrado 'a'` | **bug do parser** | `inline namespace a { int x; }` |
| `34-tpl-default.cpp` | `Esperava expressão, encontrado 'int'` | **bug do parser** (A2-BUG-1) | `template<class T = int> struct S { T x; };` |
| `35-tpl-especializacao.cpp` | `Esperava 'typename', encontrado '>'` | **bug do parser** | `template<class T> struct S { T x; }; template<> struct S<int> { int y; };` |
| `41-sb-par.cpp` | `Esperava ';', encontrado '('` | **bug do parser** | `auto [a,b] = p;` com `p` de tipo `pair` |
| `42-sb-array.cpp` | `Esperava ']', encontrado ','` | **bug do parser** | `int a[2]; auto [x,y] = a;` |
| `43-sb-struct.cpp` | `Esperava ']', encontrado ','` | **bug do parser** | `struct S{int a;int b;}; auto [x,y] = s;` |
| `44-sb-tupla.cpp` | `Esperava ';', encontrado '('` | **bug do parser** | idem 41 com `tuple` |
| `45-sb-multi.cpp` | `Esperava ']', encontrado ','` | **bug do parser** | idem 43, duas vezes |
| `46-if-init.cpp` | `Esperava declaração, encontrado 'if'` | **fora de escopo declarado** — E0201 esperado (inicializador de statement é C++17advanced) | `if (int x = 1) { }` |
| `47-switch-init.cpp` | `Esperava ';', encontrado ')'` | **fora de escopo declarado** — E0201 | `switch (int x = v) { }` |
| `48-if-init-else.cpp` | `Esperava declaração, encontrado 'if'` | **fora de escopo declarado** — E0201 | idem 46 |
| `49-switch-init-multi.cpp` | `Esperava ';', encontrado ')'` | **fora de escopo declarado** — E0201 | idem 47 |
| `50-if-init-cond.cpp` | `Esperava declaração, encontrado 'if'` | **fora de escopo declarado** — E0201 | `if (int x = 1; x > 0) { }` |
| `58-cast-funcional.cpp` | `Esperava expressão, encontrado 'int'` | **bug do parser** | `int x = int(1.0);` |
| `63-delete.cpp` | `Esperava declaração, encontrado 'delete'` | **bug do parser** | `int* p = new int(1); delete p;` |
| `64-delete-array.cpp` | `Esperava declaração, encontrado 'delete'` | **bug do parser** | `int* p = new int[10]; delete[] p;` |
| `65-new-nothrow.cpp` | `Esperava '(', encontrado ')'` | **bug do parser** | `int* p = new (std::nothrow) int(1);` |
| `85-amb-T-x.cpp` | `Esperava ';', encontrado '('` | **bug do parser** | `struct T { T(int) {} }; T x(1);` |

### 4.2 `aceita-indevidamente` — 23 fixtures inválidos que o parser aceita

**Estes são os mais graves**: fonte com erro de sintaxe que o parser aceita
**sem um único diagnóstico**.

| fixture | por que é inválido | classificação |
|---|---|---|
| `01-inv-falta-ponto-virgula.cpp` | `int x` sem `;` | **bug do parser** |
| `04-inv-else-sem-if.cpp` | `else { }` sem `if` | **bug do parser** |
| `05-inv-int-igual.cpp` | `int = 5;` | **bug do parser** |
| `06-inv-template-nao-fechado.cpp` | template sem `>` | **bug do parser** |
| `09-inv-if-sem-parentese.cpp` | `if { }` | **bug do parser** |
| `10-inv-while-sem-parentese.cpp` | `while { }` | **bug do parser** |
| `11-inv-for-sem-parentese.cpp` | `for { }` | **bug do parser** |
| `12-inv-switch-sem-parentese.cpp` | `switch { }` | **bug do parser** |
| `15-inv-continue-sem-ponto-virgula.cpp` | `continue }` | **bug do parser** |
| `16-inv-decl-sem-tipo.cpp` | `x = 5;` sem tipo | **bug do parser** |
| `19-inv-colchete-fechando.cpp` | `int x = [1];` | **bug do parser** |
| `21-inv-using-sem-nome.cpp` | `using;` | **bug do parser** |
| `22-inv-namespace-sem-chave.cpp` | `namespace a` sem chave | **bug do parser** |
| `24-inv-enum-sem-chave.cpp` | `enum E` sem chave | **bug do parser** |
| `25-inv-cast-sem-tipo.cpp` | `int x = ()(1);` | **bug do parser** |
| `26-inv-new-sem-tipo.cpp` | `auto p = new (1);` | **bug do parser** |
| `27-inv-delete-sem-expr.cpp` | `delete;` | **bug do parser** |
| `30-inv-template-sem-menor.cpp` | `template class T>` | **bug do parser** |
| `31-inv-lambda-sem-colchete.cpp` | `auto f = (int x) { return x; };` | **bug do parser** |
| `34-inv-static-assert-sem-expr.cpp` | `static_assert();` | **bug do parser** |
| `36-inv-extern-c-sem-chave.cpp` | `extern "C" int f(int)` sem `;` | **bug do parser** |
| `38-inv-const-sem-tipo.cpp` | `const x = 1;` | **bug do parser** |
| `45-inv-array-sem-tamanho.cpp` | `int a[];` | **bug do parser** |

### 4.3 `multiplos-erros` — 11 (≤3 exigidos)

| fixture | nº erros | classificação |
|---|---:|---|
| `02-inv-falta-parentese.cpp` | 4 | **bug do parser** |
| `03-inv-falta-chave.cpp` | 4 | **bug do parser** |
| `07-inv-funcao-sem-tipo.cpp` | 4 | **bug do parser** |
| `08-inv-struct-sem-ponto-virgula.cpp` | 4 | **bug do parser** |
| `13-inv-return-sem-ponto-virgula.cpp` | 4 | **bug do parser** |
| `14-inv-break-sem-ponto-virgula.cpp` | 4 | **bug do parser** |
| `17-inv-dupla-chave.cpp` | 4 | **bug do parser** |
| `23-inv-class-sem-ponto-virgula.cpp` | 4 | **bug do parser** |
| `28-inv-operator-sem-nome.cpp` | 4 | **bug do parser** |
| `29-inv-cast-sem-tipo.cpp` | 4 | **bug do parser** |
| `32-inv-sb-sem-colchete.cpp` | 4 | **bug do parser** |

### 4.4 `posicao` — 26

A linha do primeiro erro difere mais de ±1 da do `g++`. Todos os 26 têm o
parser **detectando** o erro; o que erra é a **posição** no texto combinado
(o `g++` reporta a linha do TEXTO, o harness converte para a linha do FIXTURE,
e a conversão é o que precisa de revisão). Requer a regra de ±1 linha do
T2.2.

Classificação: **a definir no T2.2** — pode ser bug do harness de conversão ou
do recovery do parser.

### 4.5 Resumo das classificações

| classificação | nº |
|---|---:|
| bug do parser | **59** |
| fora de escopo declarado, com E03xx (E0201) | 5 |
| bug da fixture | 0 |
| infraestrutura | 0 (o guard jogou para fora) |
| **total divergente** | **82** (61 `ok` das 108 válidas + … ver §2) |

---

## 5. Determinismo

| arquivo | hash |
|---|---|
| `reports/A3/v1/diff-parse.json` | superseded — rodado com o stub que não parseava (ver §1) |
| `reports/A3/v2/diff-parse.json` | reconciliado em S7: 161 processados, 93 ok |
| `reports/A3/v2/diff-ast.json` | `8b488520ff2a58b4fc27eb80afdeb02ee8383492f2fa28c413ea5fa5bb58c0e3` |

Duas execuções consecutivas de cada um dão o MESMO hash (conferido).



---

## 6. O que o despacho de A2 tem que consumir

1. **59 bugs do parser**, cada um em 5 passos, com golden ou teste.
   Começar pelos 23 `aceita-indevidamente`: são fontes inválidas que passam
   limpas.
2. **5 fora de escopo** com E03xx: `if`/`switch` com inicializador de
   statement (C++17). Ou implementar, ou declarar E0201 no parser.
3. **26 `posicao`**: definir a regra de conversão de linha e ver se sobra
   divergência real.
4. **T2.2**: a exigência de ≤3 diagnósticos não se cumpre hoje — 11 fixtures
   dão 4.