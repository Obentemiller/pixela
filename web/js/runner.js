/**
 * js/runner.js
 * ------------------------------------------------------------------
 * Runner de execução end-to-end para o compilador Pixela:
 *   Preprocessor → Lexer → Parser → CodeGenerator → new Function(...)
 *
 * O código gerado pelo CodeGenerator é executado em um escopo isolado
 * (new Function) com as funções pix_* injetadas como parâmetros, espelhando
 * as assinaturas definidas em js/interpreter.js::buildPixHeader().
 *
 * O pix_present é injetado como um wrapper gerador que chama Pixela.present()
 * e faz yield, permitindo suspensão entre frames pelo driver.
 */
import { Lexer } from './cpp/lexer.js';
import { Parser } from './cpp/parser.js';
import { Preprocessor } from './cpp/preprocessor.js';
import { CodeGenerator } from './cpp/codegen.js';

/**
 * Obtém o objeto Pixela de forma robusta:
 *  1. window.Pixela (disponível após carregar js/pixela-bindings.js no navegador)
 *  2. globalThis.Pixela (para testes em Node.js)
 *  3. null (fallback, causará erro claro se não encontrado)
 */
function getPixela() {
  if (typeof window !== 'undefined' && window.Pixela) return window.Pixela;
  if (typeof globalThis.Pixela !== 'undefined') return globalThis.Pixela;
  return null;
}

// Estado de execução no escopo do MÓDULO.
//
// BUG-1: `running`/`rafId` estavam declarados com `let` dentro de
// compileAndRun(), mas stop() é exportado no escopo do módulo. Como módulo ES
// roda em modo estrito, `running = false` em stop() lançava
// ReferenceError: running is not defined — e main.js::stopAll() chama
// Runner.stop() como PRIMEIRO passo de runCurrent(), abortando a execução
// inteira antes de compilar qualquer código.
let running = false;
let rafId = null;
let startTime = 0;

// Cria um array multidimensional com as dimensões especificadas.
// Ex: createArray([2, 2, 2]) => [[[0,0,0],[0,0,0]],[[0,0,0],[0,0,0]]]
function createArray(dims) {
  if (dims.length === 0) return 0;
  if (dims.length === 1) return new Array(dims[0]).fill(0);
  const rest = dims.slice(1);
  return new Array(dims[0]).fill(0).map(() => createArray(rest));
}

/**
 * Constrói o objeto de funções pix_* a ser injetado no new Function.
 * Espelha exatamente as assinaturas de js/interpreter.js::buildPixHeader(),
 * sem alterar js/pixela-bindings.js.
 *
 * pix_present é um generator que chama Pixela.present() e faz yield,
 * permitindo suspensão entre frames pelo driver.
 */
