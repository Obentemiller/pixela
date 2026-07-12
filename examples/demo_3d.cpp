// demo_3d.cpp - motor 3D por software rodando sobre a terminal_gfx.hpp
// -----------------------------------------------------------------------
// Este arquivo NÃO altera a biblioteca. Ele usa apenas a API pública do
// tgfx::Canvas (setPixel, drawLine, clear, present, width/height) para
// implementar, por cima dela, um pipeline 3D completo:
//
//   - Vetores/matrizes de rotação 3D
//   - Geração de malhas (cubo, icosaedro, toroide)
//   - Projeção em perspectiva
//   - Rasterização de triângulos preenchidos com Z-BUFFER próprio
//   - Sombreamento (iluminação difusa por face)
//   - Campo de estrelas (centenas de partículas projetadas em 3D)
//   - Chão em wireframe com linhas em perspectiva
//   - HUD com FPS / contagem de triângulos e "pixels" desenhados
//
// Compilar:  make demo3d      (ou: g++ -std=c++17 -O2 -Iinclude examples/demo_3d.cpp -o demo3d -lpthread)
// Executar:  ./demo3d          (Ctrl+C para sair)
// -----------------------------------------------------------------------

#include "../include/terminal_gfx.hpp"

#include <vector>
#include <cmath>
#include <chrono>
#include <thread>
#include <csignal>
#include <atomic>
#include <random>
#include <cstdio>
#include <algorithm>

// ============================== Álgebra 3D ==============================

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

// ============================== Malhas 3D ===============================

struct Tri { int a, b, c; };

struct Mesh {
    std::vector<Vec3> verts;
    std::vector<Tri>  tris;
    tgfx::Color        color;
    Vec3               pos;              // posição no mundo
    Vec3               spin{0, 0, 0};    // velocidade angular (rad/s) por eixo
    Vec3               angle{0, 0, 0};   // ângulo atual acumulado
};

Mesh makeCube(double s, tgfx::Color col) {
    double h = s / 2.0;
    Mesh m; m.color = col;
    m.verts = {
        {-h,-h,-h}, {h,-h,-h}, {h,h,-h}, {-h,h,-h},
        {-h,-h, h}, {h,-h, h}, {h,h, h}, {-h,h, h}
    };
    m.tris = {
        {0,1,2},{0,2,3},       // trás
        {4,6,5},{4,7,6},       // frente
        {0,3,7},{0,7,4},       // esquerda
        {1,5,6},{1,6,2},       // direita
        {0,4,5},{0,5,1},       // baixo
        {3,2,6},{3,6,7}        // cima
    };
    return m;
}

