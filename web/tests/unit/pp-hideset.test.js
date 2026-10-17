/**
 * tests/unit/pp-hideset.test.js — o hide-set (blue paint) do pré-processador.
 *
 * R7 foi marcado como fechado com a afirmação "o mutante de remover o hide-set
 * não é acusado pelo diff-pp". Isso era FALSO: o diff-pp não tinha nenhum
 * fixture de recursão de macro, então não tinha o que acusar. Agora tem
 * (`tests/fixtures/pp/hs*.cpp`), e o mutante é acusado.
 *
 * Este arquivo fecha o outro lado: cobre os mesmos casos em `npm test`, para
 * que uma regressão apareça sem depender de rodar a ferramenta.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Preprocessor } from '../../js/cpp/preprocessor.js';

/** Texto pré-processado, sem comentários nem diretivas. */
const pp = (src) => new Preprocessor({ predefined: { __PIXELA_JS__: '1', __wasm32__: '1' } })
  .process(src, 't.cpp').text.replace(/\s+/g, ' ').trim();

test('S3: #define A A expande UMA vez (hide-set impede o laco)', () => {
  assert.equal(pp('#define A A\nA\n'), 'A');
});

test('S3: #define A A em declaracao nao reexpande', () => {
  assert.equal(pp('#define A A\nint x = A;\n'), 'int x = A;');
});

test('S3: #define f(x) f(x+1) — o f interno nao reexpande', () => {
  // A saida por token e `f ( 1 + 1 )`; o espaco antes de `1` vem do fato de o
  // argumento ser colado no lugar do parametro. O que importa e que o `f`
  // DENTRO do corpo nao reexpande — se reexpandisse, teriamos `f(f(1+1+1))`.
  assert.equal(pp('#define f(x) f(x + 1)\nf(1)\n'), 'f( 1+1)');
});

test('S3: recursao mutua X/Y devolve X (o hide-set impede a volta)', () => {
  // Ao expandir X, o hide-set ganha X; o corpo de X e Y; o corpo de Y e X, que
  // JA esta no hide-set. Resultado: X. (Confirmado com g++ -E -P.)
  assert.equal(pp('#define X Y\n#define Y X\nX\n'), 'X');
});

test('S3: recursao mutua de 3 devolve A', () => {
  assert.equal(pp('#define A B\n#define B C\n#define C A\nA\n'), 'A');
});

test('S3: hide-set nao atravessa o fim da expansao interna', () => {
  assert.equal(pp('#define A B\n#define B A\nA\n'), 'A');
});

test('S3: ## forma um token novo que reexpande como macro', () => {
  // CAT(fo, o) -> `foo`, que no rescan vira 42.
  assert.equal(pp('#define foo 42\n#define J(a, b) a ## b\nJ(fo, o)\n'), '42');
});

test('S3: ## sem macro para o token formado', () => {
  assert.equal(pp('#define CAT(a, b) a ## b\nCAT(fo, o)\n'), 'foo');
});

test('S3: # (stringify) colapsa espacos internos para um espaco simples', () => {
  assert.equal(pp('#define S(x) #x\nS(  a   +   b  )\n'), '"a + b"');
});

test('S3: macro de funcao sem parenteses nao e chamada', () => {
  assert.equal(pp('#define g(x) (x)\ng\n'), 'g');
});

test('S3: defined(X) verdadeiro/falso no #if', () => {
  assert.equal(pp('#define X 1\n#if defined(X)\nint y = 1;\n#else\nint y = 2;\n#endif\n'),
    'int y = 1;');
  assert.equal(pp('#if defined(NAO_EXISTE)\nint z = 1;\n#else\nint z = 2;\n#endif\n'),
    'int z = 2;');
});

test('S3: defined sem parenteses tambem funciona', () => {
  assert.equal(pp('#define X 1\n#if defined X\nint y = 1;\n#else\nint y = 2;\n#endif\n'),
    'int y = 1;');
});

test('S3: macro definida dentro de #if existe depois do #endif', () => {
  assert.equal(pp('#if 1\n#define X 7\n#endif\nX\n'), '7');
});

test('S3: argumento com o nome da propria macro — bug CONHECIDO (hs06)', () => {
  // g++ -E -P produz `1`: o argumento e PRE-EXPANDIDO antes da substituicao
  // (regra do C++). Nos produzimos `F(1)`: a substituicao e C-style, sem
  // pre-expansao do argumento.
  // Este teste fixa o COMPORTAMENTO ATUAL para que a correcao nao quebre
  // nada, e marca a divergencia. Classificacao: bug do preprocessor, dono A2.
  const nosso = pp('#define F(x) x\nF(F(1))\n');
  const gpp = execFileSync('g++', ['-E', '-P', '-nostdinc', '-x', 'c++', '-'],
    { input: '#define F(x) x\nF(F(1))\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    .replace(/\s+/g, ' ').trim();
  assert.equal(gpp, '1', 'o g++ pre-expande o argumento');
  assert.equal(nosso, 'F(1)', 'nosso comportamento ATUAL (divergente do g++)');
});