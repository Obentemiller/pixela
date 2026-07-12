// terminal_gfx.hpp
// ------------------------------------------------------------------
// API gráfica minimalista para terminal (C++17, apenas biblioteca padrão).
//
// TRUQUE DE RESOLUÇÃO:
//   Cada caractere Braille Unicode (U+2800 a U+28FF) representa uma
//   grade de 2 colunas x 4 linhas de pontos (8 "sub-pixels" por
//   caractere). Usando esses caracteres como "pixels" do terminal,
//   conseguimos 8x mais resolução do que desenhar 1 pixel por
//   caractere (ex: usando '#' ou ' ').
//
//   Além disso, cada célula de terminal recebe uma cor RGB verdadeira
//   via sequências ANSI (\x1b[38;2;r;g;bm), suportada pela grande
//   maioria dos terminais modernos (Windows Terminal, iTerm2, GNOME
//   Terminal, Alacritty, Kitty, etc.).
//
// USO BÁSICO:
//   #include "terminal_gfx.hpp"       // (ou "include/terminal_gfx.hpp")
//
//   tgfx::Canvas cv(80, 24);           // 80x24 caracteres de terminal
//                                       // -> 160 x 96 "pixels" reais
//   cv.clear();
//   cv.drawCircle(80, 48, 30, false, {255, 0, 0});
//   cv.present();
//
// Dependências: apenas <vector>, <string>, <cmath>, <cstdint>, <iostream>
// e (opcional, para detectar tamanho do terminal) unistd/sys/ioctl ou windows.h
// ------------------------------------------------------------------

#pragma once

#include <vector>
#include <string>
#include <cstdint>
#include <cmath>
#include <algorithm>
#include <iostream>

#if defined(_WIN32)
  #include <windows.h>
#else
  #include <sys/ioctl.h>
  #include <unistd.h>
#endif

namespace tgfx {

struct Color {
    uint8_t r = 255, g = 255, b = 255;
};

// Detecta o tamanho do terminal em colunas/linhas (fallback: 80x24)
inline void getTerminalSize(int &cols, int &rows) {
    cols = 80; rows = 24;
#if defined(_WIN32)
    CONSOLE_SCREEN_BUFFER_INFO csbi;
    if (GetConsoleScreenBufferInfo(GetStdHandle(STD_OUTPUT_HANDLE), &csbi)) {
        cols = csbi.srWindow.Right - csbi.srWindow.Left + 1;
        rows = csbi.srWindow.Bottom - csbi.srWindow.Top + 1;
    }
#else
    struct winsize w{};
    if (ioctl(STDOUT_FILENO, TIOCGWINSZ, &w) == 0 && w.ws_col > 0 && w.ws_row > 0) {
        cols = w.ws_col;
        rows = w.ws_row;
    }
#endif
}

// Necessário no Windows (cmd/PowerShell antigos) para interpretar ANSI
inline void enableAnsiSupport() {
#if defined(_WIN32)
    HANDLE hOut = GetStdHandle(STD_OUTPUT_HANDLE);
    DWORD mode = 0;
    GetConsoleMode(hOut, &mode);
    SetConsoleMode(hOut, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING);
#endif
}

inline void clearScreen() { std::cout << "\x1b[2J\x1b[H"; }
inline void hideCursor()  { std::cout << "\x1b[?25l"; }
inline void showCursor()  { std::cout << "\x1b[?25h"; }

// Codifica um codepoint Unicode de 3 bytes (0x800-0xFFFF) em UTF-8
inline void appendUtf8_3byte(std::string &s, uint32_t codepoint) {
    s += static_cast<char>(0xE0 | ((codepoint >> 12) & 0x0F));
    s += static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F));
    s += static_cast<char>(0x80 | (codepoint & 0x3F));
}

// Mapa oficial de bits do padrão Braille: [subX 0..1][subY 0..3] -> bit (0..7)
//   dot1 dot4        (0,0) (1,0)
//   dot2 dot5   ->    (0,1) (1,1)
//   dot3 dot6         (0,2) (1,2)
//   dot7 dot8         (0,3) (1,3)
constexpr int kBrailleBit[2][4] = {
    {0, 1, 2, 6},
    {3, 4, 5, 7}
};

class Canvas {
public:
    // cols/rows = tamanho em CARACTERES de terminal.
    // A resolução real em "pixels" será (cols*2) x (rows*4).
    Canvas(int cols, int rows)
        : cols_(cols), rows_(rows),
          pw_(cols * 2), ph_(rows * 4),
          on_(static_cast<size_t>(pw_) * ph_, 0),
          cellColor_(static_cast<size_t>(cols) * rows, Color{255, 255, 255}) {}

    int width()  const { return pw_; }   // resolução horizontal em pixels
    int height() const { return ph_; }   // resolução vertical em pixels
    int cols()   const { return cols_; } // largura em caracteres
    int rows()   const { return rows_; } // altura em caracteres

