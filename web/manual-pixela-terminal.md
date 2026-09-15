# Manual do Pixela Terminal — como programar animações nessa API gráfica de navegador

Bem-vindo(a) ao manual oficial (e não-oficialmente engraçadinho) do **Pixela
Terminal**. Se você quer desenhar, animar e criar coisas em C++ dentro dessa
página, sem instalar compilador nenhum, este documento é pra você.

---

## 1. O que é isso, afinal?

O Pixela Terminal é uma página web de página única. Você escreve um
`main.cpp` no editor à direita, aperta **Executar**, e o resultado aparece
ao vivo do lado esquerdo — um "terminal gráfico" onde cada caractere Unicode
Braille vira 8 sub-pixels coloridos (2 colunas x 4 linhas por célula).

Sim, é isso mesmo: seu terminal está mentindo pra você o tempo todo,
fingindo ser um monitor de verdade usando pontinhos Braille como se fossem
pixels. A biblioteca `pixela.hpp` é quem inventou essa gambiarra genial —
e o editor ao vivo imita exatamente a mesma técnica, só que em JavaScript
por baixo dos panos.

## 2. Onde isso está rodando, exatamente?

**Na sua máquina. Só na sua máquina. Sempre na sua máquina.**

Não existe backend, não existe servidor recebendo seu código, não existe
nuvem misteriosa compilando nada por você. Quando você clica em
"Executar":

1. O texto do seu `main.cpp` vira uma string em JavaScript.
2. Essa string é entregue a um interpretador de C++ escrito em JavaScript
   (chamado **JSCPP**), que já está carregado na própria página.
3. O JSCPP lê seu C++ e o executa **dentro do seu navegador**, pixel a
   pixel, quadro a quadro.
4. O resultado é pintado direto no `<canvas>` da página.

Ou seja: o "computador" que roda seu programa é o mesmo notebook/celular
que está com essa aba aberta agora. Se você fechar a aba, a "máquina
virtual" some com ela — não tem estado salvo em lugar nenhum, a não ser
que você copie seu próprio código pra guardar.

## 3. O que significa "código interpretado" (e por que isso é bizarramente lento e maravilhoso ao mesmo tempo)

Existem duas formas de rodar C++:

- **Compilar**: transformar o C++ inteiro em código de máquina *antes* de
  rodar, uma vez só, e depois executar isso direto no processador. É
  rápido, mas quebra a mágica de "editar e ver na hora" — você tem que
  recompilar toda vez.
- **Interpretar**: ler o código *enquanto* ele roda, uma instrução de cada
  vez, decidindo o que fazer na hora. É mais lento, mas permite rodar
  instantaneamente qualquer coisa que você digitar, sem esperar compilação
  nenhuma.

O editor ao vivo do Pixela Terminal faz a segunda opção. O JSCPP lê a
árvore sintática do seu programa (o "AST", uma estrutura em árvore que
representa cada `if`, cada `for`, cada chamada de função) e vai andando
nó por nó, tipo um estagiário lendo sua receita de bolo em voz alta,
etapa por etapa, conferindo cada ingrediente antes de fazer o próximo
passo — sem nunca decorar a receita inteira de uma vez.

Cada um desses "passos" é chamado de *step*. Uma linha simples como
`x = x + 1;` já custa vários steps (ler `x`, ler `1`, somar, guardar de
volta em `x`). Um `while(true)` com contas de seno e cosseno dentro pode
custar centenas de milhares de steps por segundo... e o motor não tem
vergonha nenhuma de contar cada um "ksksksksk".

## 4. O modelo de quadro: como um `while(true)` vira uma animação sem travar a página

Isso é o pulo do gato. Um `while(true)` comum em C++ nativo trava o
programa pra sempre (ou até você fechar). Num navegador, um loop infinito
sem pausa trava a **aba inteira** — sem desenhar nada, sem responder a
clique, nada.

O Pixela Terminal resolve isso com um contrato bem simples entre você e o
motor: toda vez que seu código chama `pix_present()`, o motor entende isso
como "pronto, terminei de desenhar este quadro" e:

1. Pausa a interpretação exatamente ali.
2. Pinta o que foi desenhado até agora na tela.
3. Devolve o controle pro navegador (que respira, atualiza a interface,
   processa outros eventos).
4. Agenda a continuação do seu código pro próximo quadro de animação
   (`requestAnimationFrame`), tipicamente ~60 vezes por segundo.
5. Repete, pra sempre — até você clicar em "Parar" ou o programa dar
   `return`.

Ou seja: seu `while(true) { pix_clear(); ...desenha...; pix_present(); }`
não é um loop infinito de verdade aos olhos do navegador — é uma sequência
de miniprogramas curtos, um por quadro, que o motor vai disparando
educadamente, um de cada vez, esperando a vez de cada um "ksksksksk".

