/**
 * tests/unit/roundtrip-projeto.test.js — round-trip nos arquivos do projeto.
 *
 * Cada arquivo real do repositório passa por
 *   lex → parse → unparse → parse
 * e as duas ASTs precisam ser idênticas. Isto é o teste que pega perda de
 * informação no unparse: um campo que o `Declarator` guarda mas o `unparse`
 * não imprime aparece aqui como diferença na segunda passada.
 *
 * Só contam os arquivos que o parser aceita sem diagnóstico de ERRO.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lexer } from '../../js/cpp/lexer.js';
import { Preprocessor } from '../../js/cpp/preprocessor.js';
import { Parser } from '../../js/cpp/parser.js';
import { unparse, walk } from '../../js/cpp/ast.js';
import { mapaIncludes } from '../tools/fs-loader.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Arquivos C++ do PROJETO — o código que o compilador vai de fato consumir.
 *
 * `tests/fixtures/pp/` fica de fora de propósito: são entradas do
 * pré-processador, cheadas de `#define` propositalmente quebrados, e não
 * código que o parser deva aceitar. `tests/fixtures/examples/` ENTRA: são
 * os exemplos reais que o app executa.
 */
const DIRETORIOS_PROJETO = ['src', 'tests/fixtures/examples'];
const Ignorar = new Set(['node_modules', '.git', 'reports']);

function arquivosCPlusPlus() {
  const achados = [];
  const andar = (dir) => {
    if (!existsSync(dir)) return;
    for (const nome of readdirSync(dir)) {
      if (Ignorar.has(nome)) continue;
      const p = join(dir, nome);
      const st = statSync(p);
      if (st.isDirectory()) { andar(p); continue; }
      if (/\.(cpp|hpp|h|cc|cxx)$/.test(nome)) achados.push(p);
    }
  };
  for (const d of DIRETORIOS_PROJETO) andar(join(RAIZ, d));
  return achados.sort();
}

const ARQUIVOS = arquivosCPlusPlus();

/**
 * Cadeia completa: pré-processador → lexer → parser.
 *
 * O pré-processador vem PRIMEIRO de propósito: `#include`, `#define` e
 * `#if` são pré-processamento, e o parser nunca deve ver uma diretiva.
 * Passar o fonte cru ao lexer dá `Caractere inválido: "#"` em todos os
 * arquivos reais do projeto — não é bug do parser, é falta de etapa.
 */
function analisar(src, nome) {
  // P7/A1: o mapa de includes é montado pelo MESMO cálculo de caminho que o
  // pré-processador usa (`resolveInclude` em preprocessor.js), para que
  // `../pixela.hpp` dentro de `src/examples/mesh3d.cpp` resolva. Sem isto os
  // 3 arquivos com include relativo davam `Header não encontrado` e eram
  // PULADOS em silêncio — que é exatamente o que P7 proíbe.
  const pp = new Preprocessor({ includes: mapaIncludes(nome) }).process(src, nome);
  const lex = new Lexer(pp.text, nome).tokenize();
  const parse = new Parser(lex.tokens, { file: nome }).parse();
  return {
    lex,
    parse,
    pp,
    diagnostics: [...(pp.diagnostics ?? []), ...lex.diagnostics, ...parse.diagnostics],
  };
}

/** AST sem loc: a forma, sem a posição. */
function forma(no) {
  if (no === null || typeof no !== 'object') return no;
  if (Array.isArray(no)) return no.map(forma);
  const out = {};
  for (const k of Object.keys(no).sort()) {
    if (k === 'loc' || k === 'locEnd') continue;
    out[k] = forma(no[k]);
  }
  return out;
}

test(`existe pelo menos 10 arquivo C++ no projeto (achei ${ARQUIVOS.length})`, () => {
  assert.ok(ARQUIVOS.length >= 10,
    `só ${ARQUIVOS.length} arquivos .cpp/.hpp em ${RAIZ}`);
});

