# Pixela Terminal — sua API gráfica de terminal em C++, direto no navegador

Uma página web de página única que funciona como um grande **terminal
gráfico**: você escreve um "main.cpp" no editor à direita, e vê o resultado
renderizado ao vivo do lado esquerdo — tudo executando **localmente, no seu
navegador**, sem nenhum backend/servidor de execução.

O núcleo gráfico é a sua própria biblioteca, **`pixela.hpp`**, incluída
neste projeto **sem nenhuma modificação** (`src/pixela.hpp`): pixels reais
via caracteres Braille Unicode (8 sub-pixels por célula de terminal) e cor
verdadeira via ANSI (`\x1b[38;2;r;g;bm`), mais o motor 3D por software
(`pix::Renderer3D`) que já vem com ela.

Projeto didático e de portfólio, com código 100% aberto (MIT).

```
┌───────────────────────────────────────────────────────────┬────────────────┐
│  PIXELA // Terminal Graphics Engine   [exemplo ▾] [Executar]│  main.cpp      │
├───────────────────────────────────────────────────────────┤────────────────┤
│                                                             │ #include<pixela│
│           (terminal Braille + cor verdadeira,               │ int main(){    │
│            proporção ajustada automaticamente)              │   ...          │
│                                                             │ }              │
│                                                             ├────────────────┤
│                                                             │ console        │
└───────────────────────────────────────────────────────────┴────────────────┘
```

## Sumário

