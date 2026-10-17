/**
 * tests/tools/fs-loader.mjs — carrega includes do disco para o Preprocessor.
 *
 * O `Preprocessor` tem a REGRA (`resolve()` em `js/cpp/preprocessor.js`): o
 * include é relativo ao arquivo que inclui. Falta quem forneça o CONTEÚDO a
 * partir do disco — e é só isso que este arquivo faz.
 *
 * Antes da A1 havia três implementações desse "quem fornece o conteúdo", cada
 * uma com um cálculo de caminho próprio:
 *
 *   - `tests/tools/parse-project.mjs:mapaIncludes()`   (replicava `resolve`)
 *   - `tests/unit/projeto.test.js:includesDoProjeto()` (outra conta, com `/`)
 *   - `tests/unit/roundtrip-projeto.test.js`           (usava a primeira)
 *
 * Agora há uma. Este arquivo é o loader; a regra é do `Preprocessor`.
 *
 * Uso:
 *   import { mapaIncludes } from './fs-loader.mjs';
 *   const pp = new Preprocessor({ includes: mapaIncludes('src/examples/mesh3d.cpp') });
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve as canonico } from '../../js/cpp/preprocessor.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
/** Raiz do repositório: `tests/tools/` mais dois níveis acima. */
export const RAIZ = pathResolve(AQUI, '..', '..');

/**
 * Mapa `{ '<caminho canônico>': '<conteúdo>' }` para todos os headers
 * alcançáveis a partir de `arq`, por include QUOTADO ou por `<>`.
 *
 * A varredura é feita sobre os `#include` do próprio arquivo e, a partir
 * deles, recursivamente — que é como o C++ funciona: um header alcançado
 * por `../` pode incluir outros. Include de sistema (`<vector>`) NÃO entra
 * no mapa: esses são os headers virtuais (`DEFAULT_HEADERS`).
 *
 * @param {string} arq caminho relativo à raiz, ex. `src/examples/mesh3d.cpp`
 * @param {Set<string>} [vistos] guarda contra include circular
 * @returns {Record<string,string>}
 */
export function mapaIncludes(arq, vistos = new Set()) {
  const mapa = {};
  let abs = pathResolve(RAIZ, arq);
  // Aceita um DIRETÓRIO e usa o primeiro `.cpp` dentro dele — é assim que os
  // fixtures de `tests/fixtures/pp-inc/<caso>/` são usados.
  if (existsSync(abs) && statSync(abs).isDirectory()) {
    // O `.cpp` pode estar em sub-diretório (`caso03/src/main.cpp`): procura
    // em profundidade, e pega o primeiro em ordem alfabética — determinístico.
    const achados = [];
    const achar = (d) => {
      for (const n of readdirSync(d).sort()) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) achar(p);
        else if (n.endsWith('.cpp')) achados.push(p);
      }
    };
    achar(abs);
    const entrada = achados[0];
    if (!entrada) return mapa;
    abs = entrada;
  }
  if (!existsSync(abs) || !statSync(abs).isFile() || vistos.has(abs)) return mapa;
  vistos.add(abs);
  const relArq = abs.slice(RAIZ.length + 1);

  const dir = dirname(abs);
  for (const linha of readFileSync(abs, 'utf8').split('\n')) {
    // Um include normal...
    const m = /^\s*#\s*include\s*([<"])([^>"]+)[>"]/.exec(linha);
    // ...ou `#include MACRO`, onde o nome vem de um `#define` do MESMO
    // arquivo. Sem este segundo ramo, `#define M "x.h"` + `#include M`
    // ficaria sem header no mapa e o teste acusaria "não encontrado" —
    // um bug do LOADER, não do pré-processador (fixture caso17).
    let tipo = null;
    let spec = null;
    if (m) {
      [, tipo, spec] = m;
    } else {
      const macros = new Map();
      for (const l of readFileSync(abs, 'utf8').split('\n')) {
        const d = /^\s*#\s*define\s+(\w+)\s+(.*)$/.exec(l);
        if (d) macros.set(d[1], d[2].trim().replace(/^"|"$/g, ''));
      }
      const incMacro = /^\s*#\s*include\s+(\w+)\s*$/.exec(linha);
      if (incMacro && macros.has(incMacro[1])) {
        tipo = '"';
        spec = macros.get(incMacro[1]);
      }
    }
    if (!spec) continue;
    // Só include de `"..."` é relativo ao includer no C++; `<...>` é
    // procurado nos caminhos de sistema. Ambos podem existir no disco, mas
    // o que o código do projeto usa é o de aspas.
    const chave = tipo === '"' ? canonico(relArq, spec) : spec;
    if (!chave) continue;
    const alvoAbs = pathResolve(RAIZ, chave);
    // `existsSync` também é true para DIRETÓRIO: `#include "inc"` (sem
    // arquivo) passaria o teste e o `readFileSync` lançaria EISDIR. Um include
    // que resolve precisa ser um ARQUIVO.
    if (!existsSync(alvoAbs) || !statSync(alvoAbs).isFile()) continue;
    mapa[chave] = readFileSync(alvoAbs, 'utf8');
    Object.assign(mapa, mapaIncludes(chave, vistos));
  }
  return mapa;
}

/**
 * Mapa para um conjunto de arquivos de uma vez — o `includes` que os testes
 * de projeto precisam, sem repetir a varredura por arquivo.
 *
 * @param {string[]} arquivos caminhos relativos à raiz
 * @returns {Record<string,string>}
 */
export function mapaDe(arquivos) {
  const mapa = {};
  for (const a of arquivos) Object.assign(mapa, mapaIncludes(a));
  return mapa;
}

/**
 * Todos os headers do projeto, indexados por caminho canônico E por nome
 * curto — para os testes que precisam do conjunto inteiro, e não do
 * alcançável a partir de um arquivo.
 */
export function todosHeaders(dirs = ['src']) {
  const mapa = {};
  const vistos = new Set();
  const andar = (dir) => {
    if (!existsSync(dir)) return;
    for (const nome of readdirSegura(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) { andar(p); continue; }
      if (!/\.(hpp|h)$/.test(nome)) continue;
      const rel = p.slice(RAIZ.length + 1);
      if (vistos.has(rel)) continue;
      vistos.add(rel);
      mapa[rel] = readFileSync(p, 'utf8');
      // nome curto, para `#include <pixela.hpp>`
      if (!(nome in mapa)) mapa[nome] = mapa[rel];
    }
  };
  for (const d of dirs) andar(pathResolve(RAIZ, d));
  return mapa;
}

function readdirSegura(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}