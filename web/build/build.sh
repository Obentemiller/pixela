#!/usr/bin/env bash
# build.sh
# ---------------------------------------------------------------------------
# Compiles every "compiled tier" demo in src/shaders and src/examples to
# WebAssembly with Emscripten, producing wasm/<name>.js + wasm/<name>.wasm.
#
# Requirements:
#   - Emscripten SDK activated in your shell (emcc must be on PATH).
#     Quick setup:
#       git clone https://github.com/emscripten-core/emsdk.git
#       cd emsdk && ./emsdk install latest && ./emsdk activate latest
#       source ./emsdk_env.sh
#
# You normally do NOT need to run this manually: the GitHub Actions workflow
# in .github/workflows/deploy.yml runs it automatically on every push to
# main and publishes the result to GitHub Pages. Run it locally only if you
# want to test the WASM demos before pushing, or add a new one.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT_DIR/src"
OUT_DIR="$ROOT_DIR/wasm"

if ! command -v emcc >/dev/null 2>&1; then
  echo "ERRO: emcc não encontrado no PATH." >&2
  echo "Ative o Emscripten SDK antes de rodar este script (veja o cabeçalho deste arquivo)." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

# name -> source file, mirrors what js/wasm-loader.js expects to find.
declare -A DEMOS=(
  [volumetric]="$SRC_DIR/shaders/volumetric.cpp"
  [mesh3d]="$SRC_DIR/examples/mesh3d.cpp"
  [particles]="$SRC_DIR/examples/particles.cpp"
)

for name in "${!DEMOS[@]}"; do
  src="${DEMOS[$name]}"
  factory="create$(tr '[:lower:]' '[:upper:]' <<< "${name:0:1}")${name:1}Module"
  echo "==> Compilando $name ($src) -> wasm/$name.js"
  emcc "$src" \
    -O3 -std=c++17 \
    -s MODULARIZE=1 \
    -s EXPORT_NAME="$factory" \
    -s EXPORTED_RUNTIME_METHODS='["cwrap","UTF8ToString"]' \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s ENVIRONMENT=web \
    -o "$OUT_DIR/$name.js"
done

echo "Concluído. Artefatos gerados em: $OUT_DIR"
ls -la "$OUT_DIR"
