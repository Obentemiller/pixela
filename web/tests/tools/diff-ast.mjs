/**
 * tests/tools/diff-ast.mjs — compara a AST do clang com a nossa AST.
 *
 * clang++ -std=c++17 -fsyntax-only -Xclang -ast-dump=json
 *
 * A localização no JSON do clang é em DELTA (file/line só aparecem quando
 * mudam): mantenha estado ao percorrer; ignore nós isImplicit; só nós de topo
 * e membros cujo arquivo resolvido é o fixture (não o stub); membros de classe
 * na ordem.
 *
 * Compare por declaração: (kind, nome, nº de parâmetros, forma do tipo de
 * retorno/declarado, qualificadores const-método/static/constexpr/inline).
 * Forma do tipo = {base, constEsq, constDir, ptrDepth, ref: none|&|&&, arrayDims[]}
 * extraída do qualType do clang por um normalizador e do nosso AST por outro;
 * NUNCA compare strings cruas.
 *
 * Uso: node tests/tools/diff-ast.mjs [--root <dir>] [--versao v1]
 * Saída: reports/A3/<versao>/diff-ast.json + resumo no console.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rootDir, raizEfetiva, clangAst, comStub, header, importCpp, cabecalho } from './lib/compilers.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..');
const root = rootDir();
const VERSAO = process.argv.find((a, i) => process.argv[i - 1] === '--versao') ?? 'v1';

const VALID_DIR = join(RAIZ, 'tests', 'fixtures', 'parse-valid');
const INVALID_DIR = join(RAIZ, 'tests', 'fixtures', 'parse-invalid');
const LOG_DIR = join(raizEfetiva(root), 'reports', 'A3', VERSAO);
mkdirSync(LOG_DIR, { recursive: true });

const { Lexer } = await importCpp(root, 'lexer.js');
const { Parser } = await importCpp(root, 'parser.js');

// ---------- normalizador de tipo do clang ----------

function normClangTipo(qualType) {
  // qualType vem como "const int *" ou "int &" etc.
  const partes = qualType.trim().split(/\s+/);
  const constDir = partes[0] === 'const';
  if (constDir) partes.shift();
  const base = partes[0] ?? '';
  const constEsq = base.startsWith('const');
  const baseLimpa = base.replace(/^const\s*/, '');
  let ptrDepth = 0;
  let ref = 'none';
  let arrayDims = [];
  for (const p of partes.slice(1)) {
    if (p === '*') ptrDepth++;
    else if (p === '&') ref = '&';
    else if (p === '&&') ref = '&&';
    else if (p.startsWith('[')) {
      const m = /\[(\d+)\]/.exec(p);
      if (m) arrayDims.push(Number(m[1]));
    }
  }
  return { base: baseLimpa, constEsq, constDir, ptrDepth, ref, arrayDims };
}

// ---------- normalizador de tipo do nosso AST ----------

function normNossoTipo(tipo) {
  if (!tipo) return { base: '', constEsq: false, constDir: false, ptrDepth: 0, ref: 'none', arrayDims: [] };
  const base = tipo.base ?? tipo.name ?? '';
  const constEsq = !!tipo.cvConst;
  const constDir = !!tipo.constDir;
  const ptrDepth = tipo.ptr?.length ?? 0;
  const ref = tipo.refQual ?? 'none';
  const arrayDims = tipo.array ?? [];
  return { base, constEsq, constDir, ptrDepth, ref, arrayDims };
}

// ---------- extração de declarações do clang ----------

