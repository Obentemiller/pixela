/**
 * tests/unit/diagnostics-snapshot.test.js — snapshots de >= 15 diagnósticos.
 *
 * Cada diagnóstico é renderizado com code frame e comparado com um snapshot
 * textual. Se a mensagem ou a posição mudar, o snapshot quebra — que é
 * exatamente o objetivo: mudanças de mensagem são visíveis.
 *
 * Para regenerar: node tests/tools/gen-snapshots.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Diagnostic, ErrorCodes, Diagnostics, formatDiagnostic } from '../../js/cpp/diagnostics.js';
import { Lexer } from '../../js/cpp/lexer.js';
import { SourceFile } from '../../js/cpp/source.js';

const SNAP = readFileSync(new URL('./snapshots/diagnostics.snap.txt', import.meta.url), 'utf8');

/** Renderiza um diagnóstico no formato do snapshot. */
function render(diag, fonte, arquivo = 'main.cpp') {
  const sf = new SourceFile(fonte, arquivo);
  const linha = sf.getLine(diag.loc.line).split('\r')[0];
  const coluna = Math.max(0, diag.loc.column - 1);
  return [
    `${arquivo}:${diag.loc.line}:${diag.loc.column}: ${diag.severity} ${diag.code}: ${diag.message}`,
    `     ${diag.loc.line} | ${linha.replaceAll('\t', '    ')}`,
    `       | ${linha.slice(0, coluna).replaceAll('\t', '    ')}^`,
  ].join('\n');
}

/** Casos que devem ser lexados em modo preprocess. */
const PREPROCESS = new Set(['# sem nome', 'header não terminado']);

/** Gera um caso: lexa `fonte` e formata o n-ésimo diagnóstico. */
function caso(nome, fonte, indice = 0, arquivo = 'main.cpp') {
  const modo = PREPROCESS.has(nome) ? 'preprocess' : 'normal';
  const { diagnostics } = new Lexer(fonte, arquivo).tokenize({ mode: modo });
  const d = diagnostics[indice];
  return { nome, fonte, arquivo, diag: d };
}

const CASOS = [
  caso('caractere inválido @', 'int x = 1;\nint y = @;\n', 0),
  caso('caractere inválido $', 'int a = $;\n', 0),
  caso('crase', 'int a = `x`;\n', 0),
  caso('string não terminada', 'const char* s = "abc;\nint y;\n', 0),
  caso('comentário de bloco não fechado', 'int a;\n/* nunca fecha\nint b;\n', 0),
  caso('char não terminado', 'char c = \'a;\nint y;\n', 0),
  caso('char vazio', 'char c = \'\';\n', 0),
  caso('escape desconhecido', 'const char* s = "\\q";\n', 0),
  caso('\\x sem hex', 'const char* s = "\\xZZ";\n', 0),
  caso('\\u com hex curto', 'const char* s = "\\u12";\n', 0),
  caso('hex sem dígitos', 'int x = 0x;\n', 0),
  caso('dígito inválido em binário', 'int x = 0b102;\n', 0),
  caso('dígito inválido em octal', 'int x = 08;\n', 0),
  caso('separador de dígito isolado', "int x = 1';\n", 0),
  caso('prefixo de string não suportado', 'const char* s = L"abc";\n', 0),
  caso('hex-float não suportado', 'double d = 0x1p3;\n', 0),
  caso('raw string não terminada', 'const char* s = R"(abc\n', 0),
  caso('# sem nome', '#\nint x;\n', 0, 'pp.cpp'),
  caso('header não terminado', '#include <vector\nint x;\n', 0, 'pp.cpp'),
];

test('diagnósticos: >= 15 casos com snapshot', () => {
  assert.ok(CASOS.length >= 15, `só ${CASOS.length} casos, exigido >= 15`);
});

