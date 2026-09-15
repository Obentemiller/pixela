// pixela.hpp
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
//   #include "pixela.hpp"       // (ou "include/pixela.hpp")
//
//   pix::Canvas cv(80, 24);           // 80x24 caracteres de terminal
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

namespace pix {

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

    std::cout<<"My need to create a support function for Microsoft's quirks proves that Linux is better."<<std::endl;
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
          pw_(cols << 1), ph_(rows << 2), // *2 e *4 -> shifts (grade Braille 2x4)
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
        if (on) cellColor_[cellIdx(x >> 1, y >> 2)] = c; // /2 e /4 -> shifts (x,y>=0 aqui)
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
                        if (getPixel((cx << 1) + sx, (cy << 2) + sy)) // *2/*4 -> shifts
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

// ==========================================================================
// FERRAMENTAS 3D (opcionais)
// ==========================================================================
// Motor 3D por software construído inteiramente sobre a API pública de
// Canvas (setPixel/drawLine/width/height) — não acessa nada interno dela.
// Uso típico por quadro:
//
//   pix::Renderer3D r3d(cv);
//   ...
//   cv.clear();
//   r3d.newFrame();
//   r3d.drawMesh(minhaMesh, dt);
//   r3d.drawLine3D(a, b, cor);      // wireframe (ex.: chão)
//   r3d.drawPoint3D(p, cor);        // pontos soltos (ex.: estrelas)
//   cv.present();
//
// Observação sobre otimização: aqui embaixo a matemática é toda em ponto
// flutuante (posições, rotações, projeção em perspectiva), onde shift de
// bits não se aplica — só vale para inteiros. Os cortes por potência de 2
// já foram feitos onde existem de fato (indexação de célula Braille, acima).
// --------------------------------------------------------------------------

struct Vec3 {
    double x = 0, y = 0, z = 0;
    Vec3 operator+(const Vec3 &o) const { return {x + o.x, y + o.y, z + o.z}; }
    Vec3 operator-(const Vec3 &o) const { return {x - o.x, y - o.y, z - o.z}; }
    Vec3 operator*(double s) const { return {x * s, y * s, z * s}; }
    double dot(const Vec3 &o) const { return x * o.x + y * o.y + z * o.z; }
    Vec3 cross(const Vec3 &o) const {
        return {y * o.z - z * o.y, z * o.x - x * o.z, x * o.y - y * o.x};
    }
    double length() const { return std::sqrt(x * x + y * y + z * z); }
    Vec3 normalized() const {
        double l = length();
        return l > 1e-9 ? Vec3{x / l, y / l, z / l} : Vec3{0, 0, 0};
    }
};

inline Vec3 rotateX(const Vec3 &p, double a) {
    double c = std::cos(a), s = std::sin(a);
    return {p.x, p.y * c - p.z * s, p.y * s + p.z * c};
}
inline Vec3 rotateY(const Vec3 &p, double a) {
    double c = std::cos(a), s = std::sin(a);
    return {p.x * c + p.z * s, p.y, -p.x * s + p.z * c};
}
inline Vec3 rotateZ(const Vec3 &p, double a) {
    double c = std::cos(a), s = std::sin(a);
    return {p.x * c - p.y * s, p.x * s + p.y * c, p.z};
}

struct Tri { int a, b, c; };

struct Mesh {
    std::vector<Vec3> verts;
    std::vector<Tri>  tris;
    Color color;
    Vec3  pos;              // posição no mundo
    Vec3  spin{0, 0, 0};    // velocidade angular (rad/s) por eixo
    Vec3  angle{0, 0, 0};   // ângulo atual acumulado
};

inline Mesh makeCube(double s, Color col) {
    double h = s * 0.5;
    Mesh m; m.color = col;
    m.verts = {
        {-h,-h,-h}, {h,-h,-h}, {h,h,-h}, {-h,h,-h},
        {-h,-h, h}, {h,-h, h}, {h,h, h}, {-h,h, h}
    };
    m.tris = {
        {0,1,2},{0,2,3}, {4,6,5},{4,7,6}, {0,3,7},{0,7,4},
        {1,5,6},{1,6,2}, {0,4,5},{0,5,1}, {3,2,6},{3,6,7}
    };
    return m;
}

inline Mesh makeIcosahedron(double r, Color col) {
    Mesh m; m.color = col;
    const double t = (1.0 + std::sqrt(5.0)) / 2.0;
    std::vector<Vec3> v = {
        {-1, t, 0}, {1, t, 0}, {-1,-t, 0}, {1,-t, 0},
        {0,-1, t}, {0, 1, t}, {0,-1,-t}, {0, 1,-t},
        {t, 0,-1}, {t, 0, 1}, {-t, 0,-1}, {-t, 0, 1}
    };
    for (auto &p : v) { double l = p.length(); p = {p.x/l*r, p.y/l*r, p.z/l*r}; }
    m.verts = v;
    m.tris = {
        {0,11,5},{0,5,1},{0,1,7},{0,7,10},{0,10,11},
        {1,5,9},{5,11,4},{11,10,2},{10,7,6},{7,1,8},
        {3,9,4},{3,4,2},{3,2,6},{3,6,8},{3,8,9},
        {4,9,5},{2,4,11},{6,2,10},{8,6,7},{9,8,1}
    };
    return m;
}

inline Mesh makeTorus(double R, double r, int segs, int rings, Color col) {
    Mesh m; m.color = col;
    m.verts.resize(static_cast<size_t>(segs) * rings);
    for (int i = 0; i < rings; ++i) {
        double theta = i * 2.0 * M_PI / rings;
        for (int j = 0; j < segs; ++j) {
            double phi = j * 2.0 * M_PI / segs;
            double x = (R + r * std::cos(phi)) * std::cos(theta);
            double y = r * std::sin(phi);
            double z = (R + r * std::cos(phi)) * std::sin(theta);
            m.verts[i * segs + j] = {x, y, z};
        }
    }
    for (int i = 0; i < rings; ++i) {
        int ni = (i + 1) % rings;
        for (int j = 0; j < segs; ++j) {
            int nj = (j + 1) % segs;
            int a = i * segs + j, b = ni * segs + j;
            int c = ni * segs + nj, d = i * segs + nj;
            m.tris.push_back({a, b, c});
            m.tris.push_back({a, c, d});
        }
    }
    return m;
}

struct Proj { double sx, sy, z; bool ok; };

// Motor de render 3D: dono do z-buffer (reaproveitado entre quadros, sem
// realocar), da câmera (fixa na origem, olhando para +Z) e da luz difusa.
class Renderer3D {
public:
    // focal <= 0 usa um padrão razoável (90% da largura em pixels do canvas)
    explicit Renderer3D(Canvas &cv, double focal = 0.0)
        : cv_(cv), focal_(focal > 0.0 ? focal : cv.width() * 0.9),
          zbuf_(static_cast<size_t>(cv.width()) * cv.height()) {}

