// pixela_wasm_bridge.hpp
// ---------------------------------------------------------------------------
// Glue between the user's real `pix::Canvas` (src/pixela.hpp, UNMODIFIED) and
// the JS side (js/wasm-loader.js).
//
// Design goal: never touch pixela.hpp. This bridge only calls Canvas's
// existing PUBLIC API (constructor, clear(), the draw* methods, and
// render()) and hands the resulting ANSI + UTF-8 Braille string straight
// back to JavaScript, which parses it (see js/ansi-parser.js) exactly like
// a real terminal emulator would. This means the same pixela.hpp that
// compiles and runs on a real terminal (g++/clang++, any OS) also runs
// unmodified here, compiled to WebAssembly with Emscripten.
//
// Usage in a demo .cpp file:
//
//   #include "../pixela.hpp"
//   #include "../pixela_wasm_bridge.hpp"
//
//   static void frame(pix::Canvas& cv, double t, double dt) {
//       cv.clear();
//       // ... draw using cv.setPixel/drawLine/drawRect/drawCircle/... ...
//   }
//
//   PIXELA_WASM_MAIN(frame)
//
// `PIXELA_WASM_MAIN` expands to the extern "C" functions that
// js/wasm-loader.js expects: pixela_wasm_init / pixela_wasm_frame.
// ---------------------------------------------------------------------------
#pragma once

#include "pixela.hpp"
#include <string>
#include <memory>

#ifdef __EMSCRIPTEN__
  #include <emscripten.h>
  #define PIXELA_EXPORT extern "C" EMSCRIPTEN_KEEPALIVE
#else
  #define PIXELA_EXPORT extern "C"
#endif

namespace pixela_internal {

inline std::unique_ptr<pix::Canvas>& canvasPtr() {
    static std::unique_ptr<pix::Canvas> p;
    return p;
}

// Buffer kept alive between calls so the `const char*` returned to JS stays
// valid until the next frame is rendered (Emscripten's UTF8ToString reads
// it synchronously right after the call, so this is safe).
inline std::string& frameBuf() {
    static std::string s;
    return s;
}

} // namespace pixela_internal

// Declares the exported functions and wires them to a user-supplied
// `void frame(pix::Canvas&, double t, double dt)` that draws one frame
// using only pixela.hpp's own public API.
#define PIXELA_WASM_MAIN(FRAME_FN)                                           \
    PIXELA_EXPORT void pixela_wasm_init(int cols, int rows) {                \
        pixela_internal::canvasPtr() =                                       \
            std::make_unique<pix::Canvas>(cols, rows);                       \
    }                                                                        \
    PIXELA_EXPORT const char* pixela_wasm_frame(double t, double dt) {       \
        auto& cv = *pixela_internal::canvasPtr();                            \
        FRAME_FN(cv, t, dt);                                                 \
        pixela_internal::frameBuf() = cv.render();                           \
        return pixela_internal::frameBuf().c_str();                         \
    }