function clangDecls(ast, arquivoFixture) {
  const decls = [];
  let ultimoArquivo = null;
  let ultimaLinha = 0;

  function visita(no) {
    if (!no) return;
    // delta de arquivo/linha
    if (no.loc?.file) ultimoArquivo = no.loc.file;
    if (no.loc?.line) ultimaLinha = no.loc.line;
    else if (no.range?.begin?.line) ultimaLinha = no.range.begin.line;

    if (no.isImplicit) { (no.inner ?? []).forEach(visita); return; }

    const kinds = {
      FunctionDecl: 'FunctionDecl',
      CXXMethod: 'CXXMethod',
      CXXConstructor: 'CXXConstructor',
      CXXDestructor: 'CXXDestructor',
      VarDecl: 'VarDecl',
      FieldDecl: 'FieldDecl',
      RecordDecl: 'RecordDecl',
      ClassTemplateDecl: 'ClassTemplateDecl',
      FunctionTemplateDecl: 'FunctionTemplateDecl',
      TypedefDecl: 'TypedefDecl',
      TypeAliasDecl: 'TypeAliasDecl',
      EnumDecl: 'EnumDecl',
      EnumConstantDecl: 'EnumConstantDecl',
      NamespaceDecl: 'NamespaceDecl',
      UsingDirectiveDecl: 'UsingDirectiveDecl',
      UsingDeclaration: 'UsingDeclaration',
      LinkageSpecDecl: 'LinkageSpecDecl',
      StaticAssertDecl: 'StaticAssertDecl',
    };

    if (kinds[no.kind] && ultimoArquivo && ultimoArquivo.endsWith(arquivoFixture)) {
      const d = {
        kind: kinds[no.kind],
        nome: no.name ?? '',
        linha: ultimaLinha,
        qualType: no.type?.qualType ?? '',
        isConstMethod: no.kind === 'CXXMethod' && no.isConstMethod === true,
        isStatic: no.isStatic === true,
        isInline: no.isInline === true,
        isConstexpr: no.isConstexpr === true,
        params: (no.inner ?? []).filter((x) => x.kind === 'ParmVarDecl').length,
      };
      decls.push(d);
    }
    (no.inner ?? []).forEach(visita);
  }

  visita(ast);
  return decls;
}

// ---------- extração de declarações do nosso AST ----------

function nossosDecls(ast) {
  const decls = [];
  function visita(no, profundidade = 0) {
    if (!no) return;
    const kinds = {
      FunctionDecl: 'FunctionDecl',
      MethodDecl: 'CXXMethod',
      CtorDecl: 'CXXConstructor',
      DtorDecl: 'CXXDestructor',
      VariableDecl: 'VarDecl',
      FieldDecl: 'FieldDecl',
      ClassDecl: 'RecordDecl',
      TemplateDecl: 'ClassTemplateDecl',
      FunctionTemplateDecl: 'FunctionTemplateDecl',
      TypedefDecl: 'TypedefDecl',
      UsingDecl: 'UsingDeclaration',
      EnumDecl: 'EnumDecl',
      EnumValueDecl: 'EnumConstantDecl',
      NamespaceDecl: 'NamespaceDecl',
      LinkageSpec: 'LinkageSpecDecl',
      StaticAssertDecl: 'StaticAssertDecl',
    };
    if (kinds[no.kind]) {
      decls.push({
        kind: kinds[no.kind],
        nome: no.name ?? '',
        linha: no.loc?.line ?? 0,
        qualType: no.tipo ? normNossoTipo(no.tipo) : null,
        isConstMethod: !!no.cvConst,
        isStatic: !!no.isStatic,
        isInline: !!no.isInline,
        isConstexpr: !!no.isConstexpr,
        params: no.params?.length ?? 0,
      });
    }
    for (const f of ['decls', 'members', 'inner', 'corpo']) {
      if (no[f] && Array.isArray(no[f])) no[f].forEach((x) => visita(x, profundidade + 1));
    }
  }
  visita(ast);
  return decls;
}

// ---------- comparação ----------

