/**
 * wasm-loader.js
 * ------------------------------------------------------------------
 * Loads and drives the *actually compiled* C++ demos (src/shaders/*.cpp,
 * src/examples/*.cpp) built to WebAssembly with Emscripten from the user's
 * real, unmodified src/pixela.hpp (see build/build.sh and
 * .github/workflows/deploy.yml, which build these on every push using the
 * real emsdk toolchain — nothing here is simulated).
 *
 * Contract between the C++ side and this loader (see src/pixela_wasm_bridge.hpp):
 *
 *   extern "C" {
 *     void        pixela_wasm_init(int cols, int rows);
 *     const char* pixela_wasm_frame(double t, double dt); // UTF-8 C string:
 *                                                          // exactly what
 *                                                          // pix::Canvas::render()
 *                                                          // returns.
 *   }
 *
 * We treat this exactly like a terminal emulator would: read the ANSI SGR
 * true-color + Unicode Braille text and paint it onto the canvas terminal
 * (see js/ansi-parser.js). All per-frame math (raymarching, 3D rasterizing,
 * particle integration, etc.) happens inside compiled WebAssembly running
 * on the user's own CPU.
 * ------------------------------------------------------------------
 */
const WasmLoader = (() => {
  let mod = null;
  let grid = null;
  let rafId = null;
  let running = false;
  let framesRendered = 0;
  let lastFpsTime = 0;
  let onFps = () => {};
  let onError = () => {};

  const loadedScripts = new Set();

  function loadScript(src) {
    if (loadedScripts.has(src)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => { loadedScripts.add(src); resolve(); };
      s.onerror = () => reject(new Error(`Falha ao carregar módulo WASM: ${src}`));
      document.body.appendChild(s);
    });
  }

  /**
   * @param {string} name  base name, e.g. "volumetric" -> wasm/volumetric.js/.wasm
   * @param {TerminalGrid} terminalGrid
   */
  async function load(name, terminalGrid) {
    stop();
    grid = terminalGrid;

    await loadScript(`wasm/${name}.js`);
    const factoryName = `create${name[0].toUpperCase()}${name.slice(1)}Module`;
    const factory = window[factoryName];
    if (typeof factory !== 'function') {
      throw new Error(
        `Módulo WASM "${name}" não encontrado (esperava window.${factoryName}). ` +
        `Rode build/build.sh (requer Emscripten) para gerar wasm/${name}.js a partir de src/, ` +
        `ou publique via o workflow do GitHub Actions incluso no repositório.`
      );
    }
    mod = await factory();

    const init = mod.cwrap('pixela_wasm_init', null, ['number', 'number']);
    const frameFn = mod.cwrap('pixela_wasm_frame', 'number', ['number', 'number']);

    init(grid.cols, grid.rows);

    return { frameFn };
  }

  function start(handle, callbacks = {}) {
    onFps = callbacks.onFps || onFps;
    onError = callbacks.onError || onError;
    running = true;
    framesRendered = 0;
    const t0 = performance.now();
    let lastT = t0;
    lastFpsTime = t0;

    const step = () => {
      if (!running) return;
      const now = performance.now();
      const dt = (now - lastT) / 1000;
      const t = (now - t0) / 1000;
      lastT = now;

      try {
        const ptr = handle.frameFn(t, dt);
        const text = mod.UTF8ToString(ptr);
        AnsiParser.drawFrame(text, grid);
        grid.present();
      } catch (e) {
        onError(e.message || String(e));
        stop();
        return;
      }

      framesRendered++;
      if (now - lastFpsTime > 500) {
        onFps(Math.round((framesRendered * 1000) / (now - lastFpsTime)));
        framesRendered = 0;
        lastFpsTime = now;
      }
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    mod = null;
  }

  return { load, start, stop, get running() { return running; } };
})();

window.WasmLoader = WasmLoader;