    void setLight(Vec3 dir) { light_ = dir.normalized(); }
    void setFocal(double f) { focal_ = f; }
    double focal() const { return focal_; }

    // Chame no início de cada quadro (depois de cv.clear()).
    void newFrame() { std::fill(zbuf_.begin(), zbuf_.end(), 1e18); }

    Proj project(const Vec3 &p) const {
        if (p.z <= 0.05) return {0, 0, 0, false};
        double scale = focal_ / p.z;
        double sx = cv_.width()  * 0.5 + p.x * scale;
        double sy = cv_.height() * 0.5 - p.y * scale;
        return {sx, sy, p.z, true};
    }

    // Ponto 3D solto (ex.: campo de estrelas)
    void drawPoint3D(const Vec3 &p, Color c) {
        Proj pr = project(p);
        if (pr.ok) cv_.setPixel(static_cast<int>(pr.sx), static_cast<int>(pr.sy), true, c);
    }

    // Segmento de reta 3D projetado (ex.: chão em wireframe)
    void drawLine3D(const Vec3 &a, const Vec3 &b, Color c) {
        Proj pa = project(a), pb = project(b);
        if (pa.ok && pb.ok)
            cv_.drawLine(static_cast<int>(pa.sx), static_cast<int>(pa.sy),
                         static_cast<int>(pb.sx), static_cast<int>(pb.sy), c);
    }

