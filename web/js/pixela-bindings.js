/**
 * pixela-bindings.js
 * ------------------------------------------------------------------
 * The live editor runs C++ through JSCPP, a JS-based interpreter that does
 * NOT support <vector>, <string> (as a container) or <algorithm> — see the
 * README for the compatibility test that established this. Since the real
 * src/pixela.hpp leans on std::vector everywhere (Canvas, Mesh, Renderer3D),
 * it cannot be interpreted as-is in the browser-editor tier; it runs
 * unmodified only in the compiled WebAssembly tier (js/wasm-loader.js).
 *
 * This file re-implements pixela.hpp's core *technique* — Braille sub-pixel
 * packing (2x4 real pixels per terminal cell) plus 24-bit true color — as a
 * small JS class, exposed to the editor as plain `pix_*` functions (see
 * js/interpreter.js). The drawing algorithms below (Bresenham line/circle,
 * rect, triangle) are ported line-for-line from pixela.hpp so the visual
 * result matches the compiled tier as closely as possible.
 * ------------------------------------------------------------------
 */
const Pixela = (() => {
  let grid = null;      // TerminalGrid (character cells)
  let pw = 0, ph = 0;   // pixel resolution = cols*2 x rows*4
  let on = null;        // Uint8Array, pw*ph
  let cellColor = null; // Array of "r,g,b" strings, cols*rows
  let t = 0;

  const BRAILLE_BIT = [[0, 1, 2, 6], [3, 4, 5, 7]];

  function bind(terminalGrid) {
    grid = terminalGrid;
    pw = grid.cols * 2;
    ph = grid.rows * 4;
    on = new Uint8Array(pw * ph);
    cellColor = new Array(grid.cols * grid.rows).fill('255,255,255');
  }

  function setTime(seconds) { t = seconds; }
  function time() { return t; }
  function width() { return pw; }
  function height() { return ph; }

  function idx(x, y) { return y * pw + x; }
  function cellIdx(cx, cy) { return cy * grid.cols + cx; }

  function clear() { on.fill(0); }

  function setPixel(x, y, isOn, r, g, b) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= pw || y >= ph) return;
    on[idx(x, y)] = isOn ? 1 : 0;
    if (isOn) cellColor[cellIdx(x >> 1, y >> 2)] = `${r},${g},${b}`;
  }

  function getPixel(x, y) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= pw || y >= ph) return false;
    return on[idx(x, y)] !== 0;
  }

  function drawLine(x0, y0, x1, y1, r, g, b) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      setPixel(x0, y0, true, r, g, b);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  function drawRect(x, y, w, h, filled, r, g, b) {
    x |= 0; y |= 0; w |= 0; h |= 0;
    if (filled) {
      for (let j = y; j < y + h; j++)
        for (let i = x; i < x + w; i++) setPixel(i, j, true, r, g, b);
    } else {
      drawLine(x, y, x + w - 1, y, r, g, b);
      drawLine(x, y + h - 1, x + w - 1, y + h - 1, r, g, b);
      drawLine(x, y, x, y + h - 1, r, g, b);
      drawLine(x + w - 1, y, x + w - 1, y + h - 1, r, g, b);
    }
  }

  function drawCircle(cx, cy, radius, filled, r, g, b) {
    cx |= 0; cy |= 0; radius |= 0;
    let x = radius, y = 0, err = 0;
    while (x >= y) {
      if (filled) {
        drawLine(cx - x, cy + y, cx + x, cy + y, r, g, b);
        drawLine(cx - x, cy - y, cx + x, cy - y, r, g, b);
        drawLine(cx - y, cy + x, cx + y, cy + x, r, g, b);
        drawLine(cx - y, cy - x, cx + y, cy - x, r, g, b);
      } else {
        setPixel(cx + x, cy + y, true, r, g, b); setPixel(cx + y, cy + x, true, r, g, b);
        setPixel(cx - y, cy + x, true, r, g, b); setPixel(cx - x, cy + y, true, r, g, b);
        setPixel(cx - x, cy - y, true, r, g, b); setPixel(cx - y, cy - x, true, r, g, b);
        setPixel(cx + y, cy - x, true, r, g, b); setPixel(cx + x, cy - y, true, r, g, b);
      }
      y += 1;
      if (err <= 0) err += 2 * y + 1;
      if (err > 0) { x -= 1; err -= 2 * x + 1; }
    }
  }

  function drawTriangle(x0, y0, x1, y1, x2, y2, r, g, b) {
    drawLine(x0, y0, x1, y1, r, g, b);
    drawLine(x1, y1, x2, y2, r, g, b);
    drawLine(x2, y2, x0, y0, r, g, b);
  }

  /** Packs the pixel buffer into terminal cells (Braille glyph + color)
   *  and writes them into the bound TerminalGrid, exactly mirroring what
   *  pix::Canvas::render() does in C++. Call once per frame, then
   *  grid.present(). */
  function present() {
    for (let cy = 0; cy < grid.rows; cy++) {
      for (let cx = 0; cx < grid.cols; cx++) {
        let mask = 0;
        for (let sx = 0; sx < 2; sx++)
          for (let sy = 0; sy < 4; sy++)
            if (getPixel((cx << 1) + sx, (cy << 2) + sy)) mask |= (1 << BRAILLE_BIT[sx][sy]);

        if (mask === 0) {
          grid.setCell(cx, cy, ' ', '#000000', '#000000');
          continue;
        }
        const ch = String.fromCodePoint(0x2800 + mask);
        const rgb = cellColor[cellIdx(cx, cy)];
        grid.setCell(cx, cy, ch, `rgb(${rgb})`, '#000000');
      }
    }
    grid.present();
  }

  return {
    bind, setTime, time, width, height, clear, setPixel, getPixel,
    drawLine, drawRect, drawCircle, drawTriangle, present,
  };
})();

window.Pixela = Pixela;