    void clear() { std::fill(on_.begin(), on_.end(), 0); }

    void setPixel(int x, int y, bool on = true, Color c = {255, 255, 255}) {
        if (x < 0 || y < 0 || x >= pw_ || y >= ph_) return;
        on_[idx(x, y)] = on ? 1 : 0;
        if (on) cellColor_[cellIdx(x / 2, y / 4)] = c;
    }

    bool getPixel(int x, int y) const {
        if (x < 0 || y < 0 || x >= pw_ || y >= ph_) return false;
        return on_[idx(x, y)] != 0;
    }

    void drawLine(int x0, int y0, int x1, int y1, Color c = {255, 255, 255}) {
        int dx = std::abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
        int dy = -std::abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
        int err = dx + dy;
        while (true) {
            setPixel(x0, y0, true, c);
            if (x0 == x1 && y0 == y1) break;
            int e2 = 2 * err;
            if (e2 >= dy) { err += dy; x0 += sx; }
            if (e2 <= dx) { err += dx; y0 += sy; }
        }
    }

    void drawRect(int x, int y, int w, int h, bool filled, Color c = {255, 255, 255}) {
        if (filled) {
            for (int j = y; j < y + h; ++j)
                for (int i = x; i < x + w; ++i)
                    setPixel(i, j, true, c);
        } else {
            drawLine(x, y, x + w - 1, y, c);
            drawLine(x, y + h - 1, x + w - 1, y + h - 1, c);
            drawLine(x, y, x, y + h - 1, c);
            drawLine(x + w - 1, y, x + w - 1, y + h - 1, c);
        }
    }

    void drawCircle(int cx, int cy, int r, bool filled, Color c = {255, 255, 255}) {
        int x = r, y = 0, err = 0;
        while (x >= y) {
            if (filled) {
                drawLine(cx - x, cy + y, cx + x, cy + y, c);
                drawLine(cx - x, cy - y, cx + x, cy - y, c);
                drawLine(cx - y, cy + x, cx + y, cy + x, c);
                drawLine(cx - y, cy - x, cx + y, cy - x, c);
            } else {
                setPixel(cx + x, cy + y, true, c); setPixel(cx + y, cy + x, true, c);
                setPixel(cx - y, cy + x, true, c); setPixel(cx - x, cy + y, true, c);
                setPixel(cx - x, cy - y, true, c); setPixel(cx - y, cy - x, true, c);
                setPixel(cx + y, cy - x, true, c); setPixel(cx + x, cy - y, true, c);
            }
            y += 1;
            if (err <= 0) err += 2 * y + 1;
            if (err > 0)  { x -= 1; err -= 2 * x + 1; }
        }
    }

    void drawTriangle(int x0, int y0, int x1, int y1, int x2, int y2,
                       Color c = {255, 255, 255}) {
        drawLine(x0, y0, x1, y1, c);
        drawLine(x1, y1, x2, y2, c);
        drawLine(x2, y2, x0, y0, c);
    }

    // Gera o frame completo (texto + códigos ANSI de cor) pronto para imprimir
    std::string render() const {
        std::string out;
        out.reserve(static_cast<size_t>(cols_) * rows_ * 20);
        bool haveColor = false;
        Color last{0, 0, 0};

        for (int cy = 0; cy < rows_; ++cy) {
            for (int cx = 0; cx < cols_; ++cx) {
                uint8_t mask = 0;
                for (int sx = 0; sx < 2; ++sx)
                    for (int sy = 0; sy < 4; ++sy)
                        if (getPixel(cx * 2 + sx, cy * 4 + sy))
                            mask |= static_cast<uint8_t>(1 << kBrailleBit[sx][sy]);

                if (mask == 0) {
                    if (haveColor) { out += "\x1b[0m"; haveColor = false; }
                    out += ' ';
                    continue;
                }

                Color c = cellColor_[cellIdx(cx, cy)];
                if (!haveColor || c.r != last.r || c.g != last.g || c.b != last.b) {
                    out += "\x1b[38;2;" + std::to_string(c.r) + ";" +
                           std::to_string(c.g) + ";" + std::to_string(c.b) + "m";
                    last = c; haveColor = true;
                }
                appendUtf8_3byte(out, 0x2800u + mask);
            }
            out += "\x1b[0m\n";
            haveColor = false;
        }
        return out;
    }

    // Move o cursor para o topo (sem limpar a tela, evita flicker) e imprime
    void present() const {
        std::cout << "\x1b[H" << render() << std::flush;
    }

private:
    int cols_, rows_, pw_, ph_;
    std::vector<uint8_t> on_;
    std::vector<Color> cellColor_;

    size_t idx(int x, int y) const { return static_cast<size_t>(y) * pw_ + x; }
    size_t cellIdx(int cx, int cy) const { return static_cast<size_t>(cy) * cols_ + cx; }
};

} // namespace tgfx
