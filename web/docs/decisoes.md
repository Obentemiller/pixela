# Decisões de Plataforma

*Tomadas durante a configuração inicial do compilador C++ → JavaScript.*

> **Status: Portão A APROVADO em 2026-10-11.** Decisão de plataforma: **Web Worker**.
> Evidência: `reports/B.log` (T1/T2/T4/T6/T7), `reports/C.log` (regressão),
> `reports/D.log` (51 testes unitários), `reports/test-browser.log` (12 passed).
> Este documento foi reescrito: a versão anterior afirmava coisas que os testes
> não sustentavam (ver "Correções" no fim).

---

## 1. Ambiente de execução do código do usuário: **Web Worker**

### Perguntas decisivas

1. O laço infinito do usuário é morto por `terminate()`?
2. `new Function` funciona dentro do Worker sob o CSP real do `index.html`?
3. Dá para passar quadros grandes sem `SharedArrayBuffer`?

### Como foi medido

Servidor estático local (`python3 -m http.server 8080 --bind 127.0.0.1`).
Cada teste é uma página em `tests/platform/fixtures/*.html` que carrega **o
mesmo `<meta>` CSP do `index.html`**, copiado por `sed` do arquivo original
(verificado com `diff`). Nada de `page.evaluate` em `about:blank` — foi
exatamente esse o erro da rodada anterior (`Failed to construct 'URL': Invalid
base URL`).

Chromium **156.0.8078.4**, headless, `--no-sandbox --disable-dev-shm-usage`.
Log completo: `reports/B.log`. Specs: `tests/platform/spec-t1-t2-t7.spec.js`,
`tests/platform/spec-t4-t6.spec.js`.

### Resultados

**T1 — Worker de módulo executa `new Function`. PASSA.**
```
RESULT: {"ok":true,"stage":"newFunction","value":2,"valueType":"number"}
=== T1 CSP VIOLATIONS ===
(nenhuma)
```
O Worker é criado com `new Worker(new URL('./w.js', location.href).href, {type:'module'})`.
Nenhuma violação de CSP é registrada no console.

**T2 — controle: o mesmo `new Function` na thread principal. BLOQUEADO.**
Mensagem real do navegador,verbatim:
```
name=EvalError
message=Evaluating a string as JavaScript violates the following Content Security
Policy directive because 'unsafe-eval' is not an allowed source of script:
script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'".
```

**T4 — laço infinito é morto por `terminate()`. PASSA.**
```
fase-1 ticks=20 em 2000ms (intervalo=100ms)
fase-2 terminate() retornou em 0.000ms
fase-2 ticks apos terminate=20 em 2000ms
"aposTerminate":{"novoWorkerRespondeu":true,"dados":{"pong":true,...}}
```
Leitura: durante os 2 s em que o Worker roda `for(;;){}`, o thread principal
registrou 20 ticks de 100 ms — ou seja, **não travou**. Após `terminate()`
(que retornou em 0.000 ms), o principal continuou registrando 20 ticks em mais
2 s, e um Worker novo e independente respondeu a `ping`.

**T6 — `postMessage` com `ArrayBuffer` transferível (Worker → principal).**
```
200x50 células = 10.000 células = 40.000 bytes por quadro, alvo 60 msg/s, 5 s
msgs=295  msgsPorSegundo=58.81
latenciaMediaMs=17.358  latenciaP95Ms=17.5  latenciaMinMs=17.1  latenciaMaxMs=17.9
```

**T7 — o que o ambiente realmente oferece.**
```
"crossOriginIsolated": false
"typeof SharedArrayBuffer": "undefined"
"sabConstrutoivel": "ERRO: ReferenceError: SharedArrayBuffer is not defined"
```

**T3/T5 — iframe sandbox: DESCARTADOS.** A pré-condição para descartar era que T1 e T4 passassem; ambos passaram, então
o descarte se sustenta.

### Respostas diretas

**O laço infinito é morto por `terminate()`?** Sim. Medido: 20/20 ticks do
principal antes e 20/20 depois, principal nunca congelou, Worker novo responde.
`terminate()` é síncrono e leva 0.000 ms.

**`new Function` funciona dentro do Worker com o CSP do `index.html`?** Sim.
Retorna `2`, sem violação de CSP. Na thread principal o mesmo código é
bloqueado com `EvalError`.

**Por que Worker e não iframe?** Porque T4 mediu o que só o Worker garante: um
laço infinito em JavaScript não congela a thread principal. `terminate()` mata
a thread; um `iframe` não oferece controle equivalente sobre o contexto de
execução.

### CSP aplicado

`index.html` linha 8 (copiada idêntica para as 5 fixtures de teste):
```
default-src 'none'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval';
style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self';
base-uri 'none'; form-action 'none'; object-src 'none'; worker-src 'self';
```
`worker-src 'self'` foi adicionado nesta fase. `'unsafe-eval'` **não** foi
adicionado — T2 mostra que ele continua bloqueado na thread principal.

---

## 2. Testes diferenciais com compilador C++: **OBRIGATÓRIOS**

`g++` e `clang++` **existem** neste ambiente. Medido em `reports/F.log`:
```
/usr/bin/g++
g++ (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0
compile-exit=0   run-exit=0
/usr/bin/clang++
```
`emcc` **não** existe (`command -v emcc` → exit 1). A comparação do
`pixela.hpp` usará **g++ nativo**, não wasm.

Uma versão anterior deste documento dizia "g++ não disponível, diferenciais
marcados `unverified`". **Isso estava errado** e foi removido. A instalação
não foi necessária: o compilador já estava lá — o comando anterior usado
(`which`) não existe neste shell.

---

## 3. Regressão do app sob o CSP real

`tests/e2e/regressao-app.spec.js`, log em `reports/C.log`. **7 passaram,
3 pulados** (os `wasm:*`, porque `wasm/` tem só `.gitkeep`).

Números por exemplo e a versão do navegador estão em
[`docs/baseline-jscpp.md`](baseline-jscpp.md).

Violações de CSP: **0**. Erros de console: **0**.

---

## Correções em relação ao relatório anterior

Esta seção existe porque a versão anterior deste documento afirmava coisas que
os testes não sustentavam. Cada item mostra o erro original e a correção.

| Afirmação anterior | Realidade medida |
|---|---|
| "T1 e T4 falharam" | Falhavam por **bug do teste** (`page.evaluate` em `about:blank` → `Invalid base URL`; e o pinger de T4 era o mesmo worker em laço infinito, que nunca atendia `ping`). Corrigidos; ambos passam. |
| "Chromium 134, FPS ~20…" | **Inventado.** Não havia script. Versão real: Chromium 156.0.8078.4, FPS medidos por script (ver `docs/baseline-jscpp.md`). |
| "lexer.js e parser.js corretos para o browser" | **Falsos.** `node --check` falhava em `lexer.js:73` por literais de controle crus; `parser.js` importava `TokenType`, que `lexer.js` não exporta. Ambos corrigidos. |
| "GitHub Pages não bloqueia Worker via SAB" | Removido. T7 mediu `crossOriginIsolated: false` e `typeof SharedArrayBuffer: "undefined"`; a frase não era sustentada por nenhuma medição. |
| "preprocessor.js import OK, funcional" | Importava, mas tinha `RangeError: Invalid array length` e **loop infinito** em `#endif`. Corrigido. |
| "FUNCIONAL" para lexer/preprocessor/types/scope/source com 1 teste | **Falso.** A regra de status passou a exigir ≥ 10 testes passando (`tests/tools/gen-estado.mjs`). 6 bugs graves foram encontrados nesses módulos durante a auditoria. |