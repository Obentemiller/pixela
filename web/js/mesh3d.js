/**
 * mesh3d.js
 * ------------------------------------------------------------------
 * Extends the interpreted tier (js/interpreter.js + js/pixela-bindings.js)
 * with real, live, rotating 3D wireframes — without needing std::vector,
 * structs, templates, `::`, `auto` or lambdas in the user's C++.
 *
 * Why this is safe to add (verified against the actual JSCPP interpreter,
 * not assumed):
 *   - JSCPP's grammar *parses* `struct`, but its interpreter.js has zero
 *     visitor code for struct declarations — they parse and then fail at
 *     evaluation time ("type struct X is not defined"). So even
 *     struct-based Vec3 is a dead end here, not just std::vector.
 *   - What DOES work end-to-end (confirmed by actually running programs
 *     through JSCPP.run in Node): plain ints/doubles, fixed-size arrays
 *     (already used for N_STARS in js/examples.js), pointers, functions,
 *     loops, and #define constants.
 *
 * The trick, same one already used for pix_line/pix_circle/pix_rect: push
 * all *dynamic-size* storage and all *expensive* math (trig, projection,
 * Bresenham rasterization) into native JS, and expose only a flat,
 * primitive-typed function surface to the interpreted C++. The C++ side
 * only does cheap bookkeeping (building the vertex/edge list once, then
 * one function call per frame) — so this adds effectively zero interpreter
 * step cost per frame, and does not touch MAX_STEPS_PER_FRAME headroom.
 *
 * Math below is ported line-for-line from src/pixela.hpp:
 *   - rotateX/rotateY/rotateZ  (free functions, lines ~271-281)
 *   - Renderer3D::project      (line ~372)
 *   - Renderer3D::drawMesh's rotate+translate pipeline (line ~407)
 * This is wireframe-only (drawLine3D), not the shaded/z-buffered triangle
 * fill (Renderer3D::drawTriangle) — that part still needs a real z-buffer
 * per pixel and is what the WASM tier (pix::Renderer3D, wasm:mesh3d demo)
 * is for. See README "Duas camadas de execução, agora três funções".
 * ------------------------------------------------------------------
 */
const Mesh3D = (() => {
  let verts = [];   // [{x,y,z}, ...]   (unbounded JS array — no vector needed on the C++ side)
  let edges = [];   // [[i,j], ...]
  let pos = { x: 0, y: 0, z: 0 };
  let angle = { x: 0, y: 0, z: 0 };
  let focal = 0;    // 0 = auto (90% of pixel width), mirrors Renderer3D's constructor default

  function reset() {
    verts = []; edges = [];
    pos = { x: 0, y: 0, z: 0 };
    angle = { x: 0, y: 0, z: 0 };
  }

  function addVertex(x, y, z) { verts.push({ x, y, z }); return verts.length - 1; }
  function addEdge(i, j) {
    if (i < 0 || j < 0 || i >= verts.length || j >= verts.length) return;
    edges.push([i, j]);
  }
  function setPos(x, y, z) { pos = { x, y, z }; }
  function setAngle(x, y, z) { angle = { x, y, z }; }
  // Mirrors Renderer3D::drawMesh's `m.angle += m.spin * dt` accumulation.
  function spin(sx, sy, sz, dt) { angle.x += sx * dt; angle.y += sy * dt; angle.z += sz * dt; }
  function setFocal(f) { focal = f; }

  // -- ported line-for-line from pixela.hpp --
  function rotateX(p, a) { const c = Math.cos(a), s = Math.sin(a); return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c }; }
  function rotateY(p, a) { const c = Math.cos(a), s = Math.sin(a); return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c }; }
  function rotateZ(p, a) { const c = Math.cos(a), s = Math.sin(a); return { x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z }; }

  function project(p, w, h) {
    if (p.z <= 0.05) return null; // atrás da câmera, mesmo corte de Renderer3D::project
    const f = focal > 0 ? focal : w * 0.9;
    const scale = f / p.z;
    return { sx: w * 0.5 + p.x * scale, sy: h * 0.5 - p.y * scale };
  }

  /** Transforms every vertex (rotate X→Y→Z, then translate by pos — same
   *  order as Renderer3D::drawMesh) and draws every edge whose both
   *  endpoints project in front of the camera. drawLineFn is injected so
   *  this module has no direct dependency on Pixela/js/pixela-bindings.js.
   *  Returns how many edges were actually drawn (visible). */
  function draw(w, h, r, g, b, drawLineFn) {
    const world = verts.map((v) => {
      let p = rotateX(v, angle.x);
      p = rotateY(p, angle.y);
      p = rotateZ(p, angle.z);
      return { x: p.x + pos.x, y: p.y + pos.y, z: p.z + pos.z };
    });
    let drawn = 0;
    for (const [i, j] of edges) {
      const pa = project(world[i], w, h);
      const pb = project(world[j], w, h);
      if (pa && pb) {
        drawLineFn(pa.sx | 0, pa.sy | 0, pb.sx | 0, pb.sy | 0, r, g, b);
        drawn++;
      }
    }
    return drawn;
  }

  return { reset, addVertex, addEdge, setPos, setAngle, spin, setFocal, draw };
})();

window.Mesh3D = Mesh3D;
