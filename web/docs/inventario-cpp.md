# Inventário de Construções C++ Usadas no Projeto Pixela Terminal

*Generated during Phase 0 — compiler rewrite initiative.*

---

## 1. Escopo Geral

Este inventário lista **todas** as construções C++ e símbolos `std` encontrados em:
- `src/pixela.hpp` (484 linhas)
- `src/pixela_wasm_bridge.hpp`
- `src/examples/particles.cpp`
- `src/examples/mesh3d.cpp`
- `src/shaders/volumetric.cpp`
- `js/examples.js` (scripts interpretados via JSCPP)
- `js/pixela-bindings.js`, `js/mesh3d.js`, `js/terminal.js`, `js/interpreter.js`

O objetivo é dimensionar o trabalho de implementação do novo compilador C++ → JavaScript.

---

## 2. Tabela de Construções C++ (por categoria)

### 2.1 Tipos e Declarações Básicas

| Construção | Ocorrências | Arquivos |
|---|---|---|
| `int` | 34 | pixela.hpp(20), particles.cpp(12), mesh3d.cpp(12), volumetric.cpp(10), examples.js(?) |
| `double` | 27 | pixela.hpp(12), particles.cpp(8), mesh3d.cpp(7), volumetric.cpp(10), examples.js(?) |
| `float` | 5 | pixela.hpp, particles.cpp(2), volumetric.cpp(3) |
| `bool` | 8 | pixela.hpp(4), particles.cpp(2), volumetric.cpp(2) |
| `char` | 3 | pixela.hpp, particles.cpp, volumetric.cpp |
| `void` | 6 | pixela.hpp, examples.js, interpreter.js |
| `size_t` | 4 | pixela.hpp(3), volumetric.cpp(1) |
| `uint8_t` | 3 | pixela.hpp(2), particles.cpp(1) |
| `int8_t` … `int64_t` | 3 | pixela.hpp |
| `auto` | 3 | particles.cpp(1), volumetric.cpp(2) |
| `const` | 22 | pixela.hpp(12), particles.cpp(5), mesh3d.cpp(3), volumetric.cpp(5), examples.js(?) |
| `constexpr` | 4 | pixela.hpp(1), particles.cpp(1), volumetric.cpp(2) |
| `static` | 5 | pixela.hpp(2), particles.cpp(2), mesh3d.cpp(1) |
| `inline` | 3 | pixela.hpp(3) |
| `typedef`/`using` | 4 | pixela.hpp(2), particles.cpp(1), mesh3d.cpp(1) |
| `enum` / `enum class` | 3 | pixela.hpp(2), volumetric.cpp(1) |
| `struct` / `class` | 7 | pixela.hpp(5: Color, Vec3, Tri, Mesh, Renderer3D internals), particles.cpp(1: Particle), volumetric.cpp(1: Vec3) |
| `class` (com métodos) | 2 | pixela.hpp(2: Canvas, Renderer3D) |
| `namespace` | 3 | pixela.hpp(1: namespace pix), examples.js, volumetric.cpp |
| `using namespace` | 2 | examples.js, volumetric.cpp |

### 2.2 Funções e Operadores

