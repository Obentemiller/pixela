# PIXELA — API gráfica de terminal em C++

API **header-only** (`include/pixela.hpp`), sem dependências externas
— só a stdlib do C++17.

## Estrutura do projeto

```
tgfx_proj/
├── include/
│   └── pixela.hpp      # a API (header-only)
├── examples/
│   └── demo.cpp              # exemplo de animação
├── Makefile
└── README.md
```

## Como funciona a resolução

Cada caractere **Braille** Unicode (`U+2800`–`U+28FF`) representa uma grade
de **2×4 pontos** (8 sub-pixels). Usando esses caracteres como unidade de
desenho em vez de um caractere "cheio" por pixel, a resolução é **8x maior**
por célula de terminal. Um terminal de 80x24 caracteres vira uma tela de
**160 x 96 "pixels"** reais.

Além disso, cada célula recebe cor **RGB verdadeira (24-bit)** via
sequências ANSI (`\x1b[38;2;r;g;bm`).

## Compilar e rodar

Com `make` (recomendado):

```bash
make        # compila o demo
make run    # compila (se preciso) e executa
make clean  # remove o binário
```

Ou direto com g++:

```bash
g++ -std=c++17 -O2 -Iinclude examples/demo.cpp -o demo -lpthread
./demo      # Ctrl+C para sair
```

## Uso da API

```cpp
#include "pixela.hpp"   // com -Iinclude no compilador

int main() {
    int cols, rows;
    pxl::getTerminalSize(cols, rows);   // detecta tamanho do terminal
    pxl::enableAnsiSupport();           // necessário em terminais Windows antigos

    pxl::Canvas cv(cols, rows);         // resolução real: cols*2 x rows*4

    cv.clear();
    cv.drawCircle(cv.width()/2, cv.height()/2, 20, false, {255, 0, 0});
    cv.drawLine(0, 0, cv.width()-1, cv.height()-1, {0, 255, 0});
    cv.drawRect(5, 5, 30, 10, true, {0, 120, 255});

    pxl::clearScreen();
    cv.pixelar();  // imprime o frame
}
```

### Funções disponíveis

| Função | Descrição |
|---|---|
| `setPixel(x, y, on, cor)` | liga/desliga um "pixel" com cor |
| `drawLine(x0,y0,x1,y1,cor)` | linha (Bresenham) |
| `drawRect(x,y,w,h,preenchido,cor)` | retângulo |
| `drawCircle(cx,cy,r,preenchido,cor)` | círculo (Bresenham) |
| `drawTriangle(...)` | triângulo (contorno) |
| `clear()` | limpa o canvas |
| `render()` | retorna o frame como `std::string` (com códigos ANSI) |
| `pixelar()` | imprime o frame direto no terminal, sem piscar |
| `width()/height()` | resolução real em "pixels" (cols*2, rows*4) |

O `examples/demo.cpp` mostra uma animação com bola quicando, onda senoidal
e um ponteiro girando, tudo a ~60 FPS.