function buildPixFunctions() {
  const P = getPixela();
  if (!P) {
    throw new Error(
      'Pixela não encontrado. Carregue js/pixela-bindings.js antes de usar o Runner, ' +
      'ou defina globalThis.Pixela para testes.'
    );
  }

  const fns = {
    pix_clear: () => { P.clear(); },
    // BUG-6: era `pixPresentGen()`, que INVOCA o generator uma única vez no
    // setup e guardava o objeto iterator. Esse objeto é consumido no primeiro
    // frame e nunca recriado, então `yield* pix_present()` falhava logo depois
    // (ver reports/conceito/verify-pix-present.log). Passamos a FUNÇÃO
    // generator: cada `pix_present()` cria um iterator novo, que é o que o
    // `yield*` do código gerado espera.
    pix_present: pixPresentGen,
    pix_width: () => P.width(),
    pix_height: () => P.height(),
    pix_time: () => P.time(),
    pix_set: (x, y, on, r, g, b) => { P.setPixel(x, y, !!on, r, g, b); },
    pix_get: (x, y) => P.getPixel(x, y),
    pix_line: (x0, y0, x1, y1, r, g, b) => { P.drawLine(x0, y0, x1, y1, r, g, b); },
    pix_rect: (x, y, w, h, filled, r, g, b) => { P.drawRect(x, y, w, h, !!filled, r, g, b); },
    pix_circle: (cx, cy, radius, filled, r, g, b) => { P.drawCircle(cx, cy, radius, !!filled, r, g, b); },
    pix_triangle: (x0, y0, x1, y1, x2, y2, r, g, b) => { P.drawTriangle(x0, y0, x1, y1, x2, y2, r, g, b); },
  };

  // BUG-16: as funções pix_mesh_* são registradas em js/interpreter.js (caminho
  // JSCPP) usando Mesh3D global de js/mesh3d.js. O Runner precisa injetá-las
  // também, pois o código gerado as chama como funções normais. Se Mesh3D não
  // estiver disponível (ex: teste em Node sem js/mesh3d.js), usamos um stub
  // mínimo para que pelo menos a sintaxe e o fluxo básico funcionem.
  const M = (typeof globalThis !== 'undefined' && globalThis.Mesh3D) || null;
  if (M) {
    fns.pix_mesh_reset = () => { M.reset(); return 0; };
    fns.pix_mesh_add_vertex = (x, y, z) => { return M.addVertex(x, y, z); };
    fns.pix_mesh_add_edge = (i, j) => { M.addEdge(i, j); return 0; };
    fns.pix_mesh_set_pos = (x, y, z) => { M.setPos(x, y, z); return 0; };
    fns.pix_mesh_set_angle = (x, y, z) => { M.setAngle(x, y, z); return 0; };
    fns.pix_mesh_spin = (sx, sy, sz, dt) => { M.spin(sx, sy, sz, dt); return 0; };
    fns.pix_mesh_set_focal = (f) => { M.setFocal(f); return 0; };
    // BUG-18: o Mesh3D.draw(w, h, r, g, b, drawLineFn) precisa de drawLineFn
    // (mirror de js/interpreter.js:121-122, que passa Pixela.drawLine).
    // Sem isso, drawLineFn é undefined e lança "drawLineFn is not a function".
    fns.pix_mesh_draw = (r, g, b) => { return M.draw(P.width(), P.height(), r, g, b, P.drawLine); };
  } else {
    // Stub mínimo para testes em Node sem js/mesh3d.js
    fns.pix_mesh_reset = () => 0;
    fns.pix_mesh_add_vertex = () => 0;
    fns.pix_mesh_add_edge = () => 0;
    fns.pix_mesh_set_pos = () => 0;
    fns.pix_mesh_set_angle = () => 0;
    fns.pix_mesh_spin = () => 0;
    fns.pix_mesh_set_focal = () => 0;
    fns.pix_mesh_draw = () => 0;
  }

  // --- pix_text_* / pix_text3d_*: letreiros 2D e 3D (js/text.js) ---
  //
  // O texto não é reinterpretado: TextEngine.api expõe as mesmas funções que o
  // adaptador JSCPP registra (TextEngine.install), só que em JS puro. Assim os
  // dois motores compartilham layout, fonte vetorial, z-buffer e traçado —
  // não existem duas implementações para divergirem.
  //
  // reset() no início de cada execução: os handles são inteiros sequenciais e
  // um letreiro de uma execução anterior não pode reaparecer nesta.
  const T = (typeof globalThis !== 'undefined' && globalThis.TextEngine) || null;
  if (T) {
    T.reset();
    for (const [name, fn] of Object.entries(T.api)) {
      fns[name] = fn;
    }
    // Constantes (PIX_ALIGN_LEFT, PIX_EDGE_WRAP, PIX_STYLE_SOLID...).
    // No JSCPP elas vêm de rt.defVar(); aqui entram na mesma tabela de
    // injeção — o rebind `NOME = __pix_NOME` funciona igual para valores.
    for (const [name, value] of Object.entries(T.CONSTANTS)) {
      fns[name] = value;
    }
  } else {
    // Sem js/text.js carregado: registra stubs inofensivos para o código
    // gerado não quebrar com "is not a function" (mesma política do Mesh3D).
    for (const name of TEXT_FUNCTION_NAMES) {
      fns[name] = () => 0;
    }
    for (const [name, value] of Object.entries(TEXT_CONSTANTS)) {
      fns[name] = value;
    }
  }

  return fns;
}

