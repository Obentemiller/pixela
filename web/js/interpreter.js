/**
 * interpreter.js
 * ------------------------------------------------------------------
 * Runs the user's C++ "main.cpp" ENTIRELY in the browser (no server
 * involved at any point) using JSCPP (github.com/felixhao28/JSCPP), a
 * C++ interpreter written in JavaScript.
 *
 * Also registers pix_mesh_* (see js/mesh3d.js): a live, rotating 3D
 * wireframe engine for this same interpreted tier, built entirely out of
 * the primitive-typed function calls JSCPP already supports (no
 * std::vector/struct/template/`::`/lambda needed in the user's C++).
 *
 * IMPORTANT — why the editor doesn't run the real `pix::Canvas` class:
 *   JSCPP has no built-in <vector>, <algorithm>, or std::string-as-container
 *   support (verified directly against the JSCPP source before building
 *   this). src/pixela.hpp's Canvas/Mesh/Renderer3D all depend on
 *   std::vector, so they can only run in the compiled WebAssembly tier
 *   (js/wasm-loader.js), where the REAL, unmodified pixela.hpp is compiled
 *   with Emscripten. Here in the live editor, we expose the same
 *   Braille-sub-pixel + true-color *technique* as plain `pix_*` functions
 *   (implemented in js/pixela-bindings.js, ported line-for-line from
 *   pixela.hpp's algorithms) so scripts can still be written and run
 *   instantly, without a compiler.
 *
 * Execution model:
 *   JSCPP's "debug" mode returns a Debugger object whose .next() steps the
 *   program by exactly one AST node and returns `false` while still
 *   running. We drive that stepper ourselves, one requestAnimationFrame at
 *   a time, and treat every call to pix_present() as a frame boundary: once
 *   the user's code calls pix_present(), we stop stepping, paint the
 *   canvas, and resume on the next animation frame. This turns an ordinary
 *   C++ `while(true) { ... pix_present(); }` loop into a real, non-blocking
 *   browser animation.
 * ------------------------------------------------------------------
 */
