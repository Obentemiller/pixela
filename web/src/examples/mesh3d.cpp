// mesh3d.cpp
// ---------------------------------------------------------------------------
// Showcases pixela.hpp's software 3D engine (pix::Renderer3D + pix::Mesh):
// a spinning torus and icosahedron, flat-shaded with the built-in diffuse
// lighting and z-buffered triangle rasterizer — all running as compiled
// WebAssembly at native speed.
// ---------------------------------------------------------------------------
#include "../pixela.hpp"
#include "../pixela_wasm_bridge.hpp"
#include <memory>

namespace {

std::unique_ptr<pix::Renderer3D> g_renderer;
pix::Mesh g_torus;
pix::Mesh g_ico;
bool g_initialized = false;

void ensureInit(pix::Canvas& cv) {
    if (g_initialized) return;
    g_renderer = std::make_unique<pix::Renderer3D>(cv);
    g_renderer->setLight(pix::Vec3{0.4, 0.7, -0.5});

    g_torus = pix::makeTorus(1.6, 0.6, 20, 14, pix::Color{80, 200, 255});
    g_torus.pos = {-2.0, 0, 6.5};
    g_torus.spin = {0.6, 1.0, 0.0};

    g_ico = pix::makeIcosahedron(1.6, pix::Color{255, 120, 200});
    g_ico.pos = {2.2, 0, 6.5};
    g_ico.spin = {0.9, -0.7, 0.3};

    g_initialized = true;
}

void frame(pix::Canvas& cv, double /*t*/, double dt) {
    ensureInit(cv);
    cv.clear();
    g_renderer->newFrame();
    g_renderer->drawMesh(g_torus, dt);
    g_renderer->drawMesh(g_ico, dt);
}

} // namespace

PIXELA_WASM_MAIN(frame)