- [Como abrir](#como-abrir)
- [Sua biblioteca, sem modificações](#sua-biblioteca-sem-modificações)
- [Arquitetura](#arquitetura)
- [A API no editor ao vivo: `pix_*`](#a-api-no-editor-ao-vivo-pix_)
- [Por que o editor não roda `pix::Canvas` diretamente](#por-que-o-editor-não-roda-pixcanvas-diretamente)
- [Proporção automática do terminal](#proporção-automática-do-terminal)
- [Estrutura de pastas](#estrutura-de-pastas)
- [Build local dos demos WASM](#build-local-dos-demos-wasm)
- [Publicando no GitHub Pages](#publicando-no-github-pages)
- [Limitações conhecidas](#limitações-conhecidas)
- [Licença](#licença)

## Como abrir

Não há passo de build necessário para usar a página em si — é HTML/CSS/JS
estático. Duas formas de rodar:

1. **GitHub Pages (recomendado):** depois de publicar (veja mais abaixo),
   acesse `https://SEU_USUARIO.github.io/SEU_REPOSITORIO/`.
2. **Localmente:** sirva a pasta com qualquer servidor estático, por exemplo
   `python3 -m http.server 8000` na raiz do projeto, e abra
   `http://localhost:8000`. (Não abra `index.html` direto com `file://` —
   alguns navegadores bloqueiam módulos/scripts carregados assim.)

## Sua biblioteca, sem modificações

`src/pixela.hpp` é exatamente o arquivo que você escreveu — mesma
implementação de `pix::Canvas` (Braille + ANSI true color), mesmo
`pix::Renderer3D`, `pix::Mesh`, `makeCube`/`makeIcosahedron`/`makeTorus`, e
o mesmo comentário no `enableAnsiSupport()`. Nenhuma linha foi alterada.

Isso foi validado de verdade neste projeto (compilado e executado com
`g++ -std=c++17`, incluindo o motor 3D completo) antes de ser incluído.

A única peça nova é uma ponte pequena e não-invasiva,
`src/pixela_wasm_bridge.hpp`, que **só chama a API pública** da sua
`Canvas` (construtor, `clear()`, os métodos `draw*`, e `render()`) e
repassa a string ANSI+UTF-8 resultante para o JavaScript — exatamente como
um emulador de terminal de verdade faria. Ela não acessa nada privado nem
precisa alterar `pixela.hpp` de forma alguma.

## Arquitetura

```
                         ┌───────────────────────────┐
                         │        index.html          │
                         │  (layout: terminal + editor)│
                         └──────────────┬─────────────┘
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              │                         │                         │
     js/terminal.js             js/interpreter.js          js/wasm-loader.js
   (grade de caracteres,      (roda C++ digitado no       (carrega .wasm real,
    canvas, proporção          editor via JSCPP,           compilado a partir
    automática)                 expõe pix_*)                de src/pixela.hpp)
              │                         │                         │
              └─────────────┬───────────┘                         │
                             │                                    │
                  js/pixela-bindings.js                  js/ansi-parser.js
              (reimplementação em JS da                (lê a string ANSI +
               técnica Braille, para o                  Braille que Canvas::
               interpretador)                            render() devolve)
```

Existem **duas camadas de execução**, deliberadamente:

| Camada | Onde vive | Como roda | Para quê serve |
|---|---|---|---|
| Interpretada | `js/pixela-bindings.js` + `js/interpreter.js` | Interpretador C++ em JS ([JSCPP](https://github.com/felixhao28/JSCPP)) rodando o texto do editor | Editar e ver resultado **instantaneamente**, sem compilar nada |
| Compilada | `src/pixela.hpp` (sua biblioteca real) | C++ compilado para WebAssembly com Emscripten, carregado por `js/wasm-loader.js` | Demos de **alta performance** / testes de benchmark (raymarching, motor 3D) |

## A API no editor ao vivo: `pix_*`

O que você digita no editor chama estas funções (implementadas em
`js/pixela-bindings.js`, portadas linha a linha dos algoritmos de
`pixela.hpp` — Bresenham para linha/círculo, etc.):

```cpp
void pix_clear();
void pix_present();                 // "flush": desenha o quadro atual na tela
int  pix_width();                   // resolução em PIXELS (cols*2)
int  pix_height();                  // resolução em PIXELS (rows*4)
double pix_time();                  // segundos desde o início da execução

void pix_set(int x, int y, bool on, int r, int g, int b);
bool pix_get(int x, int y);
void pix_line(int x0, int y0, int x1, int y1, int r, int g, int b);
void pix_rect(int x, int y, int w, int h, bool preenchido, int r, int g, int b);
void pix_circle(int cx, int cy, int raio, bool preenchido, int r, int g, int b);
void pix_triangle(int x0, int y0, int x1, int y1, int x2, int y2, int r, int g, int b);
```

`<cmath>`, `<cstdlib>` (com `rand()`), `<cstdio>` e `<iostream>` também
funcionam no editor, fornecidos pelo próprio JSCPP.

```cpp
#include <pixela.h>

int main() {
    while (true) {
        pix_clear();
        // ... desenhe usando as funções acima (coordenadas em pixels) ...
        pix_present();
    }
    return 0;
}
```

Cada chamada a `pix_present()` marca o fim de um quadro: o motor pausa a
interpretação, pinta o canvas e retoma no próximo `requestAnimationFrame`,
de forma que um `while(true)` comum no C++ vira uma animação de verdade no
navegador, sem travar a aba.

## Uma terceira camada: `pix_mesh_*` (wireframe 3D ao vivo, sem STL)

Além do 2D (`pix_set`/`pix_line`/...) e da camada WASM (`pix::Canvas`/
`pix::Renderer3D` reais), existe uma camada intermediária que fecha boa
parte da distância entre as duas: `pix_mesh_*` (`js/mesh3d.js`), que expõe
um motor de wireframe 3D com rotação e projeção em perspectiva de verdade
**dentro do próprio interpretador**, sem exigir `std::vector`, `struct`,
template, `::`, `auto` nem lambda no C++ que você digita.

```cpp
void pix_mesh_reset();
int  pix_mesh_add_vertex(double x, double y, double z); // retorna o índice
void pix_mesh_add_edge(int i, int j);
void pix_mesh_set_pos(double x, double y, double z);
void pix_mesh_set_angle(double x, double y, double z);
void pix_mesh_spin(double sx, double sy, double sz, double dt); // acumula rotação
void pix_mesh_set_focal(double f);   // 0 = automático (90% da largura em pixels)
int  pix_mesh_draw(int r, int g, int b); // retorna quantas arestas foram desenhadas
```

Veja os exemplos **"Cubo 3D Giratório (wireframe)"**, **"Cena 3D Completa
(estrelas + chão + 3 sólidos)"** e **"Saturno (planeta + anéis + lua,
interpretado)"** no seletor — este último mostra que a mesma técnica
também cobre uma esfera (grade lat/long), um anel achatado com raios e um
sólido pequeno (tetraedro) em órbita própria, sem tocar no interpretador.

**Por que isso foi validado antes de entrar aqui, e não só assumido:** antes
de escrever este README, rodei o interpretador de verdade (pacote `JSCPP`
via npm) fora do navegador para confirmar, um a um, os limites citados
abaixo — inclusive um que não era óbvio: a gramática do JSCPP até
*analisa* `struct`, mas o `interpreter.js` dele não tem nenhum código para
avaliar essa declaração, então `struct` falha em tempo de execução mesmo
sem envolver `std::vector`. Ou seja, mesmo um `Vec3` como struct simples já
não é viável nesta versão do interpretador — não é só o `vector` que falta.

**Por que isso não quebra performance:** o C++ interpretado só monta a
lista de vértices/arestas **uma vez** (com inteiros, `double` e laços — o
mesmo subconjunto já usado no exemplo "Campo de Estrelas") e, a cada
quadro, faz **uma única chamada** a `pix_mesh_draw()`. Toda a parte cara —
seno/cosseno, rotação, projeção em perspectiva e o Bresenham de cada
aresta — roda como JS nativo dentro dessa chamada, e não é
passo-a-passo pelo `dbg.next()` do JSCPP (que é o que realmente custa caro
no interpretador). Em um teste de 200 quadros animados de um cubo girando,
o total de passos do interpretador ficou por volta de 3.700 (~18 por
quadro) — o custo por quadro não escala com a complexidade da malha do
lado do JS, só com o pouco C++ que o usuário escreve para orquestrar as
chamadas.

A matemática (`rotateX/Y/Z`, projeção) é portada linha a linha de
`src/pixela.hpp` (`Vec3::rotate*`, `Renderer3D::project`), na mesma
filosofia já usada em `js/pixela-bindings.js` para o 2D. A limitação real
dessa camada, em troca dessa simplicidade: é só wireframe (`drawLine3D`),
sem preenchimento sombreado com z-buffer por pixel (`Renderer3D::
drawTriangle`) — isso continua sendo trabalho da camada WASM
(`wasm:mesh3d`), que usa o `pix::Renderer3D` real.

## Por que o editor não roda `pix::Canvas` diretamente

Antes de decidir essa arquitetura, testei diretamente (com Node.js +
JSCPP) se o interpretador aguentaria sua classe `Canvas` tal como está.
Resultado: **JSCPP não tem suporte a `<vector>`, `<algorithm>`, nem a
`std::string` como container** — só a um punhado de headers como `<cmath>`,
`<cstdio>`, `<cstdlib>`, `<cstring>`, `<ctime>`, `<iostream>`. Como `Canvas`,
`Mesh` e `Renderer3D` dependem de `std::vector` internamente, não há como
interpretá-los como estão.

Por isso:
- **Editor / "Interpretado"**: usa as funções `pix_*` (uma reimplementação
  em JS da mesma técnica — Braille + cor verdadeira), para permitir digitar
  e rodar C++ instantaneamente.
- **"WASM nativo"** (menu de exemplos): compila `src/pixela.hpp` de
  verdade, sem alterações, via Emscripten — é ali que `pix::Canvas` e
  `pix::Renderer3D` originais rodam, em velocidade nativa.

Um script prototipado no editor com `pix_*` pode depois virar um `.cpp` de
verdade em `src/examples/`, chamando os métodos equivalentes de
`pix::Canvas` (veja `src/shaders/volumetric.cpp`, `src/examples/mesh3d.cpp`
e `src/examples/particles.cpp` como modelos).

## Proporção automática do terminal

O terminal (lado esquerdo) precisa parecer "quadriculado corretamente"
independente de como a janela do navegador é redimensionada. Isso é
resolvido em `js/terminal.js` (classe `TerminalGrid`):

1. Um `ResizeObserver` observa o contêiner do terminal.
2. A cada mudança de tamanho, calculamos o maior número inteiro de
   colunas/linhas de terminal que cabe no espaço disponível **mantendo
   fixa** a razão largura/altura de uma célula de caractere
   (`--cell-aspect`, ~0.56 — que, combinada com a grade Braille 2x4, produz
   sub-pixels praticamente quadrados).
3. O `<canvas>` é redimensionado (via CSS) para o tamanho exato resultante e
   fica centralizado pelo layout flex — em janelas muito largas ou muito
   estreitas o terminal é "letterboxed" (sobra espaço nas bordas) em vez de
   esticar/achatar os glifos.
4. A resolução real do canvas (`canvas.width/height`) é multiplicada pelo
   `devicePixelRatio` para texto nítido em telas HiDPI.
5. Sempre que a grade é redimensionada, `js/main.js` rechama `Pixela.bind()`
   para realocar o buffer de pixels Braille no novo tamanho.

Isso corrige automaticamente qualquer distorção de proporção causada pelo
redimensionamento da página, sem exigir nenhuma ação do usuário.

## Estrutura de pastas

```
.
├── index.html                    # página única (terminal + editor)
├── css/style.css                 # layout, proporção, tema do terminal
├── js/
│   ├── terminal.js                # grade de caracteres + canvas (proporção automática)
│   ├── pixela-bindings.js         # reimplementação JS da técnica Braille (modo interpretado)
│   ├── mesh3d.js                  # motor de wireframe 3D (rotação+projeção) para o interpretador, expõe pix_mesh_*
│   ├── interpreter.js             # roda o main.cpp do editor via JSCPP, expõe pix_* e pix_mesh_*
│   ├── ansi-parser.js             # lê a string ANSI+Braille vinda do WASM (modo compilado)
│   ├── wasm-loader.js             # carrega/roda os módulos .wasm compilados
│   ├── examples.js                # exemplos prontos exibidos no seletor
│   └── main.js                    # liga a UI (botões, editor, console)
├── src/
│   ├── pixela.hpp                  # SUA biblioteca, sem nenhuma alteração
│   ├── pixela_wasm_bridge.hpp      # ponte fina para Emscripten (só usa a API pública)
│   ├── shaders/volumetric.cpp      # raymarching volumétrico com pix::Canvas — benchmark
│   └── examples/
│       ├── mesh3d.cpp               # showcase do pix::Renderer3D (torus + icosaedro)
│       └── particles.cpp            # sistema de partículas — benchmark mais leve
├── build/build.sh                 # compila src/*.cpp -> wasm/*.js/.wasm (Emscripten)
├── wasm/                           # saída do build (gerada; ignorada no git)
├── .github/workflows/deploy.yml   # CI: compila o WASM e publica no GitHub Pages
├── .gitignore                     # ignora wasm/*.js e wasm/*.wasm (regerados pelo CI)
├── .nojekyll
├── LICENSE                        # MIT
└── README.md
```

## Build local dos demos WASM

Só é necessário se você quiser rodar/alterar os exemplos "WASM nativo"
localmente antes de publicar (o GitHub Actions faz isso automaticamente a
cada push — veja abaixo).

```bash
# 1. Instale o Emscripten (uma vez só):
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk && ./emsdk install latest && ./emsdk activate latest
source ./emsdk_env.sh
cd ..

# 2. Compile os demos:
./build/build.sh

# 3. Sirva a pasta e teste:
python3 -m http.server 8000
```

Para adicionar um novo demo compilado: crie `src/examples/meu_demo.cpp`
incluindo `pixela.hpp` e `pixela_wasm_bridge.hpp`, implemente
`void frame(pix::Canvas&, double t, double dt)` (desenhando só com a API
pública de `Canvas`, ou combinando com `pix::Renderer3D`/`pix::Mesh`) e
finalize com `PIXELA_WASM_MAIN(frame)`. Depois adicione uma entrada em
`DEMOS` no `build/build.sh` e uma opção em `index.html`
(`<option value="wasm:meu_demo">`).

## Publicando no GitHub Pages

1. Crie um repositório no GitHub e envie este projeto para ele:
   ```bash
   git init
   git add .
   git commit -m "Pixela Terminal: minha API gráfica de terminal em C++, no navegador"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git
   git push -u origin main
   ```
2. No repositório, vá em **Settings → Pages** e, em **Build and
   deployment**, selecione **Source: GitHub Actions**.
3. O workflow em `.github/workflows/deploy.yml` roda automaticamente:
   instala o Emscripten, compila os demos em `src/` (usando seu
   `pixela.hpp` sem modificações) para WebAssembly e publica o resultado no
   GitHub Pages.
4. Após alguns minutos, o site fica disponível em
   `https://SEU_USUARIO.github.io/SEU_REPOSITORIO/`. Adicione esse link ao
   seu portfólio.

Edite `LICENSE` para colocar seu nome e, se quiser, o link do `#repoLink`
em `index.html` para apontar para o seu repositório.

## Segurança

Este projeto passou por uma revisão de segurança focada em dois lados: o
**visitante** (que roda código C++ arbitrário no próprio navegador) e o
**hospedeiro** (o pipeline de publicação no GitHub Pages). Resumo do que
está em vigor:

- **Sem backend, cookies, `localStorage`/`sessionStorage` ou chamadas de
  rede** — toda a execução é local, no navegador do visitante.
- **Sem `eval()`/`new Function()`**: o "interpretador C++" usa a AST do
  JSCPP, nunca transforma código do usuário em JavaScript executável.
  Toda escrita no DOM usa `textContent`, não `innerHTML`, com o único uso
  de `innerHTML` sendo uma limpeza (`= ''`) sem interpolação de string.
- **JSCPP fixado por commit SHA + Subresource Integrity** em `index.html`
  (não pela branch `gh-pages`, que é mutável): se o arquivo servido pelo
  CDN não bater byte a byte com o hash auditado, o navegador recusa
  executar o script.
- **Content-Security-Policy** restritiva via `<meta>` em `index.html`
  (`default-src 'none'` + allow-list mínima por categoria, com
  `'wasm-unsafe-eval'` liberando apenas `WebAssembly.instantiate`, nunca
  `eval`/`Function` de JS arbitrário).
- **CI de publicação com privilégio mínimo**
  (`.github/workflows/deploy.yml`): `contents: read` por padrão; só o job
  de deploy ganha `pages: write` + `id-token: write` (OIDC de curta
  duração, sem secrets salvos); roda só em `push` para `main` e
  `workflow_dispatch`, nunca em `pull_request`; todas as *actions* de
  terceiros fixadas por commit SHA completo. O `.wasm` é sempre compilado
  a partir de `src/*.cpp` dentro do CI — nunca commitado às cegas.

**Limitação conhecida:** GitHub Pages "puro" não permite cabeçalhos HTTP
customizados, e a diretiva `frame-ancestors` (proteção contra
clickjacking) é ignorada pelo navegador quando definida via `<meta>` — só
funciona em cabeçalho HTTP real. Se isso vier a ser uma preocupação,
a mitigação é colocar um domínio próprio na frente do GitHub Pages (ex.:
Cloudflare, plano gratuito) e configurar `X-Frame-Options`/
`frame-ancestors` lá; não implementado aqui por ser infraestrutura extra
fora do escopo de "publicar no GitHub Pages".

## Limitações conhecidas

- O interpretador (JSCPP) cobre um **subconjunto** de C++ sem
  `<vector>`/`<algorithm>`/`std::string` como container — por isso o editor
  usa as funções `pix_*` em vez da classe `Canvas` real. A camada compilada
  (WASM) não tem essa limitação: roda `pixela.hpp` inteiro, tal como você
  escreveu, incluindo `pix::Renderer3D`.
- `struct` também não funciona no interpretador, mesmo sem `std::vector`
  envolvido: a gramática do JSCPP aceita a sintaxe, mas o avaliador não
  implementa nada para ela (falha em tempo de execução, não de parsing).
  Confirmado rodando o pacote `JSCPP` do npm fora do navegador antes de
  decidir a arquitetura de `pix_mesh_*` — por isso essa camada usa apenas
  inteiros/`double`/arrays de tamanho fixo/funções, nunca `struct`.
- Laços muito longos entre dois `pix_present()` são limitados por um número
  máximo de passos por quadro (`MAX_STEPS_PER_FRAME` em `js/interpreter.js`)
  como proteção contra loops infinitos sem `present()`.
- O carregamento do JSCPP depende de uma CDN pública
  (`cdn.jsdelivr.net`); para um site 100% offline, baixe
  `JSCPP.es5.min.js` e sirva-o localmente em vez do `<script src="https://...">`
  em `index.html`.
- Os módulos `.wasm` não são versionados no git (são build output) — eles
  só existem depois que o CI roda, ou depois que você roda
  `build/build.sh` localmente.
- `js/ansi-parser.js` entende o formato exato que `pix::Canvas::render()`
  produz hoje (SGR `38;2;r;g;b` + reset `0` + Braille). Se você estender
  `render()` para emitir outros códigos ANSI, atualize o parser também.

## Licença

MIT — veja [LICENSE](LICENSE). Uso livre para fins didáticos e de
portfólio, incluindo cópia, modificação e redistribuição.