const Interpreter = (() => {
  let dbg = null;
  let running = false;
  let rafId = null;
  let frameFlag = false;
  let framesRendered = 0;
  let lastFpsTime = 0;
  let onLog = () => {};
  let onError = () => {};
  let onFps = () => {};
  let onFinished = () => {};

  const MAX_STEPS_PER_FRAME = 300000; // safety valve against runaway loops between two presents

  function buildPixHeader() {
    return {
      load(rt) {
        const g = 'global';
        const tInt = rt.intTypeLiteral;
        const tDouble = rt.doubleTypeLiteral;
        const tBool = rt.boolTypeLiteral;
        const tVoid = rt.voidTypeLiteral;

        rt.regFunc(() => { Pixela.clear(); return rt.val(tVoid, 0); }, g, 'pix_clear', [], tVoid);
        rt.regFunc(() => { Pixela.present(); frameFlag = true; return rt.val(tVoid, 0); }, g, 'pix_present', [], tVoid);
        rt.regFunc(() => rt.val(tInt, Pixela.width()), g, 'pix_width', [], tInt);
        rt.regFunc(() => rt.val(tInt, Pixela.height()), g, 'pix_height', [], tInt);
        rt.regFunc(() => rt.val(tDouble, Pixela.time()), g, 'pix_time', [], tDouble);

        rt.regFunc((rt, _t, x, y, on, r, g_, b) => {
          Pixela.setPixel(x.v, y.v, !!on.v, r.v, g_.v, b.v);
          return rt.val(tVoid, 0);
        }, g, 'pix_set', [tInt, tInt, tBool, tInt, tInt, tInt], tVoid);

        rt.regFunc((rt, _t, x, y) => rt.val(tBool, Pixela.getPixel(x.v, y.v)),
          g, 'pix_get', [tInt, tInt], tBool);

        rt.regFunc((rt, _t, x0, y0, x1, y1, r, g_, b) => {
          Pixela.drawLine(x0.v, y0.v, x1.v, y1.v, r.v, g_.v, b.v);
          return rt.val(tVoid, 0);
        }, g, 'pix_line', [tInt, tInt, tInt, tInt, tInt, tInt, tInt], tVoid);

        rt.regFunc((rt, _t, x, y, w, h, filled, r, g_, b) => {
          Pixela.drawRect(x.v, y.v, w.v, h.v, !!filled.v, r.v, g_.v, b.v);
          return rt.val(tVoid, 0);
        }, g, 'pix_rect', [tInt, tInt, tInt, tInt, tBool, tInt, tInt, tInt], tVoid);

        rt.regFunc((rt, _t, cx, cy, radius, filled, r, g_, b) => {
          Pixela.drawCircle(cx.v, cy.v, radius.v, !!filled.v, r.v, g_.v, b.v);
          return rt.val(tVoid, 0);
        }, g, 'pix_circle', [tInt, tInt, tInt, tBool, tInt, tInt, tInt], tVoid);

        rt.regFunc((rt, _t, x0, y0, x1, y1, x2, y2, r, g_, b) => {
          Pixela.drawTriangle(x0.v, y0.v, x1.v, y1.v, x2.v, y2.v, r.v, g_.v, b.v);
          return rt.val(tVoid, 0);
        }, g, 'pix_triangle', [tInt, tInt, tInt, tInt, tInt, tInt, tInt, tInt, tInt], tVoid);

        // --- pix_mesh_*: wireframe 3D real, ao vivo, sem std::vector/struct/
        // template/`::`/lambda no C++ do usuário — ver js/mesh3d.js para o
        // porquê e para a matemática (portada de src/pixela.hpp). Todo o
        // armazenamento dinâmico (lista de vértices/arestas) e toda a conta
        // cara (trig, projeção, Bresenham) roda nativo em JS; o C++
        // interpretado só monta a malha uma vez e chama pix_mesh_draw() por
        // quadro — custo de "passos" do interpretador praticamente nulo.
        rt.regFunc(() => { Mesh3D.reset(); return rt.val(tVoid, 0); },
          g, 'pix_mesh_reset', [], tVoid);

        rt.regFunc((rt, _t, x, y, z) => rt.val(tInt, Mesh3D.addVertex(x.v, y.v, z.v)),
          g, 'pix_mesh_add_vertex', [tDouble, tDouble, tDouble], tInt);

        rt.regFunc((rt, _t, i, j) => { Mesh3D.addEdge(i.v, j.v); return rt.val(tVoid, 0); },
          g, 'pix_mesh_add_edge', [tInt, tInt], tVoid);

        rt.regFunc((rt, _t, x, y, z) => { Mesh3D.setPos(x.v, y.v, z.v); return rt.val(tVoid, 0); },
          g, 'pix_mesh_set_pos', [tDouble, tDouble, tDouble], tVoid);

        rt.regFunc((rt, _t, x, y, z) => { Mesh3D.setAngle(x.v, y.v, z.v); return rt.val(tVoid, 0); },
          g, 'pix_mesh_set_angle', [tDouble, tDouble, tDouble], tVoid);

        rt.regFunc((rt, _t, sx, sy, sz, dt) => { Mesh3D.spin(sx.v, sy.v, sz.v, dt.v); return rt.val(tVoid, 0); },
          g, 'pix_mesh_spin', [tDouble, tDouble, tDouble, tDouble], tVoid);

        rt.regFunc((rt, _t, f) => { Mesh3D.setFocal(f.v); return rt.val(tVoid, 0); },
          g, 'pix_mesh_set_focal', [tDouble], tVoid);

        rt.regFunc((rt, _t, r, g_, b) => rt.val(tInt, Mesh3D.draw(
            Pixela.width(), Pixela.height(), r.v, g_.v, b.v, Pixela.drawLine)),
          g, 'pix_mesh_draw', [tInt, tInt, tInt], tInt);
      }
    };
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    dbg = null;
  }

  function run(cppSource, callbacks = {}) {
    stop();
    onLog = callbacks.onLog || onLog;
    onError = callbacks.onError || onError;
    onFps = callbacks.onFps || onFps;
    onFinished = callbacks.onFinished || onFinished;

    Pixela.setTime(0);
    const startTime = performance.now();

    try {
      dbg = JSCPP.run(cppSource, '', {
        includes: { 'pixela.h': buildPixHeader() },
        stdio: { write: (s) => onLog(s) },
        debug: true,
        unsigned_overflow: 'error',
      });
    } catch (e) {
      onError(e.message || String(e));
      return;
    }

    running = true;
    framesRendered = 0;
    lastFpsTime = startTime;

    const step = () => {
      if (!running || !dbg) return;
      Pixela.setTime((performance.now() - startTime) / 1000);
      frameFlag = false;
      let stepsThisFrame = 0;
      let finished = false;
      let exitVal = null;

      while (!frameFlag && stepsThisFrame < MAX_STEPS_PER_FRAME) {
        let result;
        try {
          result = dbg.next();
        } catch (e) {
          onError(e.message || String(e));
          stop();
          return;
        }
        stepsThisFrame++;
        if (result !== false) { finished = true; exitVal = result; break; }
      }

      framesRendered++;
      const now = performance.now();
      if (now - lastFpsTime > 500) {
        onFps(Math.round((framesRendered * 1000) / (now - lastFpsTime)));
        framesRendered = 0;
        lastFpsTime = now;
      }

      if (finished) {
        stop();
        onFinished(exitVal);
        return;
      }
      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
  }

  return { run, stop, get running() { return running; } };
})();

window.Interpreter = Interpreter;