Mesh makeIcosahedron(double r, tgfx::Color col) {
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

Mesh makeTorus(double R, double r, int segs, int rings, tgfx::Color col) {
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

// ============================ Projeção / Câmera ==========================

struct Proj { double sx, sy, z; bool ok; };

// Câmera fixa na origem olhando para +Z. Retorna coordenadas de tela em
// "pixels" do canvas (não em caracteres) e a profundidade (para z-buffer).
Proj project(const Vec3 &p, const tgfx::Canvas &cv, double focal) {
    if (p.z <= 0.05) return {0, 0, 0, false};
    double scale = focal / p.z;
    double sx = cv.width()  / 2.0 + p.x * scale;
    double sy = cv.height() / 2.0 - p.y * scale;
    return {sx, sy, p.z, true};
}

// Rasteriza um triângulo preenchido com teste de z-buffer e sombreamento
// difuso simples baseado na normal da face.
long long fillTriangle(tgfx::Canvas &cv, std::vector<double> &zbuf,
                        const Proj &p0, const Proj &p1, const Proj &p2,
                        double intensity, tgfx::Color base) {
    if (!p0.ok || !p1.ok || !p2.ok) return 0;

    int minX = static_cast<int>(std::floor(std::min({p0.sx, p1.sx, p2.sx})));
    int maxX = static_cast<int>(std::ceil (std::max({p0.sx, p1.sx, p2.sx})));
    int minY = static_cast<int>(std::floor(std::min({p0.sy, p1.sy, p2.sy})));
    int maxY = static_cast<int>(std::ceil (std::max({p0.sy, p1.sy, p2.sy})));
    minX = std::max(minX, 0); minY = std::max(minY, 0);
    maxX = std::min(maxX, cv.width()  - 1);
    maxY = std::min(maxY, cv.height() - 1);
    if (minX > maxX || minY > maxY) return 0;

    double area = (p1.sx - p0.sx) * (p2.sy - p0.sy) - (p1.sy - p0.sy) * (p2.sx - p0.sx);
    if (std::abs(area) < 1e-6) return 0;

    tgfx::Color shaded{
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

            size_t idx = static_cast<size_t>(y) * cv.width() + x;
            if (depth < zbuf[idx]) {
                zbuf[idx] = depth;
                cv.setPixel(x, y, true, shaded);
                ++drawn;
            }
        }
    }
    return drawn;
}

// ============================== Programa =================================

std::atomic<bool> running{true};
void onSigint(int) { running = false; }

int main() {
    tgfx::enableAnsiSupport();
    std::signal(SIGINT, onSigint);

    int termCols, termRows;
    tgfx::getTerminalSize(termCols, termRows);
    int hudLines = 2;                                   // linhas reservadas para o HUD
    int rows = std::max(10, termRows - hudLines - 1);
    tgfx::Canvas cv(termCols, rows);

    const double focal = cv.width() * 0.9;

    std::vector<Mesh> meshes;
    meshes.push_back(makeCube(2.2, {255, 90, 90}));
    meshes.back().pos  = {-3.2, 0.0, 9.0};
    meshes.back().spin = {0.9, 0.6, 0.0};

    meshes.push_back(makeIcosahedron(1.5, {90, 200, 255}));
    meshes.back().pos  = {0.0, 0.0, 7.0};
    meshes.back().spin = {0.5, 1.1, 0.3};

    meshes.push_back(makeTorus(1.3, 0.5, 14, 22, {120, 255, 140}));
    meshes.back().pos  = {3.2, 0.0, 9.5};
    meshes.back().spin = {0.3, 0.4, 1.0};

    // Campo de estrelas: partículas 3D voando em direção à câmera
    struct Star { Vec3 p; };
    std::vector<Star> stars(260);
    std::mt19937 rng(42);
    std::uniform_real_distribution<double> distXY(-9.0, 9.0);
    std::uniform_real_distribution<double> distZ(1.0, 40.0);
    for (auto &s : stars) s.p = {distXY(rng), distXY(rng), distZ(rng)};

    // Linhas do "chão" (grade em perspectiva estilo Tron)
    std::vector<std::pair<Vec3, Vec3>> gridLines;
    for (int i = -10; i <= 10; i += 2) {
        gridLines.push_back({{(double)i, -3.0, 0.0}, {(double)i, -3.0, 40.0}});
        gridLines.push_back({{-10.0, -3.0, (double)(i + 10)}, {10.0, -3.0, (double)(i + 10)}});
    }

    tgfx::clearScreen();
    tgfx::hideCursor();

    const Vec3 lightDir = Vec3{0.4, 0.7, -0.5}.normalized();

    double globalAngle = 0.0;
    auto last = std::chrono::steady_clock::now();
    double fpsSmooth = 0.0;

    std::vector<double> zbuf(static_cast<size_t>(cv.width()) * cv.height());

    while (running) {
        auto now = std::chrono::steady_clock::now();
        double dt = std::chrono::duration<double>(now - last).count();
        last = now;
        double fps = dt > 0.0 ? 1.0 / dt : 0.0;
        fpsSmooth = fpsSmooth * 0.9 + fps * 0.1;

        globalAngle += dt * 0.25; // câmera orbitando lentamente a cena

        cv.clear();
        std::fill(zbuf.begin(), zbuf.end(), 1e18);

        // --- estrelas: voam em direção à câmera e reaparecem ao fundo ---
        for (auto &s : stars) {
            s.p.z -= dt * 6.0;
            if (s.p.z < 0.5) { s.p = {distXY(rng), distXY(rng), 40.0}; }
            Vec3 rp = rotateY(s.p, globalAngle * 0.3);
            Proj pr = project(rp, cv, focal);
            if (pr.ok) {
                double bright = std::clamp(1.0 - rp.z / 40.0, 0.15, 1.0);
                uint8_t v = static_cast<uint8_t>(180 + 75 * bright);
                cv.setPixel((int)pr.sx, (int)pr.sy, true, {v, v, v});
            }
        }

        // --- chão em wireframe ---
        for (auto &ln : gridLines) {
            Vec3 a = rotateY(ln.first,  globalAngle);
            Vec3 b = rotateY(ln.second, globalAngle);
            Proj pa = project(a, cv, focal);
            Proj pb = project(b, cv, focal);
            if (pa.ok && pb.ok)
                cv.drawLine((int)pa.sx, (int)pa.sy, (int)pb.sx, (int)pb.sy, {40, 60, 90});
        }

        // --- sólidos 3D preenchidos com z-buffer e sombreamento ---
        long long trisDrawn = 0, pixelsDrawn = 0;
        for (auto &m : meshes) {
            m.angle.x += m.spin.x * dt;
            m.angle.y += m.spin.y * dt;
            m.angle.z += m.spin.z * dt;

            std::vector<Vec3> world(m.verts.size());
            for (size_t i = 0; i < m.verts.size(); ++i) {
                Vec3 p = m.verts[i];
                p = rotateX(p, m.angle.x);
                p = rotateY(p, m.angle.y);
                p = rotateZ(p, m.angle.z);
                p = p + m.pos;
                p = rotateY(p, globalAngle);     // órbita da câmera
                world[i] = p;
            }

            for (auto &t : m.tris) {
                const Vec3 &v0 = world[t.a], &v1 = world[t.b], &v2 = world[t.c];
                Vec3 normal = (v1 - v0).cross(v2 - v0).normalized();
                double intensity = 0.25 + 0.85 * std::abs(normal.dot(lightDir));

                Proj p0 = project(v0, cv, focal);
                Proj p1 = project(v1, cv, focal);
                Proj p2 = project(v2, cv, focal);

                pixelsDrawn += fillTriangle(cv, zbuf, p0, p1, p2, intensity, m.color);
                ++trisDrawn;
            }
        }

        cv.present();

        // --- HUD (linhas reservadas abaixo do canvas) ---
        char buf[160];
        std::snprintf(buf, sizeof(buf),
            "FPS: %5.1f | triangulos/quadro: %lld | pixels preenchidos: %lld | resolucao: %dx%d",
            fpsSmooth, trisDrawn, pixelsDrawn, cv.width(), cv.height());
        std::printf("\x1b[%d;1H\x1b[K%s\x1b[K\n\x1b[K(Ctrl+C para sair)\x1b[K",
                    rows + 1, buf);
        std::fflush(stdout);

        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }

    tgfx::showCursor();
    std::cout << "\x1b[0m\n";
    return 0;
}