Existe até uma trava de segurança (`MAX_STEPS_PER_FRAME`, 300 mil passos):
se seu código, por algum motivo, nunca chamar `pix_present()` dentro de um
quadro (por exemplo, um loop que esqueceu de desenhar), o motor desiste
depois de 300 mil passos pra não travar a aba pra sempre. É tipo um
professor que só espera até certo ponto antes de dizer "ok, próximo
aluno" — sem dó ...

## 5. As três camadas do projeto (e por que existem)

| Camada | O que é | Quando usar |
|---|---|---|
| **2D interpretado** | Funções `pix_*` (linha, círculo, retângulo, pixel) rodando ao vivo via JSCPP | Sempre que quiser algo rápido de editar |
| **3D interpretado** (`pix_mesh_*`) | Um "motor de malha" simplificado, também ao vivo via JSCPP | Cubos, esferas, wireframes girando, sem compilar nada |
| **WASM compilado** | A biblioteca `pixela.hpp` real, com `pix::Canvas`/`pix::Renderer3D`, compilada de verdade via Emscripten | Demos de alta performance, C++ moderno completo |

A pergunta óbvia é: por que não usar sempre a camada WASM, já que ela tem
tudo (`std::vector`, classes, templates)? Resposta: porque ela exige
compilar antes de rodar — perde a mágica de "editar e ver na hora" que é o
ponto inteiro do editor ao vivo. A camada WASM é ótima pra *ver* o que a
biblioteca de verdade faz, mas não dá pra editar e rodar instantaneamente
o C++ moderno dela ali na hora.

## 6. Por que o editor ao vivo NÃO entende C++ moderno (a parte triste, mas engraçada)

O JSCPP foi feito pra ensinar lógica básica de programação, não pra ser um
compilador de produção. Ele **não sabe rodar**:

- **`::` (operador de escopo)** — `std::`, `pix::` fazem ele entrar em
  pânico. Pergunte pro JSCPP o que é escopo e ele te olha com a mesma cara
  de quem nunca ouviu falar de CPF ...
- **Templates** (`vector<Mesh>`) — ele não sabe se `<` e `>` são "menor
  que"/"maior que" ou se estão delimitando um tipo genérico. Pra ele, todo
  `<` é uma comparação matemática tentando desesperadamente dar certo
  "ksksksksk".
- **C++11 pra frente**: lambda (`[](){}`), `auto`, inicialização por
  chaves `{}` — simplesmente não existem no vocabulário dele. É como pedir
  pra alguém que só fala latim mandar um áudio de WhatsApp.
- **A Standard Template Library inteira** — sem `std::vector`,
  `std::string` (como container) nem `<algorithm>`. Ele até "lê"
  `struct`, mas quando chega a hora de *usar* de verdade, trava — o
  parser aceita a ideia, o motor de execução finge que nunca ouviu falar
  nela ...

Traduzindo: escreva em C básico — `int`, `double`, `bool`, arrays de
tamanho fixo, funções globais, ponteiros, `for`/`while`/`if` simples. Nada
de classes, nada de `new`, nada de bibliotecas modernas. É C++ "estilo
1998, sem internet ainda inventada".

## 7. A camada `pix_mesh_*`: como fazer 3D de verdade sem `std::vector`

Aqui está o truque mais esperto do projeto. Em vez de reescrever
`std::vector` inteiro do zero dentro do JavaScript (o que seria bizarro e
lento), o projeto faz o seguinte: toda a parte cara — a lista dinâmica de
vértices e arestas, seno, cosseno, rotação, projeção em perspectiva,
Bresenham pra desenhar cada linha — roda **nativa em JavaScript**, fora do
interpretador. O seu C++ só chama funções simples, tipo:

```cpp
pix_mesh_reset();                          // limpa a malha atual
int i = pix_mesh_add_vertex(x, y, z);      // adiciona um vértice, devolve o índice
pix_mesh_add_edge(i, j);                   // liga dois vértices com uma aresta
pix_mesh_set_pos(x, y, z);                 // posição da malha no mundo
pix_mesh_set_angle(rx, ry, rz);            // ângulo de rotação (radianos)
pix_mesh_spin(sx, sy, sz, dt);             // acumula rotação (útil dentro do loop)
pix_mesh_set_focal(f);                     // 0 = automático
pix_mesh_draw(r, g, b);                    // desenha a malha (wireframe)
```