test('todo arquivo do projeto faz round-trip: parse → unparse → parse', () => {
  const falhas = [];
  let ok = 0;
  let comErro = 0;

  for (const caminho of ARQUIVOS) {
    const nome = relative(RAIZ, caminho);
    const src = readFileSync(caminho, 'utf8');
    const r1 = analisar(src, nome);
    // P7: arquivo do projeto com diagnóstico é FALHA, não `continue`.
    // Antes deste patch o teste contava `comErro++` e seguia, e um arquivo
    // que deixasse de parsear simply parava de ser exercitado — sem que
    // nada disso aparecesse no resultado.
    if (r1.diagnostics.length > 0) {
      comErro++;
      falhas.push(`${nome}: ${r1.diagnostics.length} diagnóstico(s) no projeto\n  ` +
        r1.diagnostics.slice(0, 3)
          .map((d) => `${d.code} ${d.loc.line}:${d.loc.column} ${d.message}`).join('\n  '));
      continue;
    }
    // A propriedade é `parse(tokens do preprocessor) -> unparse -> parse` e as
    // duas ASTs (ignorando `loc`) precisam ser iguais.
    //
    // O commit c9ebf3d trocou `unparse(r1.parse.ast)` por `r1.pp.text`, o que
    // FAZIA O TESTE NÃO TESTAR NADA: reparseava a entrada, não a saída do
    // unparse, e qualquer bug de perda de informação passava. Revertido.
    const texto = unparse(r1.parse.ast);
    const r2 = analisar(texto, nome);
    if (r2.diagnostics.length > 0) {
      falhas.push(`${nome}: o unparse produziu algo que não reparseia\n  ` +
        r2.diagnostics.slice(0, 3).map((d) => `${d.code} ${d.message}`).join('\n  '));
      continue;
    }
    const a = JSON.stringify(forma(r1.parse.ast));
    const b = JSON.stringify(forma(r2.parse.ast));
    if (a !== b) {
      const na = forma(r1.parse.ast);
      const nb = forma(r2.parse.ast);
      const dif = primeiraDiferenca(na, nb);
      falhas.push(`${nome}: AST muda na 2ª passada\n  ${dif}`);
      continue;
    }
    ok++;
  }

  console.log(`      round-trip do projeto: ${ok} ok, ${comErro} com erro, ${ARQUIVOS.length} total`);
  assert.deepEqual(falhas.slice(0, 10), [],
    `round-trip quebrado em ${falhas.length} arquivos:\n${falhas.slice(0, 10).join('\n')}`);
  assert.ok(ok >= 5, `só ${ok} arquivos OK — o teste não está exercitando nada`);
});

/** Primeira diferença entre duas árvores, para o diff dizer ONDE. */
function primeiraDiferenca(a, b, caminho = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return '(nenhuma)';
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return `${caminho || '(raiz)'}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${caminho}: tipo diferente`;
  if (Array.isArray(a)) {
    if (a.length !== b.length) {
      return `${caminho}: ${a.length} filhos vs ${b.length}`;
    }
    for (let i = 0; i < a.length; i++) {
      const d = primeiraDiferenca(a[i], b[i], `${caminho}[${i}]`);
      if (d !== '(nenhuma)') return d;
    }
    return '(nenhuma)';
  }
  const chaves = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const k of chaves) {
    const d = primeiraDiferenca(a[k], b[k], `${caminho}.${k}`);
    if (d !== '(nenhuma)') return d;
  }
  return '(nenhuma)';
}

test('a AST não guarda nada além de dados primitivos (serializável e sem ciclo)', () => {
  for (const caminho of ARQUIVOS.slice(0, 12)) {
    const nome = relative(RAIZ, caminho);
    const { parse } = analisar(readFileSync(caminho, 'utf8'), nome);
    // P7: antes isto era um `continue` silencioso — o arquivo deixava de ser
    // verificado e o teste continuava verde. Agora é falha explícita.
    assert.equal(parse.diagnostics.length, 0,
      `${nome}: ${parse.diagnostics.length} diagnóstico(s)\n  ` +
      parse.diagnostics.slice(0, 3)
        .map((d) => `${d.code} ${d.loc.line}:${d.loc.column} ${d.message}`).join('\n  '));
    let erro = null;
    try {
      JSON.stringify(parse.ast);
    } catch (e) {
      erro = e.message;
    }
    assert.equal(erro, null, `${nome}: AST não serializa — ${erro}`);
  }
});

test('toda declaração do projeto tem loc com linha e coluna', () => {
  for (const caminho of ARQUIVOS.slice(0, 12)) {
    const nome = relative(RAIZ, caminho);
    const { parse } = analisar(readFileSync(caminho, 'utf8'), nome);
    // P7: antes isto era um `continue` silencioso — o arquivo deixava de ser
    // verificado e o teste continuava verde. Agora é falha explícita.
    assert.equal(parse.diagnostics.length, 0,
      `${nome}: ${parse.diagnostics.length} diagnóstico(s)\n  ` +
      parse.diagnostics.slice(0, 3)
        .map((d) => `${d.code} ${d.loc.line}:${d.loc.column} ${d.message}`).join('\n  '));
    const ruins = [];
    walk(parse.ast, (n) => {
      const l = n.loc;
      if (!l || typeof l.line !== 'number' || typeof l.column !== 'number') {
        ruins.push(n.kind);
      }
      return true;
    });
    assert.deepEqual([...new Set(ruins)], [], `${nome}: nós sem loc`);
  }
});