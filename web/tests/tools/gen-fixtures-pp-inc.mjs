#!/usr/bin/env node
/**
 * gen-fixtures-pp-inc.mjs — cria os 12 casos de `tests/fixtures/pp-inc/`.
 *
 * Cada caso é um diretório com:
 *   - `main.cpp`  — o arquivo principal, que faz os includes;
 *   - os headers que ele inclui, em sub-diretórios quando o caso é sobre
 *     `../` ou include aninhado;
 *   - `RESPOSTA.txt` — o que o caso demonstra, em texto.
 *
 * Os casos são sobre a REGRA que a A1 centralizou: o include é relativo ao
 * ARQUIVO QUE INCLUI. Os 12 são as situações em que essa regra diverge de
 * "relativo ao principal" ou "relativo à raiz".
 *
 * Uso: node tests/tools/gen-fixtures-pp-inc.mjs
 */
import { writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = join(RAIZ, 'tests', 'fixtures', 'pp-inc');

/** Um caso é `{ 'caminho/relativo': 'conteúdo' }` + `main.cpp` + resposta. */
const CASOS = {
  'caso01-simples': {
    espera: { umaVez: ['int soma(int a, int b);'] },
    resposta: 'Include com aspas no mesmo diretorio. O caso mais basico.',
    arquivos: { 'lib.hpp': 'int soma(int a, int b);\n' },
    main: '#include "lib.hpp"\nint f() { return soma(1, 2); }\n',
  },
  'caso02-subdiretorio': {
    espera: { umaVez: ['int dobro(int x);'] },
    resposta: 'Include com `inc/` no mesmo diretorio do principal.',
    arquivos: { 'inc/lib.hpp': 'int dobro(int x);\n' },
    main: '#include "inc/lib.hpp"\nint f() { return dobro(2); }\n',
  },
  'caso03-um-nivel-acima': {
    espera: { umaVez: ['int triplo(int x);'] },
    // O principal fica em `src/` e o header na raiz do caso: `../lib.hpp`
    // de `src/main.cpp` dá `<caso>/lib.hpp`. É o caso real do projeto:
    // `src/examples/mesh3d.cpp` → `src/pixela.hpp`.
    resposta: '`../lib.hpp` a partir de `src/`: precisa do diretorio do INCLUDER,'
      + ' nao o do principal.',
    arqPrincipal: 'src/main.cpp',
    arquivos: { 'lib.hpp': 'int triplo(int x);\n' },
    main: '#include "../lib.hpp"\nint f() { return triplo(2); }\n',
  },
  'caso04-dois-niveis-acima': {
    espera: { umaVez: ['int comum();'] },
    resposta: '`../../comum.hpp` a partir de `src/mod/`: dois `..`.',
    arqPrincipal: 'src/mod/main.cpp',
    arquivos: { 'comum.hpp': 'int comum();\n' },
    main: '#include "../../comum.hpp"\nint f() { return comum(); }\n',
  },
  'caso05-include-aninhado': {
    espera: { umaVez: ['int comum();', 'int usa() { return comum(); }'] },
    resposta: 'lib.hpp inclui common.hpp: o `..` do segundo include e relativo a LIB,'
      + ' nao ao principal.',
    arqPrincipal: 'src/mod/main.cpp',
    arquivos: {
      'src/lib.hpp': '#include "../comum.hpp"\nint usa() { return comum(); }\n',
      'comum.hpp': 'int comum();\n',
    },
    main: '#include "../../src/lib.hpp"\nint f() { return usa(); }\n',
  },
  'caso06-mesmo-nome-em-dois-lugares': {
    espera: { umaVez: ['int MOD = 1;'], nunca: ['MOD = 2'] },
    resposta: 'Dois `util.hpp` em diretorios diferentes; o principal inclui o seu,'
      + ' e nao o outro. Se a resolucao ignorasse o includer, pegaria o errado.',
    arqPrincipal: 'src/mod/main.cpp',
    arquivos: {
      'src/mod/util.hpp': 'int MOD = 1;\n',
      'src/outro/util.hpp': 'int MOD = 2;\n',
    },
    main: '#include "util.hpp"\nint f() { return MOD; }\n',
  },
  'caso07-aspas-vs-ponto-e-virgula': {
    espera: { umaVez: ['int l();', 'int s();'] },
    resposta: 'Include com aspas = relativo ao includer; include com <> = sistema.'
      + ' Os dois convivem no mesmo arquivo.',
    arquivos: {
      'local.hpp': 'int l();\n',
      'inc/sistema.hpp': 'int s();\n',
    },
    main: '#include "local.hpp"\n#include "inc/sistema.hpp"\n'
      + 'int f() { return l() + s(); }\n',
  },
  'caso08-ponto-atual': {
    espera: { umaVez: ['int p();'] },
    resposta: '`./lib.hpp` — o `.` nao muda nada.',
    arquivos: { 'lib.hpp': 'int p();\n' },
    main: '#include "./lib.hpp"\nint f() { return p(); }\n',
  },
  'caso09-cadeia-tres-niveis': {
    espera: { umaVez: ['int zero();', 'int dois();', 'int um();'] },
    resposta: 'Tres includes encadeados, cada um com `..` diferente.',
    arqPrincipal: 'a/b/c/main.cpp',
    arquivos: {
      'a/b/c/um.hpp': '#include "../b.hpp"\nint um();\n',
      'a/b/b.hpp': '#include "../zero.hpp"\nint dois();\n',
      'a/zero.hpp': 'int zero();\n',
    },
    main: '#include "um.hpp"\nint f() { return um(); }\n',
  },
  'caso10-include-repetido': {
    espera: { contagem: { 'int D = 1;': 2 } },
    resposta: 'O mesmo header incluidos duas vezes (sem guarda): o g++ aceita e'
      + ' o texto sai duplicado.',
    arquivos: { 'dup.hpp': 'int D = 1;\n' },
    main: '#include "dup.hpp"\n#include "dup.hpp"\nint f() { return D; }\n',
  },
  'caso11-sobrevivente': {
    espera: { umaVez: ['int o();', 'int d();'] },
    resposta: 'Um `#pragma once` entre includes: tem de sobreviver e nao'
      + ' interromper a resolucao seguinte.',
    arquivos: { 'once.hpp': '#pragma once\nint o();\n', 'depois.hpp': 'int d();\n' },
    main: '#include "once.hpp"\n#include "depois.hpp"\nint f() { return o() + d(); }\n',
  },
  // ---- R3: os 8 casos que a ordem §4/A1 pede e que faltavam ----
  'caso13-duas-grafias-pragma-once': {
    espera: { umaVez: ['int H = 1;'] },
    // O MESMO arquivo por duas grafias, com `#pragma once`: entra UMA vez.
    resposta: 'O MESMO arquivo por duas grafias: `dir1/../h.h` e `h.h` sao o'
      + ' mesmo arquivo no disco, e o `#pragma once` faz o segundo include nao'
      + ' entrar. Se a chave usada for a GRAFIA escrita em vez do caminho'
      + ' canonico, o header entra DUAS vezes e a declaracao duplica.',
    // `dir1/` precisa EXISTIR no disco para o SO conseguir atravessar
    // `dir1/../h.h`: em POSIX, `open("dir1/../h.h")` falha com ENOENT se
    // `dir1` não existir. `dir1/leitor.txt` existe só para manter o
    // diretório no git (o git não guarda diretório vazio).
    arquivos: {
      'h.h': '#pragma once\nint H = 1;\n',
      'dir1/leitor.txt': 'arquivo vazio de guarda: existe so para que `dir1/` exista no disco\n',
    },
    main: '#include "dir1/../h.h"\n#include "h.h"\nint f() { return H; }\n',
  },
  'caso14-ciclo-com-guard': {
    espera: { umaVez: ['int A = 1;', 'int B = 1;'] },
    // a -> b -> a, mas b tem guard: SEM erro, e cada arquivo entra 1x.
    resposta: 'Ciclo COM include guard: nao e erro, porque o guard segura a'
      + ' segunda entrada. O erro de ciclo so aparece quando o guard nao segura.',
    arquivos: {
      'a.h': '#ifndef A_H\n#define A_H\n#include "b.h"\nint A = 1;\n#endif\n',
      'b.h': '#ifndef B_H\n#define B_H\n#include "a.h"\nint B = 1;\n#endif\n',
    },
    main: '#include "a.h"\nint f() { return A + B; }\n',
  },
  'caso15-ciclo-sem-guard': {
    espera: { erroObrigatorio: 'incluído de .*:\\d+' },
    // a -> b -> a sem guard: ERRO, com a cadeia "incluido de X".
    resposta: 'Ciclo SEM guard: erro, e a mensagem tem de trazer a cadeia'
      + ' (a.h -> b.h -> a.h) para que se veja onde o ciclo fecha.',
    esperaErro: true,
    arquivos: {
      'a.h': '#include "b.h"\nint A = 1;\n',
      'b.h': '#include "a.h"\nint B = 1;\n',
    },
    main: '#include "a.h"\nint f() { return A; }\n',
  },
  'caso16-header-ausente': {
    espera: { erroObrigatorio: 'incluído de .*:\\d+.*procurado em' },
    resposta: 'Header ausente: erro com a cadeia — QUEM incluiu, e em que'
      + ' linha — e a lista do que estava disponível.',
    esperaErro: true,
    arquivos: { 'existe.h': 'int E = 1;\n' },
    main: '#include "existe.h"\n#include "nao_existe.h"\nint f() { return E; }\n',
  },
  'caso17-include-macro': {
    espera: { umaVez: ['int ALVO = 1;'], nunca: ['OUTRO'] },
    resposta: '`#include MACRO_ARQUIVO`: o nome do header vem de uma macro,'
      + ' não do fonte.',
    arquivos: {
      'alvo.hpp': 'int ALVO = 1;\n',
      'outro.hpp': 'int OUTRO = 1;\n',
    },
    main: '#define MACRO_ARQUIVO "alvo.hpp"\n#include MACRO_ARQUIVO\nint f() { return ALVO; }\n',
  },
  'caso18-has-include': {
    espera: { umaVez: ['int P = 1;'] },
    resposta: '`__has_include(x)`: 1 se resolve, 0 se não. É o que permite'
      + ' guarded include com fallback.',
    arquivos: { 'presente.hpp': 'int P = 1;\n' },
    main: '#if __has_include("presente.hpp")\n'
      + '#include "presente.hpp"\n'
      + '#define TEM 1\n'
      + '#else\n#define TEM 0\n#endif\n'
      + 'int f() { return TEM; }\n',
  },
  'caso19-include-dentro-de-if-zero': {
    espera: { umaVez: ['int f() { return 0; }'], nunca: ['nao_existe_mas_nao_importa'] },
    resposta: 'Include dentro de `#if 0`: NÃO resolve — o bloco nunca é'
      + ' processado, e o header ausente não gera erro.',
    arquivos: {},
    main: '#if 0\n#include "nao_existe_mas_nao_importa.h"\n#endif\nint f() { return 0; }\n',
  },
  'caso20-cadeia-real-do-projeto': {
    espera: { umaVez: ['struct Color { int r, g, b; };', 'inline void limpar() {}'], nunca: ['DECOY'] },
    // O caso real: demo.cpp -> ../pixela_wasm_bridge.hpp -> pixela.hpp
    resposta: 'A cadeia REAL do projeto: demo.cpp inclui'
      + ' `../pixela_wasm_bridge.hpp`, e o bridge inclui `motor.hpp` —'
      + ' que tem de resolver para o CABECALHO AO LADO DO BRIDGE (src/), não'
      + ' para o diretório do arquivo principal (src/examples/). O decoy em'
      + ' src/outro/motor.hpp prova que o lugar errado existe e não é escolhido.'
      + ' (O nome nao e pixela.hpp de proposito: esse e um header VIRTUAL e'
      + ' a ordem manda que o virtual preceda o mapa.)',
    arqPrincipal: 'src/examples/demo.cpp',
    arquivos: {
      'src/examples/demo.cpp': '#include "../pixela_wasm_bridge.hpp"\nPIXELA_WASM_MAIN(demo_frame)\n',
      'src/pixela_wasm_bridge.hpp': '#pragma once\n#include "motor.hpp"\n'
        + '#define PIXELA_EXPORT extern "C"\n'
        + '#define PIXELA_WASM_MAIN(F) PIXELA_EXPORT void run() { F(); }\n',
      'src/motor.hpp': '#pragma once\nnamespace pix {\n'
        + 'struct Color { int r, g, b; };\ninline void limpar() {}\n}\n',
      'src/outro/motor.hpp': '// DECOY: um motor.hpp no lugar errado\nint DECOY = 1;\n',
    },
  },
  'caso23-ciclo-com-grafia-diferente': {
    // `a.h` se inclui por uma GRAFIA diferente (`dir/../a.h`) e SEM guard.
    // O que fecha o ciclo e o ARQUIVO, nao a grafia escrita: o resultado tem
    // de ser o diagnóstico de ciclo, com a cadeia. No preprocessor pre-A1 a
    // deteccao comparava a GRAFIA com a PILHA de caminhos canonicos, nunca
    // casavam, e o unico limite era a profundidade 200 — este caso e o que
    // prova que a comparacao e pelo caminho canonico.
    resposta: 'Ciclo SEM guard e com GRAFIA diferente: o diagnóstico tem de ser'
      + ' de CICULO (com a cadeia), nao de profundidade. No preprocessor'
      + ' pre-A1 a comparacao era entre a grafia escrita e a pilha de'
      + ' caminhos, nunca casava, e o caso terminava em "Profundidade de'
      + ' include excedida (200)".',
    esperaErro: true,
    arquivos: {
      'a.h': '#include "dir/../a.h"\nint A = 1;\n',
      'dir/leitor.txt': 'existe so para que `dir/` exista no disco\n',
    },
    main: '#include "a.h"\nint f() { return A; }\n',
    espera: { erroObrigatorio: 'circular.*incluído de .*:\\d+', nunca: ['Profundidade'] },
  },
  'caso21-limite-de-profundidade': {
    espera: { erroObrigatorio: 'excedida \\(200\\)', umaVez: ['int P199 = 199;', 'int P0 = 0;'] },
    // Cadeia de 205 includes: passa do limite de 200 do pré-processador. O
    // limite existe porque um include circular SEM guard é infinito — o teto
    // é a rede de segurança, e precisa ser um NÚMERO que se possa testar.
    resposta: 'Limite de profundidade: uma cadeia de 205 includes tem de ser'
      + ' recusada com "Profundidade de include excedida (200)". O g++ tem o'
      + ' mesmo limite (-fmax-... / o guardião de include) e também recusa.',
    esperaErro: true,
    // a cadeia é montada pelo gerador; ver `montarCadeiaProfunda`
    main: '#include "p000.h"\nint f() { return P0; }\n',
  },
  'caso22-cadeia-real-pixela-nome': {
    // Mesma cadeia do caso20, com o include do bridge escrito na GRAVIA
    // CANONICA (`src/pixela.hpp`, a partir da raiz) em vez do relativo. As
    // duas grafias têm de reconhecer o MESMO arquivo: o `#pragma once` do
    // header segura a segunda entrada e a classe `Canvas` aparece 1 vez.
    //
    // O bridge esta na RAIZ do fixture (e nao em `src/`) de proposito: a
    // grafia `src/pixela.hpp` so resolve se o includer estiver na raiz. E o
    // que prova que a comparacao e pelo caminho canonico, nao pela grafia.
    //
    // Até o R6 este caso era um DESVIO declarado: `pixela.hpp` era header
    // VIRTUAL (P10) e precedia o mapa, então o que entrava era o stub
    // `int pix_width()` e nunca a classe real. O R6 removeu o virtual
    // `pixela.hpp` (o virtual da API livre é `pixela.h`) e colocou o virtual
    // por último na ordem de busca; o caso voltou a bater com o `g++` e o
    // `DESVIO.txt` foi apagado.
    resposta: 'A mesma cadeia, com o include escrito na grafia canonica'
      + ' `src/pixela.hpp` em vez do relativo. Tem de reconhecer o MESMO'
      + ' arquivo: `Canvas` entra 1 vez e o decoy nunca entra.',
    arquivos: {
      'main.cpp': '#include "pixela_wasm_bridge.hpp"\nPIXELA_WASM_MAIN(demo_frame)\nvoid demo_frame() {}\n',
      'pixela_wasm_bridge.hpp': '#pragma once\n#include "src/pixela.hpp"\n'
        + '#define PIXELA_EXPORT extern "C"\n'
        + '#define PIXELA_WASM_MAIN(F) PIXELA_EXPORT void run() { F(); }\n',
      'src/pixela.hpp': '#pragma once\nnamespace pix {\n'
        + 'struct Color { int r, g, b; };\nclass Canvas { public: void clear(); };\ninline void limpar() {}\n}\n',
      'src/outro/pixela.hpp': '#pragma once\n// DECOY: um pixela.hpp no lugar errado\nnamespace pix { struct Color { int DECOY; }; }\n',
    },
    espera: {
      umaVez: ['class Canvas { public: void clear(); };'],
      nunca: ['DECOY'],
    },
  },
  'caso12-demonstracao': {
    espera: { umaVez: ['inline void clearScreen() {}'] },
    resposta: 'Inclui um header real do projeto a partir de `examples/`,'
      + ' reproduzindo `src/examples/mesh3d.cpp`.',
    demo: true,
    arqPrincipal: 'src/examples/mesh3d.cpp',
    arquivos: {
      'src/examples/mesh3d.cpp': '#include "../pixela.hpp"\n#include "../pixela_wasm_bridge.hpp"\nPIXELA_WASM_MAIN(frame)\n',
      'src/pixela.hpp': 'namespace pix {\ninline void clearScreen() {}\n}\n',
      'src/pixela_wasm_bridge.hpp': '#define PIXELA_EXPORT extern "C"\n#define PIXELA_WASM_MAIN(F) PIXELA_EXPORT void f() { F(); }\n',
    },
  },
};

function escreve(caminhoRel, texto) {
  const p = join(BASE, caminhoRel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, texto.endsWith('\n') ? texto : `${texto}\n`);
}

if (existsSync(BASE)) rmSync(BASE, { recursive: true, force: true });
mkdirSync(BASE, { recursive: true });

let n = 0;
for (const [nome, caso] of Object.entries(CASOS)) {
  const dir = join(BASE, nome);
  mkdirSync(dir, { recursive: true });

  // `RESPOSTA.txt` documenta o que o caso prova, e um `esperaErro.txt`
  // marca os casos cujo resultado é ERRO por desenho.
  writeFileSync(join(dir, 'RESPOSTA.txt'), `${caso.resposta}\n`);
  // A cadeia de 205 headers é montada aqui: escrever 205 arquivos no
  // literal do CASOS tornaria o gerador ilegível, e o número 205 tem de
  // ficar visível como o que ultrapassa o 200.
  if (nome === 'caso21-limite-de-profundidade') {
    const N = 205;
    for (let k = 0; k < N; k++) {
      const prox = k + 1 < N ? `#include "p${String(k + 1).padStart(3, '0')}.h"\n` : '';
      writeFileSync(join(dir, `p${String(k).padStart(3, '0')}.h`), `${prox}int P${k} = ${k};\n`);
    }
  }
  if (caso.esperaErro) writeFileSync(join(dir, 'esperaErro.txt'), 'erro por desenho\n');
  // `ESPERA.json` e o CONTRATO do caso: o que a saida pre-processada tem de
  // conter (e quantas vezes). Sem ele o teste so verificava "nao ha erro" e
  // um header que entra DUAS vezes passava — que foi exatamente o que o
  // caso13 fez contra o preprocessor antigo.
  if (caso.espera) {
    writeFileSync(join(dir, 'ESPERA.json'), `${JSON.stringify(caso.espera, null, 2)}\n`);
  }
  // `DESVIO.txt` marca o caso em que a diferença com o g++ é INTENCIONAL e
  // está documentada. Sem ele, o diferencial contaria o caso como divergência.
  if (caso.desvio) writeFileSync(join(dir, 'DESVIO.txt'), `${caso.desvio}\n`);

  const principal = caso.arqPrincipal ?? 'main.cpp';
  for (const [rel, conteudo] of Object.entries(caso.arquivos ?? {})) {
    escreve(`${nome}/${rel}`, conteudo);
  }
  if (caso.main) escreve(`${nome}/${principal}`, caso.main);
  n++;
}

console.log(`[gen-fixtures-pp-inc] ${n} casos em tests/fixtures/pp-inc/`);
for (const nome of Object.keys(CASOS)) {
  const d = join(BASE, nome);
  const arqs = [];
  const anda = (x, p = '') => {
    for (const e of (readdirSyncSafe(x))) {
      const f = `${p}${e}`;
      if (e.includes('.')) arqs.push(f);
      else anda(`${x}/${e}`, `${f}/`);
    }
  };
  anda(d);
  console.log(`  ${nome}: ${arqs.join(', ')}`);
}

function readdirSyncSafe(d) {
  return readdirSync(d);
}