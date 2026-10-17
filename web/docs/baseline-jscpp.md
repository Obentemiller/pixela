# Linha de base — interpretador JSCPP (caminho atual do app)

Números **medidos por script**, não anotados à mão. Este arquivo é a referência
contra a qual o compilador próprio (C++ → JavaScript) será medido. A meta é
**≥ 50×** o JSCPP em FPS.

## Data e ambiente

| Item | Valor |
|---|---|
| Data da medição | 2026-10-11 |
| Navegador | Chromium 156.0.8078.4 (Playwright, headless) |
| User-Agent | `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.8078.4 Safari/537.36` |
| Flags | `--no-sandbox --disable-dev-shm-usage` |
| Máquina | Linux x86_64, 1 worker do Playwright (`workers: 1`) |
| Node | v22.14.0 |

Versão do navegador obtida por `browser.version()` em
`tests/e2e/browser-version.spec.js` (log: `reports/browser-version.log`).

## Comando que reproduz

```bash
# 1. servidor estático (obrigatório: as páginas usam o CSP real do index.html)
npm run serve            # python3 -m http.server 8080 --bind 127.0.0.1

# 2. regressão, que mede FPS e hash de canvas
npx playwright test tests/e2e/regressao-app.spec.js --reporter=list
```

Cada exemplo é executado por **10 amostras de 500 ms** após clicar em
`#runBtn`. O FPS relatado abaixo é o **máximo** entre as amostras, porque o
`#fps` é uma média móvel e exemplares lentos às vezes zeram entre amostras.
O log completo está em `reports/C.log`.

## Números medidos (JSCPP, caminho atual)

| Exemplo | FPS máx. | Amostras de FPS (500 ms cada) | Desenha? | Anima? | Como termina |
|---|---:|---|---|---|---|
| `hello` | 60 | 59, 60×9 | sim | não (imagem estática) | encerra sozinho em ~5 s (`while (frame < 300)`) |
| `plasma` | **1** | 1×10 | sim | sim | só por Parar |
| `bounce` | 60 | 61, 60×9 | sim | sim | só por Parar |
| `starfield` | 55 | 43, 52, 55, 55, 55, 54, 55, 54, 55, 55 | sim | sim | só por Parar |
| `wireframecube` | 60 | 59, 60×9 | sim | sim | só por Parar |
| `scene3d` | **9** | 6, 8×6, 9×3 | sim | sim | só por Parar |
| `saturn` | 16 | 12, 15, 15, 16, 15, 15, 16, 16, 16, 15 | sim | sim | só por Parar |

Exemplos `wasm:*` (volumetric, mesh3d, particles): **pulados** — `wasm/` contém
apenas `.gitkeep`, sem binários.

Violações de CSP: **0** em todos os exemplos. Erros de console: **0**.

## Meta de 50×

| Exemplo | Baseline JSCPP | Meta (50×) |
|---|---:|---:|
| `plasma` | 1 | ≥ 50 FPS |
| `scene3d` | 9 | ≥ 450 FPS |
| `saturn` | 16 | ≥ 800 FPS |
| `starfield` | 55 | ≥ 2750 FPS |
| `bounce` | 60 | ≥ 3000 FPS |
| `wireframecube` | 60 | ≥ 3000 FPS |
| `hello` | 60 | ≥ 3000 FPS |

Nota: para `hello` o FPS não é a métrica útil — o programa é finito e desenha a
mesma imagem todo quadro. O que importa é o tempo total até `Programa finalizado.`
(≈ 5 s no JSCPP).

## Como a medição será repetida

O mesmo script, o mesmo navegador e a mesma máquina. Qualquer alteração no
conjunto de exemplos, na resolução do canvas ou no tamanho da janela invalida
esta tabela e exige nova medição.