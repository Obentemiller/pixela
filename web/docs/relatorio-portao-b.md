# Relatório do Portão B — Fase 1 (lexer, pré-processador, source, diagnostics)

> Este arquivo substitui o relatório que estava apenas na conversa. O número
> de bugs foi corrigido duas vezes: o resumo dizia 13 com uma lista de 16; ao
> acrescentar o diferencial do lexer (H4) a lista chegou a **21**.

## Resumo (5 linhas)

O lexer e o pré-processador foram **reescritos do zero sob TDD** (258 e 95 casos
de corpus), ambos token-based. Com `g++` disponível, os diferenciais passaram a
ser obrigatórios: **71/71 fixtures** no pré-processador e **189/189 literais**
no lexer, contra `g++ -m32`. Os testes acharam **21 bugs reais**, cada um com a
saída original registrada antes da correção. `npm test`: 140/140, exit 0.

## Tabela de testes

| Suíte | Comando | Resultado | exit |
|---|---|---|---|
| `npm test` (Node) | `node --test tests/unit/*.test.js` | **140 passam, 0 falham**, 7.7 s | 0 |
| Lexer (corpus) | `tests/unit/lexer.test.js` | 258/258 casos + 13 invariantes | 0 |
| Preprocessor (corpus) | `tests/unit/preprocessor.test.js` | 95/95 casos + 25 invariantes | 0 |
| **Tipo de literal** | `tests/unit/literal-type.test.js` | **25/25**, oráculo = g++ | 0 |
| Fuzz | `tests/unit/fuzz.test.js` | 2000 casos, seed `0xC0FFEE`, mais lento 1 ms | 0 |
| Round-trip | idem | 36 fontes re-tokenizadas | 0 |
| Propriedades source | `tests/unit/source.prop.test.js` | **40 000 offsets** sem perda | 0 |
| Snapshots de diagnóstico | `tests/unit/diagnostics-snapshot.test.js` | **19 snapshots** com code frame | 0 |
| Arquivos do projeto | `tests/unit/projeto.test.js` | 39/39 | 0 |
| **Diferencial do pré-processador** | `tests/tools/diff-pp.mjs` | **71 iguais, 0 diferentes** | 0 |
| **Diferencial do lexer** | `tests/tools/diff-lexer.mjs` | **189 literais, 0 divergências** | 0 |
| Browser | `npm run test:browser` | 13 passed, 3 skipped | 0 |

**Benchmarks**: lexer 6.33 MB/s (meta ≥ 5); `pixela.hpp` 0.49 ms (meta < 10).

## Os 21 bugs (saída original → correção)

### Lexer — 8 bugs

| # | Original (saída) | Correção |
|---|---|---|
| 1 | `SyntaxError: Invalid or unexpected token` em `lexer.js:73` (literais de controle crus) | literais `\n`/`\t`/`\r`/`\\` reescritos |
| 2 | `tokenize("int x")` retornava `Token{...}`, `l.tokens: 0` | acumular em `this.tokens.push` |
| 3 | `{"code":"E0100","message":"Unknown character: ="}` | `=` adicionado aos operadores |
| 4 | `010`→10, `0b1010`→`ident:"b1010"`, `1'000`→4 tokens | base octal/binária e separadores de dígito |
| 5 | `"\\x41"`→`"x41"`; `R"(x)"`→`ident:"R"` + `string:"(x)"` | escapes hex/octal e raw strings |
| 6 | `->*`→2 tokens; `...`, `<=>`, `<<=`, `>>=`, `&=` não existiam | tabela de casamento por maior comprimento |
| 7 | `@` sumia (0 tokens, sem diagnóstico) | token de tipo `error` + diagnóstico |
| 8 | `{"line":-2,"column":4}` | `posParaLoc` reescrito |

### Pré-processador — 3 bugs

| # | Original (saída) | Correção |
|---|---|---|
| 9 | `RangeError: Invalid array length` + loop infinito (OOM) em `#endif` | laço reescrito com `_blocoCondicional` recursivo |
| 10 | `TypeError: this.macroDefinitions.get is not a function` (Set usado como Map) | um único `Map this.macros` |
| 11 | macros não expandiam; `#`/`##` ausentes; `#else` incorreto | implementação completa de expansão |

### Confirmados contra o g++ antes de corrigir — 4 bugs

| # | Original | Correção |
|---|---|---|
| 12 | `#define SOMA (1 + 2)` tratado como função de 0 params | `(` precisa estar **colado** ao nome |
| 13 | `#pragma` desconhecido era descartado; `g++ -E -P` **preserva** | agora preserva |
| 14 | `#if (6&3)==2 && (6\|3)==7` falhava | avaliador recursivo-descendente com BigInt |
| 15 | curto-circuito inexistente: `#if 0 && 1/0` lançava | curto-circuito real em `&&`, `\|\|`, ternário |

### `source.js` — 1 bug

| # | Original | Correção |
|---|---|---|
| 16 | `offsetToLoc(0)` de texto começando com `\n` devolvia `{line:1, column:0}` | `lastIndexOf('\n', -1)` conta do fim da string |

### Achados do diferencial do lexer (H4) — 5 bugs

