(function () {
  const canvas = document.getElementById('terminal-canvas');
  const container = document.getElementById('terminal-container');
  const editor = document.getElementById('code-editor');
  const runBtn = document.getElementById('runBtn');
  const stopBtn = document.getElementById('stopBtn');
  const resetBtn = document.getElementById('resetBtn');
  const exampleSelect = document.getElementById('exampleSelect');
  const consoleOut = document.getElementById('console-output');
  const fpsLabel = document.getElementById('fps');
  const gridSizeLabel = document.getElementById('grid-size');
  const statusMsg = document.getElementById('status-msg');
  const engineMode = document.getElementById('engine-mode');

  const grid = new TerminalGrid(canvas, container, {
    cellAspect: 0.56,
    targetCellHeight: 16,
    // IMPORTANT: this precisa ser uma function normal (não arrow function).
    // O construtor de TerminalGrid chama `this.onResize(...)` de forma síncrona
    // (dentro de _recalculate, chamado ainda dentro do `new TerminalGrid(...)`),
    // ou seja, ANTES da atribuição à const `grid` terminar. Uma arrow function
    // tentaria capturar `grid` do escopo externo, que ainda está na "temporal
    // dead zone" nesse instante -> ReferenceError. Usando `function` normal,
    // `this` é a própria instância (pois é chamada como `this.onResize(...)`),
    // então não precisamos referenciar `grid` aqui dentro.
    onResize: function (cols, rows) {
      gridSizeLabel.textContent = `Grade: ${cols}x${rows} (pixels: ${cols * 2}x${rows * 4})`;
      Pixela.bind(this); // resolution changed -> reallocate the JS-side pixel buffer
    },
  });
  Pixela.bind(grid);

  function log(msg, cls) {
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = msg;
    consoleOut.appendChild(line);
    consoleOut.scrollTop = consoleOut.scrollHeight;
  }

  function clearLog() { consoleOut.innerHTML = ''; }

  function setRunningUI(isRunning) {
    runBtn.disabled = isRunning;
    stopBtn.disabled = !isRunning;
    statusMsg.textContent = isRunning ? 'Executando…' : 'Parado.';
  }

  function stopAll() {
    Interpreter.stop();
    WasmLoader.stop();
    setRunningUI(false);
  }

  function loadExample(key) {
    if (key.startsWith('wasm:')) {
      const name = key.slice(5);
      editor.value =
        `// "${name}" é um exemplo compilado a partir da sua biblioteca real\n` +
        `// (src/pixela.hpp, sem nenhuma alteração) para WebAssembly.\n` +
        `// Veja o código-fonte completo em:\n` +
        `//   src/shaders/volumetric.cpp\n` +
        `//   src/examples/mesh3d.cpp\n` +
        `//   src/examples/particles.cpp\n` +
        `//\n` +
        `// Este modo mede desempenho NATIVO no seu navegador (pix::Canvas /\n` +
        `// pix::Renderer3D compilados, sem interpretação), ideal para testes\n` +
        `// de performance de efeitos gráficos pesados.\n` +
        `// Clique em "Executar" para carregar e rodar o módulo .wasm.\n`;
      editor.readOnly = true;
    } else {
      editor.readOnly = false;
      editor.value = EXAMPLES[key] || '';
    }
  }

  async function runCurrent() {
    stopAll();
    clearLog();
    const key = exampleSelect.value;

    if (key.startsWith('wasm:')) {
      const name = key.slice(5);
      engineMode.textContent = 'Motor: WebAssembly (pixela.hpp compilado, nativo)';
      setRunningUI(true);
      log(`Carregando módulo WASM "${name}"...`, 'ok');
      try {
        const handle = await WasmLoader.load(name, grid);
        log('Módulo carregado. Executando no seu processador local.', 'ok');
        WasmLoader.start(handle, {
          onFps: (fps) => { fpsLabel.textContent = `FPS: ${fps}`; },
          onError: (msg) => { log('Erro: ' + msg, 'err'); setRunningUI(false); },
        });
      } catch (e) {
        log(e.message, 'err');
        log('Dica: rode build/build.sh (requer emscripten) para gerar os arquivos em wasm/, ' +
            'ou use o workflow do GitHub Actions incluso no repositório.', 'warn');
        setRunningUI(false);
      }
      return;
    }

    engineMode.textContent = 'Motor: JSCPP (interpretado, 100% no navegador)';
    setRunningUI(true);
    Interpreter.run(editor.value, {
      onLog: (s) => log(s),
      onFps: (fps) => { fpsLabel.textContent = `FPS: ${fps}`; },
      onError: (msg) => { log('Erro: ' + msg, 'err'); setRunningUI(false); },
      onFinished: () => { log('Programa finalizado.', 'ok'); setRunningUI(false); },
    });
  }

  runBtn.addEventListener('click', runCurrent);
  stopBtn.addEventListener('click', () => { stopAll(); log('Execução interrompida pelo usuário.', 'warn'); });
  resetBtn.addEventListener('click', () => loadExample(exampleSelect.value));
  exampleSelect.addEventListener('change', (e) => { stopAll(); loadExample(e.target.value); });

  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = editor.selectionStart, en = editor.selectionEnd;
      editor.value = editor.value.slice(0, s) + '    ' + editor.value.slice(en);
      editor.selectionStart = editor.selectionEnd = s + 4;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runCurrent(); }
  });

  // initial state
  loadExample(exampleSelect.value);
  log('Pronto. Edite o script e clique em "Executar" (ou Ctrl+Enter).');
})();