// Nomes de todas as funções de letreiro, para o fallback sem js/text.js.
// Mantido em sincronia com TextEngine.SIGNATURES por tests/unit/text-engine.test.js.
export const TEXT_FUNCTION_NAMES = [
  'pix_text_create', 'pix_text_set_string', 'pix_text_set_pos', 'pix_text_set_size',
  'pix_text_set_angle', 'pix_text_set_color', 'pix_text_set_thickness', 'pix_text_set_align',
  'pix_text_set_spacing', 'pix_text_set_velocity', 'pix_text_set_spin', 'pix_text_set_edge',
  'pix_text_set_wave', 'pix_text_update', 'pix_text_draw', 'pix_text_remove',
  'pix_text_width', 'pix_text_height', 'pix_text_x', 'pix_text_y', 'pix_text_angle',
  'pix_text_update_all', 'pix_text_draw_all', 'pix_text_clear_all', 'pix_text_draw_at',
  'pix_text3d_create', 'pix_text3d_set_string', 'pix_text3d_set_pos', 'pix_text3d_set_angle',
  'pix_text3d_set_spin', 'pix_text3d_set_velocity', 'pix_text3d_set_size', 'pix_text3d_set_depth',
  'pix_text3d_set_color', 'pix_text3d_set_style', 'pix_text3d_set_align', 'pix_text3d_set_spacing',
  'pix_text3d_set_wave', 'pix_text3d_update', 'pix_text3d_remove', 'pix_text3d_draw',
  'pix_text3d_width', 'pix_text3d_update_all', 'pix_text3d_draw_all', 'pix_text3d_clear_all',
];

// Valores de fallback das constantes de letreiro (mesmos de TextEngine.CONSTANTS).
export const TEXT_CONSTANTS = {
  PIX_ALIGN_LEFT: 0, PIX_ALIGN_CENTER: 1, PIX_ALIGN_RIGHT: 2,
  PIX_EDGE_NONE: 0, PIX_EDGE_WRAP: 1, PIX_EDGE_BOUNCE: 2,
  PIX_STYLE_WIRE: 0, PIX_STYLE_SOLID: 1,
};

/**
 * Wrapper generator para pix_present.
 * Chama Pixela.present() (pinta o canvas) e faz yield,
 * permitindo suspensão entre frames pelo driver.
 */
function* pixPresentGen() {
  const P = getPixela();
  if (!P) {
    throw new Error('Pixela não disponível para pix_present');
  }
  P.present();
  yield;
}

/**
 * Executa código C++ através do nosso compilador e roda o JS gerado.
 *
 * @param {string} cppSource - Código-fonte C++
 * @param {Object} callbacks - { onLog, onFps, onError, onFinished }
 * @returns {{ stop: Function }} - Objeto com método stop() para cancelar
 */