`g++ -m32` reproduz o modelo de dados do projeto (wasm32: `long` = 32 bits,
ponteiro = 32 bits — verificado em `reports/H4-m32.log`).

| # | Original (saída) | Correção |
|---|---|---|
| 17 | `u8'a'`, `u'a'`, `U'a'`, `L'a'` → `ident:"L" \| char:97`, **sem diagnóstico**. O padrão exige UM token. | `ePrefixoCharLiteral()` + `charLiteral(pfx)` |
| 18 | `u8'a'` com tipo `char8_t`; g++ -std=c++17 diz `char`. `char8_t` só existe no C++20. | `literalType` recebe `std`; `u8` → `char` abaixo de C++20 |
| 19 | `077` → valor 77; g++ diz 63. `BigInt("0077")` vale 77 em JS — zero à esquerda **não** é octal em JS, ao contrário de C/C++. | `valorExato` usa prefixo explícito `0o` |
| 20 | `2147483648L` → `long`; g++ -m32 diz `long long`. `long` tem 32 bits e 2147483648 não cabe. | a escada de `L` verifica se o valor cabe em `long` |
| 21 | `0x1FFFFFFFF` → `unsigned int`; g++ diz `long long`. Não cabe em `unsigned int` nem em `unsigned long` (32 bits). | a escada de base não decimal recebe o degrau `long long` |

Bugs **meus de harness**, corrigidos antes de contar como divergência (não são
bugs do lexer): programa que só imprimia o tipo e não o valor; `v (long long)`
interpretado pelo compilador como chamada de função; `auto v = "abc"` decaindo
para ponteiro (precisa `auto&`); `__PRETTY_FUNCTION__` terminando em **um** `]`,
não dois; `%lld` imprimindo `-1` para `18446744073709551615ull`; `printf("%s")`
parando em `\0` e `\n` embutidos.

Também corrigi **3 expectativas minhas** que divergiam do g++ (`-128` são dois
tokens; `0b100000000` cabe em `int`; `1,5` não é um literal) e **não** contei
como bug do lexer uma suposta "perda do ponto depois da vírgula" — que era erro
do meu teste: `'1,5'` é literalmente `1` `,` `5`, sem ponto nenhum.

### A classe de bug que o H4 eliminou

O corpus original carregava o **tipo esperado escrito à mão** pelo gerador, por
heurística. A heurística errou em pelo menos 5 casos (`2147483648`,
`4294967295`, `0x80000000`, `0777777777`, e os 30 char anotados como `int` em
vez de `char`). Agora `gen-literais.mjs` escreve **apenas o texto do literal**;
`diff-lexer.mjs` compila cada um com `g++ -m32` e grava o veredito do
compilador em `tests/fixtures/literais.json`. O teste unitário usa esse arquivo
como oráculo. **Ninguém mais chuta o tipo esperado.**

## Não verificado

| Arquivo | Testes | Status |
|---|---:|---|
| `js/cpp/codegen.js` | 0 | **SEM teste** |
| `js/cpp/core.js` | 0 | **SEM teste** |
| `js/cpp/parser.js` | 0 | **SEM teste** (quarentena, reescrito na Fase 2) |
| `js/cpp/sema.js` | 0 | **SEM teste** |
| `js/cpp/index.js` | 8 | pouco testado |
| `js/cpp/scope.js` | 5 | pouco testado |
| `js/cpp/types.js` | 5 | pouco testado |
| `js/cpp/worker.js` | 3 | pouco testado |

## Desvios

1. `emcc` não existe — a comparação de `pixela.hpp` usa `g++` nativo.
2. `docs/estado.md` é gerado por script, nunca escrito à mão.
3. `docs/portao-a.md` e `docs/fase-1.md` foram **apagados** (contradiziam o
   código). As fontes de verdade são `docs/estado.md` (gerado) e este arquivo.
4. Golden ASTs não existem — são da Fase 2.
5. Literais `u"..."`, `U"..."` e `L"..."`: o **tipo** é conferido contra o g++,
   mas o **valor** não — a codificação UTF-16/32 não é implementada e o lexer
   emite `E0203 "prefixo não suportado"`. Marcado `comparaValor: false` no
   corpus.
6. `token.value` de literal inteiro é um `Number` e perde precisão acima de
   2^53. `valorExato(token)` devolve o BigInt exato a partir dos dígitos crus;
   quem precisar do valor integral deve usá-lo.
7. `'\xNN'` com valor > 127 é implementation-defined no padrão. Adotamos
   `char` **com sinal**, como o wasm32 e o `g++ -m32`: `'\xff'` vale -1.
8. `g++ -m32` **existe** nesta máquina (verificado em `reports/H4-m32.log`:
   `long=4 longlong=8 int=4 ptr=4`), então a comparação de literais usa o
   modelo wasm32 diretamente. Se `-m32` sumir, o script recua para LP64,
   pulando literais com sufixo `l`/`ul`/`L`/`UL` e avisando.

## Nota sobre `reports/G.log`

`G.log` era a saída de `npm run test:browser` (T1–T7 + regressão) da rodada do
Portão A. Foi **renomeado** para `reports/test-browser.log` — nome descritivo
em vez de uma letra solta. O conteúdo não mudou.