function comparaDecls(clang, nosso) {
  const divergencias = [];
  const n = Math.max(clang.length, nosso.length);
  for (let i = 0; i < n; i++) {
    const c = clang[i];
    const s = nosso[i];
    if (!c || !s) {
      divergencias.push({ indice: i, clang: c?.kind ?? null, nosso: s?.kind ?? null, motivo: 'ausente' });
      continue;
    }
    if (c.kind !== s.kind) {
      divergencias.push({ indice: i, clang: c.kind, nosso: s.kind, motivo: 'kind' });
      continue;
    }
    if (c.nome !== s.nome) {
      divergencias.push({ indice: i, clang: c.nome, nosso: s.nome, motivo: 'nome' });
      continue;
    }
    if (c.params !== s.params) {
      divergencias.push({ indice: i, clang: c.params, nosso: s.params, motivo: 'params' });
      continue;
    }
    if (c.qualType && s.qualType) {
      const tc = normClangTipo(c.qualType);
      const ts = s.qualType;
      if (tc.base !== ts.base) {
        divergencias.push({ indice: i, clang: tc.base, nosso: ts.base, motivo: 'tipo-base' });
        continue;
      }
      if (tc.ptrDepth !== ts.ptrDepth) {
        divergencias.push({ indice: i, clang: tc.ptrDepth, nosso: ts.ptrDepth, motivo: 'tipo-ptr' });
        continue;
      }
      if (tc.ref !== ts.ref) {
        divergencias.push({ indice: i, clang: tc.ref, nosso: ts.ref, motivo: 'tipo-ref' });
        continue;
      }
    }
    if (c.isConstMethod !== s.isConstMethod) {
      divergencias.push({ indice: i, clang: c.isConstMethod, nosso: s.isConstMethod, motivo: 'const-method' });
      continue;
    }
    if (c.isStatic !== s.isStatic) {
      divergencias.push({ indice: i, clang: c.isStatic, nosso: s.isStatic, motivo: 'static' });
      continue;
    }
  }
  return divergencias;
}

// ---------- loop principal ----------

const resultados = [];
let iguais = 0;
let divergentes = 0;

function compara(arquivo, dir) {
  const fonte = readFileSync(join(dir, arquivo), 'utf8');
  const h = header(fonte);
  const { texto, offsetFixture } = comStub(fonte);

  const c = clangAst(texto);
  if (!c.ok) {
    resultados.push({ arquivo, category: h.category, note: h.note, tipo: 'clang-falhou', divergencias: [] });
    divergentes++;
    return;
  }

  const lex = new Lexer(texto, arquivo).tokenize();
  const r = new Parser(lex.tokens, { file: arquivo }).parse();

  const clangD = clangDecls(c.ast, arquivo);
  const nossosD = nossosDecls(r.ast);

  const div = comparaDecls(clangD, nossosD);
  const tipo = div.length === 0 ? 'ok' : 'estrutura-difere';
  if (div.length === 0) iguais++;
  else divergentes++;

  resultados.push({
    arquivo, category: h.category, note: h.note, tipo,
    clangDecls: clangD.length, nossosDecls: nossosD.length,
    divergencias: div.slice(0, 5),
  });
}

for (const f of readdirSync(VALID_DIR).filter((f) => f.endsWith('.cpp')).sort()) {
  compara(f, VALID_DIR);
}
for (const f of readdirSync(INVALID_DIR).filter((f) => f.endsWith('.cpp')).sort()) {
  compara(f, INVALID_DIR);
}

const porTipo = {};
for (const r of resultados) porTipo[r.tipo] = (porTipo[r.tipo] ?? 0) + 1;

const linhas = [];
linhas.push(`=== diff-ast v${VERSAO} (root=${root}) ===`);
linhas.push(`total: ${resultados.length}   iguais: ${iguais}   divergentes: ${divergentes}`);
linhas.push('');
linhas.push('--- por tipo ---');
for (const [t, n] of Object.entries(porTipo).sort()) linhas.push(`  ${t}: ${n}`);
linhas.push('');
if (divergentes > 0) {
  linhas.push('--- divergentes (primeiros 5 de cada) ---');
  for (const r of resultados.filter((x) => x.tipo !== 'ok').slice(0, 20)) {
    linhas.push(`  ${r.arquivo} [${r.tipo}] clang=${r.clangDecls} nosso=${r.nossosDecls}`);
    for (const d of r.divergencias) {
      linhas.push(`    [${d.indice}] ${d.motivo}: clang=${JSON.stringify(d.clang)} nosso=${JSON.stringify(d.nosso)}`);
    }
  }
}

const relatorio = `${linhas.join('\n')}\n`;
console.log(relatorio);
writeFileSync(join(LOG_DIR, 'diff-ast.json'), JSON.stringify(resultados, null, 2));
writeFileSync(join(LOG_DIR, 'diff-ast.log'), relatorio);
process.exit(divergentes === 0 ? 0 : 1);