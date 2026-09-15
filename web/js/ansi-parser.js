/**
 * ansi-parser.js
 * ------------------------------------------------------------------
 * Parses the text format emitted by the user's real `pix::Canvas::render()`
 * (src/pixela.hpp, unmodified): rows of Unicode Braille glyphs (U+2800..
 * U+28FF) preceded by ANSI SGR true-color escapes (`\x1b[38;2;r;g;bm`) and
 * reset codes (`\x1b[0m`), one row per line.
 *
 * This is intentionally the same job a real terminal emulator does — we
 * just draw the result onto <canvas> (via TerminalGrid) instead of onto a
 * TTY. No knowledge of pixela.hpp's internals is required: this only reads
 * the plain-text/ANSI contract of Canvas::render(), which is public and
 * documented in pixela.hpp itself.
 * ------------------------------------------------------------------
 */
const AnsiParser = (() => {
  const ESC = '\x1b';

  /**
   * @param {string} text   full decoded frame from pixela_wasm_frame()
   * @param {TerminalGrid} grid  destination grid; must already be sized to
   *                             the same cols/rows the C++ side was told to
   *                             use (see wasm-loader.js).
   */
  function drawFrame(text, grid) {
    let x = 0, y = 0;
    let curColor = '#d7e0ea';
    let i = 0;
    const n = text.length;

    while (i < n && y < grid.rows) {
      const ch = text[i];

      if (ch === ESC) {
        // Expect: ESC '[' ... 'm'
        const close = text.indexOf('m', i);
        if (close === -1) break; // malformed tail, stop safely
        const codeBody = text.slice(i + 2, close); // strip ESC '['
        if (codeBody === '0') {
          curColor = '#d7e0ea';
        } else {
          const parts = codeBody.split(';').map(Number);
          // Expect [38, 2, r, g, b]
          if (parts.length >= 5 && parts[0] === 38 && parts[1] === 2) {
            const [, , r, g, b] = parts;
            curColor = `rgb(${r},${g},${b})`;
          }
        }
        i = close + 1;
        continue;
      }

      if (ch === '\n') {
        x = 0;
        y += 1;
        i += 1;
        continue;
      }

      if (x < grid.cols) {
        grid.setCell(x, y, ch, curColor, '#000000');
        x += 1;
      }
      i += 1;
    }
  }

  return { drawFrame };
})();

window.AnsiParser = AnsiParser;