export function compileAndRun(cppSource, callbacks = {}) {
  const { onLog = () => {}, onFps = () => {}, onError = () => {}, onFinished = () => {} } = callbacks;

  running = false;
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  startTime = performance.now();

  try {
    // 1. Preprocessar
    const pp = new Preprocessor({}).process(cppSource, 'main.cpp');

    // 2. Lexer
    const lexer = new Lexer(pp.text, 'main.cpp');
    const tokens = lexer.tokenize().tokens;

    // 3. Parser
    const parser = new Parser(tokens, { file: 'main.cpp' });
    const parseResult = parser.parse();

    const parseErrors = parseResult.diagnostics.filter(d => d.severity === 'error');
    if (parseErrors.length > 0) {
      const first = parseErrors[0];
      const msg = `Parse error at ${first.loc.line}:${first.loc.column}: ${first.message}`;
      onError(msg);
      return { stop: () => {} };
    }

    // 4. CodeGenerator
    const codegen = new CodeGenerator();
    const result = codegen.generate(parseResult.ast, { file: 'main.cpp' });

    if (!result.entry) {
      onError('Parse error: nenhuma função main() encontrada no código-fonte.');
      return { stop: () => {} };
    }

    // 5. Montar a função JS com as funções pix_* injetadas.
    //
    // BUG-2: o codegen emite o IIFE `(function(){ ... main(); })();`, que
    // chama a entry e DEVOLVE undefined. Como main() é `function*`, apenas
    // criar o generator — o corpo nunca executava e o runner caía no ramo
    // "execução síncrona", disparando onFinished() na hora. O codegen agora
    // devolve a própria entry (não a executa), então o runner a invoca.
    //
    // BUG-3: o cabeçalho gerado por _generatePixHeader() declara `function
    // pix_clear(){}` etc. no MESMO escopo do corpo do new Function. Em JS, uma
    // declaração de função sombreia um parâmetro de mesmo nome (ver
    // reports/conceito/verify-shadowing.log) — inclusive sob "use strict".
    // Logo as funções injetadas nunca eram chamadas: o código escrevia num
    // pixCanvas local e nada chegava ao canvas do terminal. Por isso os
    // parâmetros vêm com prefixo __pix_ e são religados aos nomes pix_*
    // depois que o cabeçalho foi avaliado.
    const pixFns = buildPixFunctions();
    const names = Object.keys(pixFns);
    const injectedParams = names.map((n) => `__pix_${n}`);
    const injectedValues = names.map((n) => pixFns[n]);
    const rebind = names.map((n) => `${n} = __pix_${n};`).join('\n');

    // O codegen publica a entry em `__pixela_entry` (ver _assembleModule).
    // Avaliamos o módulo, religamos os nomes pix_* e só então devolvemos a
    // entry — a ordem importa: o header do codegen precisa existir antes do
    // rebind, e a entry precisa ser chamada depois.
    const fnBody = `function createArray(dims) {
  if (dims.length === 0) return 0;
  if (dims.length === 1) return new Array(dims[0]).fill(0);
  const rest = dims.slice(1);
  return new Array(dims[0]).fill(0).map(() => createArray(rest));
}
${result.code}\n${rebind}\nreturn __pixela_entry;`;

    let factory;
    try {
      factory = new Function(...injectedParams, fnBody);
    } catch (e) {
      onError(`Codegen error: ${e.message}`);
      return { stop: () => {} };
    }

    // 6. Executar — se for generator, usar runGenerator; senão, execução direta
    try {
      const entryFn = factory(...injectedValues);

      if (typeof entryFn !== 'function') {
        onError(`Runtime error: entry "${result.entry}" não é uma função executável.`);
        return { stop: () => {} };
      }

      const resultValue = entryFn();

      if (resultValue && typeof resultValue === 'object' && typeof resultValue.next === 'function') {
        // É um generator
        return runGenerator(resultValue, callbacks);
      } else {
        // Execução síncrona direta (função não-suspensível)
        running = true;
        onFinished();
        return { stop: () => { running = false; } };
      }
    } catch (e) {
      onError(`Runtime error: ${e.message}`);
      return { stop: () => {} };
    }
  } catch (e) {
    onError(`Unexpected error: ${e.message}`);
    return { stop: () => {} };
  }
}

/**
 * Executa um generator com requestAnimationFrame, chamando gen.next()
 * a cada frame. Suspensão ocorre em yield* pix_present().
 *
 * @param {Generator} gen - O generator a executar
 * @param {Object} callbacks - { onLog, onFps, onError, onFinished }
 * @returns {{ stop: Function }}
 */
function runGenerator(gen, callbacks = {}) {
  const { onLog = () => {}, onFps = () => {}, onError = () => {}, onFinished = () => {} } = callbacks;

  let framesRendered = 0;
  let lastFpsTime = 0;

  const step = () => {
    if (!running) return;

    Pixela.setTime((performance.now() - startTime) / 1000);

    let result;
    try {
      result = gen.next();
    } catch (e) {
      onError(`Runtime error: ${e.message}`);
      stop();
      return;
    }

    if (result.done) {
      running = false;
      rafId = null;
      onFinished(result.value);
      return;
    }

    framesRendered++;
    const now = performance.now();
    if (now - lastFpsTime > 500) {
      onFps(Math.round((framesRendered * 1000) / (now - lastFpsTime)));
      framesRendered = 0;
      lastFpsTime = now;
    }

    rafId = requestAnimationFrame(step);
  };

  running = true;
  rafId = requestAnimationFrame(step);

  return { stop };
}

/**
 * Para a execução corrente (genrator ou síncrona).
 */
export function stop() {
  running = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

export const Runner = {
  compileAndRun,
  stop,
};

// Expor para uso em scripts não-módulo (ex: main.js como script comum)
if (typeof window !== 'undefined') {
  window.Runner = Runner;
}
