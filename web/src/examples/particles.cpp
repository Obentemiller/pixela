// particles.cpp
// ---------------------------------------------------------------------------
// A lighter-weight compiled demo (vs. the volumetric shader and the 3D mesh
// scene) so users can compare workloads of different cost in the same
// benchmarking harness. Simulates N particles under simple gravity + a
// wraparound "wind" force, colored by speed.
// ---------------------------------------------------------------------------
#include "../pixela.hpp"
#include "../pixela_wasm_bridge.hpp"
#include <vector>
#include <cmath>
#include <algorithm>

namespace {

struct Particle { double x, y, vx, vy; };

std::vector<Particle> g_particles;

void ensureSeeded(int w, int h) {
    if (!g_particles.empty()) return;
    g_particles.resize(600);
    unsigned seed = 12345u;
    auto rnd = [&]() {
        seed = seed * 1664525u + 1013904223u;
        return (seed >> 8) / static_cast<double>(1 << 24);
    };
    for (auto& p : g_particles) {
        p.x = rnd() * w;
        p.y = rnd() * h * 0.4;
        p.vx = (rnd() - 0.5) * 6.0;
        p.vy = rnd() * 2.0;
    }
}

pix::Color speedColor(double speed01) {
    speed01 = std::clamp(speed01, 0.0, 1.0);
    return pix::Color{
        static_cast<uint8_t>(255 * speed01),
        static_cast<uint8_t>(200 * (1.0 - speed01) + 55),
        static_cast<uint8_t>(60)
    };
}

void frame(pix::Canvas& cv, double /*t*/, double dt) {
    int w = cv.width(), h = cv.height();
    ensureSeeded(w, h);
    cv.clear();

    dt = std::min(dt, 1.0 / 30.0); // clamp for stability on slow frames
    for (auto& p : g_particles) {
        p.vy += 9.0 * dt;
        p.x += p.vx * dt * 6.0;
        p.y += p.vy * dt * 6.0;

        if (p.y > h) { p.y = 0; p.vy = 0; }
        if (p.x < 0) p.x += w;
        if (p.x >= w) p.x -= w;

        double speed = std::sqrt(p.vx * p.vx + p.vy * p.vy);
        cv.setPixel(static_cast<int>(p.x), static_cast<int>(p.y), true,
                    speedColor(speed / 8.0));
    }
}

} // namespace

PIXELA_WASM_MAIN(frame)
