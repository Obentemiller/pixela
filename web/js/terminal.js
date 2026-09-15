/**
 * terminal.js
 * ------------------------------------------------------------------
 * Implements the "terminal" the user sees: a grid of character cells
 * (glyph + foreground + background), rendered onto a <canvas>.
 *
 * The tricky requirement handled here is:
 *   "defina uma proporção ajustável dada a página e que possa corrigir
 *    erros de proporções causadas na página automaticamente"
 *
 * Strategy:
 *  1. We pick a target character-cell aspect ratio (width/height), close
 *     to a real monospace glyph (~0.55-0.6).
 *  2. Whenever the container is resized (ResizeObserver), we compute the
 *     largest canvas size that (a) fits inside the container and
 *     (b) yields an integer number of rows/cols while respecting the
 *     target cell aspect ratio.
 *  3. The canvas's CSS size is set to that computed size and centered by
 *     its flex container -> this "letterboxes" the terminal instead of
 *     stretching/squashing glyphs when the page is resized to an odd
 *     proportion (ultra-wide window, narrow mobile screen, etc.)
 *  4. The canvas backing-store resolution is scaled by devicePixelRatio
 *     for crisp text on HiDPI screens.
 * ------------------------------------------------------------------
 */
class TerminalGrid {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} container
   * @param {Object} opts
   */
  constructor(canvas, container, opts = {}) {
    this.canvas = canvas;
    this.container = container;
    this.ctx = canvas.getContext('2d', { alpha: false });

    this.cellAspect = opts.cellAspect ?? 0.56; // width / height of one glyph cell
    this.targetCellHeight = opts.targetCellHeight ?? 16; // px, before DPR scaling
    this.minCols = opts.minCols ?? 40;
    this.minRows = opts.minRows ?? 20;
    this.maxCols = opts.maxCols ?? 240;
    this.maxRows = opts.maxRows ?? 120;

    this.cols = 0;
    this.rows = 0;
    this.cellW = 0;
    this.cellH = 0;
    this.dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));

    // buffer: Uint16 char code, plus two color index arrays (fg/bg as packed RGB strings via palette)
    this.buffer = null; // {char: Array<string>, fg: Array<string>, bg: Array<string>}
    this.onResize = opts.onResize || null;

    // Canvas 2D's `font` property does not understand CSS custom
    // properties (var(--mono)) — it must be a real font stack. Resolve it
    // once from the computed style of the page.
    this.fontFamily = getComputedStyle(document.documentElement)
      .getPropertyValue('--mono').trim() || 'monospace';

    this._resizeObserver = new ResizeObserver(() => this._recalculate());
    this._resizeObserver.observe(this.container);

    this._recalculate();
  }

  /** Recomputes canvas pixel size + grid dimensions to fit the container
   *  without distorting the character aspect ratio. */
  _recalculate() {
    const availW = Math.max(1, this.container.clientWidth - 0);
    const availH = Math.max(1, this.container.clientHeight - 0);

    // Start from a desired cell height and derive columns/rows that fit,
    // then shrink/grow the cell size in small steps until it fits snugly.
    let cellH = this.targetCellHeight;
    let cellW = cellH * this.cellAspect;

    let cols = Math.floor(availW / cellW);
    let rows = Math.floor(availH / cellH);

    cols = Math.min(this.maxCols, Math.max(this.minCols, cols));
    rows = Math.min(this.maxRows, Math.max(this.minRows, rows));

    // Recompute the actual cell size so that `cols x rows` cells fill the
    // available box as tightly as possible while keeping cellAspect fixed.
    const cellHByWidth = availW / (cols * this.cellAspect);
    const cellHByHeight = availH / rows;
    cellH = Math.max(6, Math.min(cellHByWidth, cellHByHeight));
    cellW = cellH * this.cellAspect;

    const cssW = Math.floor(cellW * cols);
    const cssH = Math.floor(cellH * rows);

    this.cols = cols;
    this.rows = rows;
    this.cellW = cellW;
    this.cellH = cellH;

    // CSS size (this is what "corrects" page-proportion errors: the
    // canvas is letterboxed inside the flex-centered container instead
    // of being stretched to fill it).
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';

    // Backing store resolution (crisp on HiDPI).
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.textBaseline = 'top';
    this.ctx.font = `${Math.round(cellH * 0.92)}px ${this.fontFamily}, monospace`;

    this._allocateBuffer();
    if (this.onResize) this.onResize(this.cols, this.rows);
  }

  _allocateBuffer() {
    const n = this.cols * this.rows;
    this.buffer = {
      char: new Array(n).fill(' '),
      fg: new Array(n).fill('#4be3a1'),
      bg: new Array(n).fill('#00000000'),
    };
  }

  idx(x, y) { return y * this.cols + x; }

  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.cols && y < this.rows; }

  clear(bg = '#000000') {
    this.buffer.char.fill(' ');
    this.buffer.fg.fill('#4be3a1');
    this.buffer.bg.fill(bg);
  }

  setCell(x, y, ch, fg, bg) {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    this.buffer.char[i] = ch;
    if (fg) this.buffer.fg[i] = fg;
    if (bg) this.buffer.bg[i] = bg;
  }

  getCell(x, y) {
    if (!this.inBounds(x, y)) return null;
    const i = this.idx(x, y);
    return { char: this.buffer.char[i], fg: this.buffer.fg[i], bg: this.buffer.bg[i] };
  }

  /** Draws the whole buffer to the canvas. Call once per frame. */
  present() {
    const { ctx, cols, rows, cellW, cellH } = this;
    // Background pass — batch identical bg colors per row for speed.
    for (let y = 0; y < rows; y++) {
      let runStart = 0;
      let runColor = this.buffer.bg[this.idx(0, y)];
      for (let x = 1; x <= cols; x++) {
        const color = x < cols ? this.buffer.bg[this.idx(x, y)] : null;
        if (color !== runColor) {
          if (runColor && runColor !== '#00000000') {
            ctx.fillStyle = runColor;
            ctx.fillRect(runStart * cellW, y * cellH, (x - runStart) * cellW, cellH);
          }
          runStart = x;
          runColor = color;
        }
      }
    }
    // Glyph pass
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = this.idx(x, y);
        const ch = this.buffer.char[i];
        if (ch === ' ' || ch === '') continue;
        ctx.fillStyle = this.buffer.fg[i];
        ctx.fillText(ch, x * cellW, y * cellH + cellH * 0.06);
      }
    }
  }

  destroy() {
    this._resizeObserver.disconnect();
  }
}

window.TerminalGrid = TerminalGrid;