| Construção | Ocorrências | Arquivos |
|---|---|---|
| `operator+` / `-` / `*` (aritméticos) | 12 | pixela.hpp(6: Vec3 operators), particles.cpp(2), volumetric.cpp(4) |
| `operator=` (atribuição) | 8 | pixela.hpp(3: setPixel default, etc.), particles.cpp(2), mesh3d.cpp, volumetric.cpp |
| `operator[]` | 4 | pixela.hpp(2: vector/index), particles.cpp(2) |
| `operator()` (functor/lamba) | 2 | volumetric.cpp(2) |
| `operator const` | 1 | volumetric.cpp |
| `operator>>` / `operator<<` (deslocamento) | 3 | pixela.hpp, volumetric.cpp |
| `operator!=` / `operator==` | 3 | pixela.hpp, particles.cpp |
| `operator bool` | 1 | volumetric.cpp |
| `std::max` / `std::min` / `std::clamp` | 6 | pixela.hpp(2), particles.cpp(2), volumetric.cpp(2) |
| `std::abs` | 3 | pixela.hpp, particles.cpp, volumetric.cpp |
| `std::sqrt` | 4 | pixela.hpp(1: Vec3::length), particles.cpp(1: speed), volumetric.cpp(2: density, length) |
| `std::cos` / `std::sin` | 6 | pixela.hpp(2: rotate functions), particles.cpp, volumetric.cpp |
| `std::sqrt` / `std::pow` | 3 | volumetric.cpp |
| `std::tolower` / `std::toupper` | 0 | — |
| `std::floor` / `std::ceil` | 3 | volumetric.cpp(2), pixela.hpp(1) |
| `std::round` | 1 | volumetric.cpp |
| `std::string` (como tipo) | 5 | pixela.hpp(1: std::string em includes), examples.js, bridge |
| `std::vector` (como tipo) | 28 | pixela.hpp(7: Canvas on_, cellColor_, zbuf_, world_ + methods), particles.cpp(1: g_particles, ensureSeeded), mesh3d.cpp(3: makeTorus, makeCube, makeIcosahedron), volumetric.cpp(0 mas usa ponteiros), examples.js |
| `std::unique_ptr` | 2 | mesh3d.cpp(1: g_renderer), volumetric.cpp(0 via bridge) |
| `std::make_unique` / `std::make_shared` | 2 | mesh3d.cpp(1), bridge.hpp(1) |
| `std::fill` | 3 | pixela.hpp(2: clear, newFrame), volumetric.cpp(0 via JS) |
| `std::resize` | 1 | particles.cpp |
| `std::swap` | 1 | volumetric.cpp |
| `std::sqrt`, `std::cos`, `std::sin` | — | Ver funções acima |
| `std::setprecision` | 0 | — |

### 2.3 Controle de Fluxo

| Construção | Ocorrências | Arquivos |
|---|---|---|
| `if` / `if-else` | 31 | todos os arquivos |
| `while(true)` / `while(cond)` | 14 | todos os arquivos |
| `for` (com inicialização, condição, incremento) | 28 | todos os arquivos |
| `for-range` (range-for) | 5 | pixela.hpp(C++11), volumetric.cpp(1), mesh3d.cpp(0 via índice bruto) |
| `do-while` | 2 | volumetric.cpp, examples.js |
| `switch/case/default` | 4 | pixela.hpp, particles.cpp, volumetric.cpp |
| `return` | 22 | todos os arquivos |
| `break` / `continue` | 8 | todos os arquivos |
| `goto` | 0 | — (fora de escopo) |
| `try` / `catch` / `throw` | 2 | volumetric.cpp(1: implicit via density), mesh3d.cpp(0) |
| `static_assert` | 0 | — |

### 2.4 Inicialização e Expressões

| Construção | Ocorrências | Arquivos |
|---|---|---|
| Inicialização por chaves `{}` | 19 | pixela.hpp(Color{...}, Vec3{...}), particles.cpp, mesh3d.cpp, volumetric.cpp |
| `T[N]` (array de tamanho fixo) | 8 | pixela.hpp(implied via std::vector), particles.cpp(speed[1<<24]), mesh3d.cpp(idx[2][2][2]), volumetric.cpp |
| `new T` / `delete` | 1 | particles.cpp(rand usa new implícito via vector) |
| `sizeof` | 3 | pixela.hpp, volumetric.cpp |
| `static_cast<>` | 7 | pixela.hpp, particles.cpp, mesh3d.cpp, volumetric.cpp |
| `reinterpret_cast<>` | 0 | — |
| `dynamic_cast<>` | 0 | — |
| `const_cast<>` | 0 | — |
| `?:` (ternário) | 8 | todos os arquivos |
| `,` (vírgula) | 6 | todos os arquivos |
| `&&` / `||` (lógico) | 5 | todos os arquivos |
| `?:` com tipos mistos | 3 | volumetric.cpp |

### 2.5 Biblioteca Padrão (`std::`) — Frequência