Pra quem se pergunta "espera, então o C++ interpretado nem faz a conta
pesada?" — exatamente. Seu programa só monta a lista de vértices/arestas
**uma vez** (ou uma vez por objeto, por quadro), com inteiros e `for`
simples, e depois chama `pix_mesh_draw()`. Toda a trigonometria roda como
JS puro, sem custar um único "passo" do interpretador. Foi medido: um
cubo girando por 200 quadros custa uns 3.700 passos no total — ou seja,
uns 18 passos por quadro. O JSCPP mal percebe que está trabalhando
"ksksksksk".

**Limitação a saber**: só existe **um** "slot" de malha global. Se você
quiser desenhar vários sólidos ao mesmo tempo (um cubo E uma esfera, por
exemplo), você precisa desenhar um, chamar `pix_mesh_draw()`, resetar com
`pix_mesh_reset()`, montar o próximo, desenhar de novo — um de cada vez,
por quadro. É tipo ter só uma mesa de jantar em casa: dá pra receber
várias visitas, mas uma de cada vez, com a mesa sendo remontada entre uma
visita e outra ...

## 8. Referência rápida — funções disponíveis no editor ao vivo

### 2D (`js/pixela-bindings.js`)

| Função | O que faz |
|---|---|
| `pix_clear()` | apaga o quadro atual |
| `pix_present()` | fecha o quadro, pinta a tela, marca fim de "frame" |
| `pix_width()` / `pix_height()` | resolução real em pixels (não em colunas de terminal!) |
| `pix_time()` | segundos desde que o programa começou a rodar |
| `pix_set(x, y, on, r, g, b)` | liga/desliga um pixel com uma cor |
| `pix_get(x, y)` | lê se um pixel está ligado |
| `pix_line(x0, y0, x1, y1, r, g, b)` | linha (Bresenham) |
| `pix_rect(x, y, w, h, filled, r, g, b)` | retângulo |
| `pix_circle(cx, cy, radius, filled, r, g, b)` | círculo |
| `pix_triangle(x0, y0, x1, y1, x2, y2, r, g, b)` | triângulo (contorno) |

### 3D (`js/mesh3d.js`)

| Função | O que faz |
|---|---|
| `pix_mesh_reset()` | zera a malha atual (vértices, arestas e ângulo acumulado) |
| `pix_mesh_add_vertex(x, y, z)` | adiciona vértice, devolve o índice (`int`) |
| `pix_mesh_add_edge(i, j)` | liga dois vértices já adicionados |
| `pix_mesh_set_pos(x, y, z)` | posição da malha no espaço 3D |
| `pix_mesh_set_angle(rx, ry, rz)` | ângulo absoluto de rotação |
| `pix_mesh_spin(sx, sy, sz, dt)` | soma rotação ao ângulo acumulado (ótimo dentro do loop) |
| `pix_mesh_set_focal(f)` | distância focal da câmera (`0` = automático) |
| `pix_mesh_draw(r, g, b)` | desenha todas as arestas visíveis, devolve quantas foram desenhadas |

Atenção: `pix_mesh_reset()` zera o ângulo acumulado interno. Se você
remontar um objeto todo quadro (pra ter mais de um sólido na cena), guarde
o ângulo dele **na mão**, em variáveis suas, e passe pra
`pix_mesh_set_angle()` de novo depois do reset — senão sua rotação
"esquece" tudo a cada quadro, tipo peixinho dourado "ksksksksk".

## 9. Passo a passo: sua primeira animação

1. Todo programa começa com `#include <pixela.h>` e um `int main()`
   comum.
2. Dentro de um `while(true)` (ou `while(frame < N)` se quiser que pare
   sozinho), a estrutura básica é sempre:
   ```cpp
   pix_clear();
   // ... desenhe algo com pix_set/pix_line/pix_circle/pix_mesh_* ...
   pix_present();
   ```
3. Use `pix_time()` pra animar coisas de forma suave (multiplique por uma
   velocidade), em vez de contar quadros manualmente — assim sua animação
   não fica mais rápida ou mais lenta dependendo do FPS do computador de
   quem está vendo.
4. Use `pix_width()`/`pix_height()` em vez de números fixos, porque a
   resolução muda dependendo do tamanho da janela/terminal.
5. Clique em **Executar** (ou `Ctrl+Enter`). Pra parar, **Parar**. Pra
   voltar ao código original do exemplo selecionado, **Resetar**.

### Exemplo mínimo (2D)

```cpp
#include <pixela.h>

int main() {
    double x = 10, y = 10, vx = 1.1, vy = 0.8;
    while (true) {
        int w = pix_width();
        int h = pix_height();
        x = x + vx;
        y = y + vy;
        if (x < 4 || x > w - 4) vx = -vx;
        if (y < 4 || y > h - 4) vy = -vy;

        pix_clear();
        pix_circle((int)x, (int)y, 4, true, 255, 210, 80);
        pix_present();
    }
    return 0;
}
```