    // Triângulo preenchido em coordenadas de mundo: projeta, sombreia pela
    // normal da face (iluminação difusa) e rasteriza com teste de z-buffer.
    // Retorna quantos pixels foram efetivamente desenhados.
    long long drawTriangle(const Vec3 &v0, const Vec3 &v1, const Vec3 &v2, Color base) {
        Vec3 normal = (v1 - v0).cross(v2 - v0).normalized();
        double intensity = 0.25 + 0.85 * std::abs(normal.dot(light_));
        return fillProjected(project(v0), project(v1), project(v2), intensity, base);
    }

    // Desenha a malha inteira: avança a rotação por spin*dt, aplica
    // pos/angle acumulados e, opcionalmente, uma órbita extra de câmera
    // (cameraYaw) — mesmo truque usado no demo original. Retorna o total
    // de pixels desenhados na malha.
    long long drawMesh(Mesh &m, double dt, double cameraYaw = 0.0) {
        m.angle.x += m.spin.x * dt;
        m.angle.y += m.spin.y * dt;
        m.angle.z += m.spin.z * dt;

        world_.resize(m.verts.size());
        for (size_t i = 0; i < m.verts.size(); ++i) {
            Vec3 p = rotateX(m.verts[i], m.angle.x);
            p = rotateY(p, m.angle.y);
            p = rotateZ(p, m.angle.z);
            p = p + m.pos;
            if (cameraYaw != 0.0) p = rotateY(p, cameraYaw);
            world_[i] = p;
        }

        long long pixels = 0;
        for (auto &t : m.tris)
            pixels += drawTriangle(world_[t.a], world_[t.b], world_[t.c], m.color);
        return pixels;
    }

private:
    Canvas &cv_;
    double focal_;
    Vec3 light_{0.4, 0.7, -0.5};
    std::vector<double> zbuf_;
    std::vector<Vec3> world_; // buffer de vértices reaproveitado entre quadros

    long long fillProjected(const Proj &p0, const Proj &p1, const Proj &p2,
                             double intensity, Color base) {
        if (!p0.ok || !p1.ok || !p2.ok) return 0;

        int minX = static_cast<int>(std::floor(std::min({p0.sx, p1.sx, p2.sx})));
        int maxX = static_cast<int>(std::ceil (std::max({p0.sx, p1.sx, p2.sx})));
        int minY = static_cast<int>(std::floor(std::min({p0.sy, p1.sy, p2.sy})));
        int maxY = static_cast<int>(std::ceil (std::max({p0.sy, p1.sy, p2.sy})));
        minX = std::max(minX, 0); minY = std::max(minY, 0);
        maxX = std::min(maxX, cv_.width()  - 1);
        maxY = std::min(maxY, cv_.height() - 1);
        if (minX > maxX || minY > maxY) return 0;

        double area = (p1.sx - p0.sx) * (p2.sy - p0.sy) - (p1.sy - p0.sy) * (p2.sx - p0.sx);
        if (std::abs(area) < 1e-6) return 0;

        Color shaded{
            static_cast<uint8_t>(std::clamp(base.r * intensity, 0.0, 255.0)),
            static_cast<uint8_t>(std::clamp(base.g * intensity, 0.0, 255.0)),
            static_cast<uint8_t>(std::clamp(base.b * intensity, 0.0, 255.0))
        };

        long long drawn = 0;
        for (int y = minY; y <= maxY; ++y) {
            for (int x = minX; x <= maxX; ++x) {
                double px = x + 0.5, py = y + 0.5;
                double w0 = (p1.sx - px) * (p2.sy - py) - (p1.sy - py) * (p2.sx - px);
                double w1 = (p2.sx - px) * (p0.sy - py) - (p2.sy - py) * (p0.sx - px);
                double w2 = (p0.sx - px) * (p1.sy - py) - (p0.sy - py) * (p1.sx - px);
                bool inside = (w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0);
                if (!inside) continue;

                double iw0 = w0 / area, iw1 = w1 / area, iw2 = w2 / area;
                double depth = iw0 * p0.z + iw1 * p1.z + iw2 * p2.z;

                size_t idx = static_cast<size_t>(y) * cv_.width() + x;
                if (depth < zbuf_[idx]) {
                    zbuf_[idx] = depth;
                    cv_.setPixel(x, y, true, shaded);
                    ++drawn;
                }
            }
        }
        return drawn;
    }
};

} // namespace PIX

//Claude is the one who organizes my code—he strips out all my jokes. That’s no fun. I’m going to come up with a solution that makes my work easier without stripping away the human touch...