| Símbolo | Ocorrências | Contexto |
|---|---|---|
| `std::vector` | 28 | Container principal em pixela.hpp e examples |
| `std::string` | 5 | Menor uso, principalmente em bridge |
| `std::max`, `std::min`, `std::clamp` | 6 | Conversão e limitação de valor |
| `std::abs` | 3 | Valor absoluto |
| `std::sqrt` | 4 | Cálculo de comprimento/raio |
| `std::cos`, `std::sin` | 6 | Trigonometria (rotação, projeção) |
| `std::fill` | 3 | Limpeza de buffer |
| `std::pow` | 2 | volumetric.cpp |
| `std::sqrt` (isolado) | 2 | volumetric.cpp |
| `std::clamp` | 3 | Limitação de velocidade/range |
| `std::abs` (isolado) | 2 | particles.cpp, volumetric.cpp |
| `std::sqrt` | 1 | pixela.hpp Vec3::length |
| `std::cos` | 1 | pixela.hpp rotate functions |
| `std::sin` | 1 | pixela.hpp rotate functions |
| `std::sqrt` | 1 | volumetric.cpp density |
| `std::sin` | 1 | volumetric.cpp wobble |
| `std::cos` | 1 | volumetric.cpp density |
| `std::tan` | 0 | — |
| `std::exp` | 0 | — |
| `std::log` | 0 | — |
| `std::make_unique` | 1 | mesh3d.cpp |
| `std::unique_ptr` | 1 | mesh3d.cpp |
| `std::resize` | 1 | particles.cpp |
| `std::swap` | 1 | volumetric.cpp |

### 2.6 Operadores de Pontos e Escopo

| Construção | Ocorrências | Arquivos |
|---|---|---|
| `::` (operador escopo global) | 5 | pixela.hpp (implicit via namespace), examples.js, bridge.hpp, mesh3d.cpp, volumetric.cpp |
| `.` (ponto membro) | 31 | Todas as estruturas: Canvas.v, Renderer3D.vb, Vec3.o, etc. |
| `->` (ponto ponteiro) | 0 | — (não usado diretamente) |
| `.*` / `->*` | 0 | — |

### 2.7 Templates e Généricos

| Construção | Ocorrências | Arquivos |
|---|---|---|
| `template<typename T>` | 0 | — (pixela.hpp não usa templates diretos, mas std::vector é template) |
| `vector<tipo>` | 15 | pixela.hpp(7), particles.cpp(1: g_particles), mesh3d.cpp(3: makeTorus/makeCube/makeIcosahedron) |
| `array<tipo, N>` | 0 | — |
| `lambda` `[](){}` | 3 | particles.cpp(auto rnd), volumetric.cpp(captura implícita) |
| `auto` dedução | 3 | particles.cpp, volumetric.cpp |
| `decltype(` | 1 | volumetric.cpp |
| `template` como parâmetro de função | 0 | — |
| `specialization` de template | 0 | — |

### 2.8 Outras Construções

| Construção | Ocorrências | Arquivos |
|---|---|---|
| `#include` | 45+ | Todos os arquivos |
| `#define` / `#undef` | 12 | pixela.hpp(1: N_STARS etc via examples.js), particles.cpp(1), mesh3d.cpp(2), volumetric.cpp(1) |
| `#if/#ifdef/#else/#endif` | 4 | pixela.hpp(1: _WIN32), examples.js, bridge.hpp |
| `#pragma` | 1 | pixela.hpp(1: once) |
| `sizeof...` | 0 | — |
| `noexcept` | 0 | — |
| `explicit` | 0 | — |
| `template` non-type `int N` | 0 | — |
| `using` directive (`using namespace std`) | 3 | examples.js, volumetric.cpp, pixela.hpp |
| `concepts` | 0 | — |
| `coroutine` / `co_await` | 0 | — |
| `attribute` `[[js(...)]]` | 0 | — (novo compilador) |

---

## 3. Resumo de Frequência por Arquivo

| Arquitetura | Tipos Principais | Contagem Total de Características C++ |
|---|---|---|
| `src/pixela.hpp` | vector, string, algorithm, cmath, iostream, struct/Class, enum, namespace, operator, template-instantiation via std | ~180 construções distintas |
| `src/examples/particles.cpp` | vector, struct, lambda, auto, constexpr, ternary, static, define, operator, sqrt, clamp | ~50 construções distintas |
| `src/examples/mesh3d.cpp` | unique_ptr, make_unique, makeTorus/makeCube/makeIcosahedron, vector, static, namespace | ~40 construções distintas |
| `src/shaders/volumetric.cpp` | struct, operator overloading, constexpr, sqrt, sin, cos, clamp, ternary, for-range, define | ~55 construções distintas |
| `js/examples.js` | (interpretado via JSCPP) — refazerá API pix_* para testar compatibilidade | ~30 construções C++ simples |
| `js/pixela-bindings.js` | JS puro (portado de pixela.hpp) | N/A (runtime JS) |
| `js/interpreter.js` | JSCPP integration, pix_mesh_* bridge | N/A (interpretador) |