### Exemplo mínimo (3D)

```cpp
#include <pixela.h>

int main() {
    pix_mesh_reset();
    pix_mesh_set_pos(0.0, 0.0, 50.0);
    int a = pix_mesh_add_vertex(-15, -15, -15);
    int b = pix_mesh_add_vertex( 15, -15, -15);
    int c = pix_mesh_add_vertex( 0,   15,   0);
    pix_mesh_add_edge(a, b);
    pix_mesh_add_edge(b, c);
    pix_mesh_add_edge(c, a);

    while (true) {
        pix_clear();
        pix_mesh_spin(0.0, 1.0, 0.0, 0.016);
        pix_mesh_draw(120, 220, 255);
        pix_present();
    }
    return 0;
}
```

## 10. Erros comuns (e como não perder a cabeça com eles)

- **`variable pix_mesh_reset does not exist`** — quase sempre é
  `js/mesh3d.js` não carregado antes de `js/interpreter.js`, ou o
  navegador com a versão antiga em cache. Solução: recarregamento
  forçado (`Ctrl+Shift+R`), e enquanto estiver desenvolvendo deixe o
  DevTools aberto com "Disable cache" marcado. O navegador tem uma
  memória teimosa de elefante quando o assunto é JavaScript
  "ksksksksk".
- **Programa "trava" sem desenhar nada** — provavelmente você entrou num
  loop sem chamar `pix_present()`. Depois de 300 mil passos o motor
  desiste sozinho e mostra um erro — ele não é rancoroso, só cansado ...
- **Uso de `::`, `<vector>`, `auto`, lambda** — o JSCPP nunca vai entender
  isso, não importa quantas vezes você tente. Reescreva em C básico, ou
  mude pra camada WASM se precisar mesmo de C++ moderno de verdade.
- **Animação rápida demais/devagar demais em computadores diferentes** —
  use `pix_time()` (segundos reais) pra controlar velocidade, nunca conte
  quadros como se fossem tempo fixo.
- **Mais de um sólido 3D sumindo ou girando errado** — lembre que
  `pix_mesh_reset()` também zera o ângulo acumulado; guarde o ângulo de
  cada objeto em variáveis próprias fora do reset.

## 11. Quando usar a camada WASM em vez da interpretada

Se seu projeto precisa de:

- `std::vector`, classes, templates, C++ moderno de verdade;
- Muita performance (o Bresenham de milhares de pixels por quadro fica
  pesado no interpretador, porque cada `pix_set` chamado *do C++* ainda
  passa pelo passo-a-passo do JSCPP);
- Rodar a biblioteca `pixela.hpp` sem nenhuma modificação, exatamente como
  ela é usada num terminal nativo de verdade;

...então a resposta é: escreva um `.cpp` de verdade em `src/examples/` e
compile via `build/build.sh` (precisa do Emscripten instalado) ou pelo
workflow do GitHub Actions do repositório. O resultado vira um módulo
`.wasm` que roda **nativo** no seu navegador — sem interpretação
passo-a-passo nenhuma, na velocidade real do seu processador.

A troca é simples: você ganha C++ completo e performance real, mas perde
a edição instantânea. Não tem almoço grátis nem em WebAssembly
"ksksksksk".

---

Curtiu o manual? Ótimo. Agora vá quebrar (ou melhor, girar, piscar e
explodir em partículas) alguns pixels.

---

## 12. Por que esse projeto existe, na real

Vale ser transparente: o Pixela Terminal não é (só) uma ferramenta séria
de produção — é, antes de tudo, uma forma de divulgar a biblioteca
**Pixela** pro mundo de um jeito que dá pra brincar sem instalar nada, e
também um projeto de aprendizado pessoal sobre criação de páginas web,
JavaScript "no osso" e processamento pesado dentro do navegador (a parte
de fazer um interpretador de C++ rodar 3D ao vivo sem travar a aba não
foi escolhida à toa "ksksksksk").

Ou seja: é normal esbarrar em limitações — porque o objetivo aqui nunca
foi reimplementar o C++ inteiro dentro do navegador, e sim aprender
fazendo, na prática, com uma biblioteca de verdade como pretexto.

Se o seu projeto crescer e você precisar de algo mais robusto — C++
moderno completo, sem as limitações do JSCPP, performance de produção de
verdade — use a biblioteca **Pixela original**, direto na fonte:

**https://github.com/Obentemiller/pixela**

O editor ao vivo aqui é ótimo pra prototipar rápido e aprender brincando;
pra projetos grandes de verdade, é a biblioteca original quem deve fazer o
trabalho pesado.

