// volumetric.cpp
// ---------------------------------------------------------------------------
// Raymarched volumetric fog, rendered with true RGB color at pixela.hpp's
// full Braille sub-pixel resolution (2x4 real pixels per terminal cell).
// Every pixel does a fixed-step raymarch through a signed-distance "fog"
// volume — deliberately CPU-heavy, useful for comparing native WebAssembly
// performance against the interpreted (JSCPP) editor path across devices.
//
// Build (see build/build.sh):
//   emcc src/shaders/volumetric.cpp -O3 -std=c++17
//        -s MODULARIZE=1 -s EXPORT_NAME=createVolumetricModule
//        -s EXPORTED_RUNTIME_METHODS=cwrap,UTF8ToString
//        -o wasm/volumetric.js
// ---------------------------------------------------------------------------
#include "../pixela.hpp"
#include "../pixela_wasm_bridge.hpp"
#include <cmath>
#include <algorithm>

namespace {

struct Vec3 {
    double x, y, z;
    Vec3 operator+(const Vec3& o) const { return {x + o.x, y + o.y, z + o.z}; }
    Vec3 operator-(const Vec3& o) const { return {x - o.x, y - o.y, z - o.z}; }
    Vec3 operator*(double s)      const { return {x * s, y * s, z * s}; }
    double dot(const Vec3& o) const { return x * o.x + y * o.y + z * o.z; }
    double length() const { return std::sqrt(dot(*this)); }
    Vec3 normalized() const { double l = length(); return l > 1e-9 ? (*this) * (1.0 / l) : *this; }
};

double sdSphere(const Vec3& p, double radius) { return p.length() - radius; }

// Wobble in place of a real 3D noise function — keeps the demo dependency-free.
double wobble(const Vec3& p, double t) {
    return std::sin(p.x * 1.7 + t) * std::sin(p.y * 1.3 - t * 0.7) * std::sin(p.z * 2.1 + t * 0.5);
}

double density(const Vec3& p, double t) {
    double s = -sdSphere(p, 1.4 + 0.15 * std::sin(t * 0.6));
    s += 0.35 * wobble(p, t);
    return s;
}

constexpr int    kMaxSteps  = 40;  // raymarch steps per pixel (perf knob)
constexpr double kStepSize  = 0.10;
constexpr double kMaxDist   = 8.0;

// Maps accumulated fog density to a color ramp (deep blue -> cyan -> white),
// showing off pixela.hpp's true-color (24-bit) ANSI output.
pix::Color rampColor(double intensity) {
    intensity = std::clamp(intensity, 0.0, 1.0);
    uint8_t r = static_cast<uint8_t>(40  + 60  * intensity);
    uint8_t g = static_cast<uint8_t>(60  + 160 * intensity);
    uint8_t b = static_cast<uint8_t>(120 + 135 * intensity);
    return pix::Color{r, g, b};
}

void frame(pix::Canvas& cv, double t, double /*dt*/) {
    cv.clear();
    int w = cv.width(), h = cv.height(); // full Braille pixel resolution
    if (w <= 0 || h <= 0) return;

    Vec3 camPos{ std::cos(t * 0.3) * 4.0, 1.2, std::sin(t * 0.3) * 4.0 };
    Vec3 target{0, 0, 0};
    Vec3 fwd = (target - camPos).normalized();
    Vec3 worldUp{0, 1, 0};
    Vec3 right = Vec3{fwd.y * worldUp.z - fwd.z * worldUp.y,
                       fwd.z * worldUp.x - fwd.x * worldUp.z,
                       fwd.x * worldUp.y - fwd.y * worldUp.x}.normalized();
    Vec3 up = Vec3{right.y * fwd.z - right.z * fwd.y,
                    right.z * fwd.x - right.x * fwd.z,
                    right.x * fwd.y - right.y * fwd.x};

    // pixela.hpp's Braille sub-pixels are roughly square already, so no
    // extra aspect-ratio correction is needed here (unlike a 1-glyph-per-cell
    // scheme, which would need one).
    for (int y = 0; y < h; ++y) {
        double v = (static_cast<double>(y) / h - 0.5) * -1.0;
        for (int x = 0; x < w; ++x) {
            double u = (static_cast<double>(x) / w - 0.5) * (static_cast<double>(w) / h);

            Vec3 rd = (fwd + right * u + up * v).normalized();
            Vec3 p = camPos;

            double accum = 0.0;
            for (int step = 0; step < kMaxSteps; ++step) {
                double d = density(p, t);
                if (d > 0.0) accum += d * kStepSize;
                p = p + rd * kStepSize;
                if (accum > 1.4 || (p - camPos).length() > kMaxDist) break;
            }

            double intensity = std::min(1.0, accum);
            if (intensity > 0.03) {
                cv.setPixel(x, y, true, rampColor(intensity));
            }
        }
    }
}

} // namespace

PIXELA_WASM_MAIN(frame)