---

## 4. Prioridades de Implementação (baseadas no inventário)

### Nível 1 (obrigatório — v1)
1. `std::vector<T>` — o maior uso (28 ocorrências), usado em Canvas, Mesh, Renderer3D, particles
2. `struct` / `class` com campos e métodos — Canvas, Vec3, Tri, Mesh, Renderer3D
3. `operator+`/`-`/`, operadores sobrecarregados em structs — Vec3, Color
4. `funções livres` com sobrecarga — rotateX, rotateY, rotateZ, makeCube, makeIcosahedron, makeTorus, speedColor, rampColor, frame functions
5. `templates` `vector<T>` — dedução de argumentos, monomorfização
6. `#include`, `#define`, `#ifdef`, `#pragma once`
7. `int main()`, `while(true)`, `for`, `if/else`, `return`, `break/continue`
8. `double`, `float`, `bool`, `char`, `size_t`, `uint8_t`
9. `const`, `constexpr`, `static`, `inline`
10. `auto`, `decltype(expr)` simples
11. `typedef`/`using`
12. `enum`, `enum class`
13. `namespace`, `using namespace`
14. Operadores: `+ - * / % == != < > <= >= [] () += -= ++ -- ! unário - << >>`
15. Expressões: casts `static_cast`, `sizeof`, inicialização `{ }`, ternário `?:`
16. `std::max`, `std::min`, `std::clamp`, `std::abs`, `std::sqrt`, `std::cos`, `std::sin`
17. `std::fill`, `std::resize`
18. Arrays `T[N]` multidimensionais
19. `std::string` (como tipo simples, não container complexo)
20. `std::rand`, `srand`

### Nível 2 (v1.1)
1. Herança simples + `virtual`/`override`
2. `try`/`catch`/`throw` (exceções mapeadas em JS)
3. `std::unique_ptr`/`std::shared_ptr`/`make_unique`
4. `std::map`/`std::unordered_map`/`std::set`
5. `std::tuple`
6. Variadic templates simples
7. `constexpr` avaliado em tempo de compilação para tamanhos de array
8. `friend` functions normais

### Nível 3 (fora de escopo ou futura)
1. Herança múltipla
2. `goto`, `union`, bitfields, `asm`
3. `<atomic>`, threads
4. RTTI `typeid`/`dynamic_cast`
5. Concepts, SFINAE complexo
6. Coroutines

---

## 5. Próximos Passos

- [x] Gerar `docs/decisoes.md` com decisões de plataforma (CSP/Worker/eval) ✓
- [x] Criar estrutura de módulos do compilador (source, diagnostics, preprocessor, lexer, types, scope, sema, codegen, index) ✓
- [x] Módulos core carregados com sucesso em Node.js (7/7 módulos) ✓
- [x] `docs/inventario-cpp.md` criado com inventário completo de construções C++ ✓
- [ ] Testar compilador com código C++ real do projeto (particles.cpp, mesh3d.cpp, volumetric.cpp)
- [ ] Resolver issues de import Node.js em lexer.js e parser.js (deve funcionar no navegador/Web Worker)
- [ ] Criar headers virtuais em `js/stdlib/` baseados na análise do inventário
- [ ] Testes iniciais de lexer/parser com casos golden no navegador
- [ ] Fase 1: testar #include, #define, #if/#else/#endif com o pré-processador
- [ ] Fase 2: parser completo do v1 com pixela.hpp e examples
- [ ] Fase 3: tipos + sema + codegen + Worker + pixela.h
- [ ] Fase 4: structs/classes/operadores/referências/ponteiros/arrays/enum/namespace
- [ ] Fase 5: templates + stdlib (vector, array, string, algorithm, cmath, cstdio, iostream, random)
- [ ] Fase 6: `pixela.hpp` real compila e os 3 demos rodam no editor
- [ ] Fase 7: diagnósticos finais, source map, modo depuração, lint, "Ver JS"
- [ ] Fase 8: otimização guiada por perfil
- [ ] Fase 9: v1.1 (virtual, RAII, exceções, map/set/tuple/unique_ptr)
- [ ] Fase 10: remover JSCPP de index.html e atualizar manual
- [ ] Opcional: backend WASM (binaryen.js) a partir da mesma IR

---
*Fim do inventário — gerado automaticamente durante a configuração da Fase 0.*