test('diagnósticos: snapshot casa exatamente', () => {
  // O snapshot tem um cabeçalho "# nome" por bloco, gerado por
  // tests/tools/gen-snapshots.mjs. O teste compara só o corpo.
  const blocos = SNAP.split('\n---\n').map((b) => b.trim()).filter(Boolean);
  assert.equal(blocos.length, CASOS.length,
    `snapshot tem ${blocos.length} blocos, há ${CASOS.length} casos`);

  for (let i = 0; i < CASOS.length; i++) {
    const c = CASOS[i];
    assert.ok(c.diag, `${c.nome}: lexer não produziu diagnóstico`);
    const esperado = blocos[i].split('\n').slice(1).join('\n').trim();
    const obtido = render(c.diag, c.fonte, c.arquivo).trim();
    assert.equal(obtido, esperado,
      `\n[${c.nome}]\n--- esperado ---\n${esperado}\n--- obtido ---\n${obtido}`);
  }
});

test('diagnósticos: cada caso tem severidade, código e loc válidos', () => {
  for (const c of CASOS) {
    assert.ok(c.diag, c.nome);
    assert.ok(['error', 'warning', 'note'].includes(c.diag.severity), `${c.nome}: severidade ${c.diag.severity}`);
    assert.match(c.diag.code, /^[A-Z][0-9]+$/, `${c.nome}: código ${c.diag.code}`);
    assert.ok(c.diag.loc.line >= 1, `${c.nome}: linha ${c.diag.loc.line}`);
    assert.ok(c.diag.loc.column >= 1, `${c.nome}: coluna ${c.diag.loc.column}`);
  }
});

test('diagnostics: formatDiagnostic produz código frame com arquivo:linha:coluna', () => {
  const sf = new SourceFile('int a;\nint b;\nint cde;\n', 'main.cpp');
  const d = new Diagnostic('error', 'E0100', 'Mensagem de teste', { line: 3, column: 5 });
  const txt = formatDiagnostic(d, sf);

  assert.match(txt, /main\.cpp:3:5/, `faltou arquivo:linha:coluna em:\n${txt}`);
  assert.match(txt, /E0100/);
  assert.match(txt, /Mensagem de teste/);
  assert.match(txt, /3 \| int cde;/, `faltou a linha do código:\n${txt}`);
  assert.match(txt, /\^/, `faltou o cursor:\n${txt}`);
});

test('diagnostics: formatDiagnostic inclui as notas', () => {
  const sf = new SourceFile('int x;\n', 'main.cpp');
  const d = new Diagnostic('error', 'E0201', "identificador 'pix_cirle' não declarado",
    { line: 1, column: 5 }, ["você quis dizer 'pix_circle'?"]);
  const txt = formatDiagnostic(d, sf);
  assert.match(txt, /pix_cirle/);
  assert.match(txt, /nota:.*pix_circle/);
});

test('diagnostics: formatDiagnostic expande tab no code frame', () => {
  const sf = new SourceFile('\tint x = 1;\n', 'main.cpp');
  const d = new Diagnostic('error', 'E0100', 'x', { line: 1, column: 6 });
  const txt = formatDiagnostic(d, sf);
  assert.doesNotMatch(txt, /\t/, 'o code frame não deve conter tab cru');
});

test('diagnostics: Diagnostics.unexpectedToken gera código e mensagem corretos', () => {
  const d = Diagnostics.unexpectedToken('int ;', { line: 1, column: 5 }, ';', 'identificador');
  assert.equal(d.severity, 'error');
  assert.match(d.message, /Token inesperado ';'/, d.message);
  assert.match(d.message, /identificador/, d.message);
});

test('diagnostics: ErrorCodes cobrem os casos do lexer', () => {
  assert.ok(Object.keys(ErrorCodes).length >= 15,
    `só ${Object.keys(ErrorCodes).length} códigos, esperado >= 15`);
  for (const [nome, codigo] of Object.entries(ErrorCodes)) {
    assert.equal(codigo.trim(), codigo, `${nome}: código com espaço`);
    assert.match(codigo, /^[A-Z][0-9]+$/, `${nome}: formato ${codigo}`);
  }
});