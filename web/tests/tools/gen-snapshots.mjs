#!/usr/bin/env node
/**
 * gen-snapshots.mjs — gera tests/unit/snapshots/diagnostics.snap.txt
 * a partir dos casos definidos em diagnostics-snapshot.test.js.
 *
 * Uso: node tests/tools/gen-snapshots.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lexer } from '../../js/cpp/lexer.js';
import { SourceFile } from '../../js/cpp/source.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const CASOS = [
  ['caractere inválido @', 'int x = 1;\nint y = @;\n', 0, 'main.cpp'],
  ['caractere inválido $', 'int a = $;\n', 0, 'main.cpp'],
  ['crase', 'int a = `x`;\n', 0, 'main.cpp'],
  ['string não terminada', 'const char* s = "abc;\nint y;\n', 0, 'main.cpp'],
  ['comentário de bloco não fechado', 'int a;\n/* nunca fecha\nint b;\n', 0, 'main.cpp'],
  ['char não terminatedo', 'char c = \'a;\nint y;\n', 0, 'main.cpp'],
  ['char vazio', 'char c = \'\';\n', 0, 'main.cpp'],
  ['escape desconhecido', 'const char* s = "\\q";\n', 0, 'main.cpp'],
  ['\\x sem hex', 'const char* s = "\\xZZ";\n', 0, 'main.cpp'],
  ['\\u com hex curto', 'const char* s = "\\u12";\n', 0, 'main.cpp'],
  ['hex sem dígitos', 'int x = 0x;\n', 0, 'main.cpp'],
  ['dígito inválido em binário', 'int x = 0b102;\n', 0, 'main.cpp'],
  ['dígito inválido em octal', 'int x = 08;\n', 0, 'main.cpp'],
  ['separador de dígito isolado', "int x = 1';\n", 0, 'main.cpp'],
  ['prefixo de string não suportado', 'const char* s = L"abc";\n', 0, 'main.cpp'],
  ['hex-float não suportado', 'double d = 0x1p3;\n', 0, 'main.cpp'],
  ['raw string não terminada', 'const char* s = R"(abc\n', 0, 'main.cpp'],
  ['# sem nome', '#\nint x;\n', 0, 'pp.cpp'],
  ['header não terminado', '#include <vector\nint x;\n', 0, 'pp.cpp'],
];

const PREPROCESS = new Set(['# sem nome', 'header não terminado']);

function render(diag, fonte, arquivo) {
  const sf = new SourceFile(fonte, arquivo);
  const linha = sf.getLine(diag.loc.line).split('\r')[0];
  const coluna = Math.max(0, diag.loc.column - 1);
  return [
    `${arquivo}:${diag.loc.line}:${diag.loc.column}: ${diag.severity} ${diag.code}: ${diag.message}`,
    `     ${diag.loc.line} | ${linha.replaceAll('\t', '    ')}`,
    `       | ${linha.slice(0, coluna).replaceAll('\t', '    ')}^`,
  ].join('\n');
}

const blocos = [];
for (const [nome, fonte, indice, arquivo] of CASOS) {
  const modo = PREPROCESS.has(nome) ? 'preprocess' : 'normal';
  const { diagnostics } = new Lexer(fonte, arquivo).tokenize({ mode: modo });
  const d = diagnostics[indice];
  if (!d) { console.error(`AVISO: ${nome} não produziu diagnóstico`); continue; }
  blocos.push(`# ${nome}\n` + render(d, fonte, arquivo));
}

const destino = join(RAIZ, 'tests', 'unit', 'snapshots', 'diagnostics.snap.txt');
mkdirSync(dirname(destino), { recursive: true });
writeFileSync(destino, blocos.join('\n---\n') + '\n');
console.log(`[gen-snapshots] ${blocos.length} diagnósticos -> ${destino.replace(RAIZ + '/', '')}`);