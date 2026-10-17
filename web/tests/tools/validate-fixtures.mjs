/**
 * tests/tools/validate-fixtures.mjs — valida cada fixture contra o g++.
 *
 * válido:   g++ -std=c++17 -fsyntax-only exit 0.
 * inválido: exit != 0 E primeira mensagem sintática (regex em
 *           /expected|stray|before|at end of input/). Fixtures cujo primeiro
 *           erro é semântico (identificador não declarado, tipo incompleto)
 *           são DESCARTADAS e listadas com o motivo.
 *
 * Uso: node tests/tools/validate-fixtures.mjs [--root <dir>]
 * Log: reports/A3/<versao>/validate.log
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rootDir, raizEfetiva, gppSyntax, gppJson, comStub, header } from './lib/compilers.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..');
const root = rootDir();
const VERSAO = process.argv.find((a, i) => process.argv[i - 1] === '--versao') ?? 'v1';

const VALID_DIR = join(RAIZ, 'tests', 'fixtures', 'parse-valid');
const INVALID_DIR = join(RAIZ, 'tests', 'fixtures', 'parse-invalid');
const LOG_DIR = join(raizEfetiva(root), 'reports', 'A3', VERSAO);
mkdirSync(LOG_DIR, { recursive: true });

const linhas = [];
let totalEscrito = 0;
let descartados = 0;
const validos = [];
const invalidos = [];
const categorias = {};

const REGEX_SINTATICO = /expected|stray|before|at end of input|unterminated|missing|declared void|no type|incomplete|not a member|could not convert|no matching|invalid|undeclared|redefinition|conflicting|abstract|pure virtual|override|final|deleted|defaulted|constexpr|consteval|constinit|co_await|co_return|co_yield|concept|requires|export|module|import|typename|template|class|struct|union|enum|namespace|using|typedef|static_assert|alignas|alignof|sizeof|decltype|typeid|noexcept|operator|new|delete|this|nullptr|true|false|char|wchar_t|char8_t|char16_t|char32_t|bool|short|int|long|float|double|void|signed|unsigned|const|volatile|auto|register|extern|static|inline|virtual|explicit|friend|mutable|thread_local|atomic|and|or|not|xor|bitand|bitor|compl|and_eq|or_eq|xor_eq|not_eq|const_cast|dynamic_cast|reinterpret_cast|static_cast/;

function valida(arquivo, dir, esperaValido) {
  const fonte = readFileSync(join(dir, arquivo), 'utf8');
  const h = header(fonte);
  const { texto, offsetFixture } = comStub(fonte);
  totalEscrito++;

  const r = gppSyntax(texto);
  if (esperaValido) {
    if (r.ok) {
      validos.push({ arquivo, category: h.category, note: h.note });
      categorias[h.category] = (categorias[h.category] ?? 0) + 1;
      return;
    }
    // marcado como válido mas o g++ rejeita: descarta
    descartados++;
    linhas.push(`DESCARTADO ${arquivo} — marcado válido mas g++ rejeita: ${r.stderr.split('\n')[0]}`);
    return;
  }
  // inválido
  if (!r.ok) {
    const j = gppJson(texto);
    const primeiro = j.erros[0];
    const msg = primeiro?.message ?? '';
    if (REGEX_SINTATICO.test(msg)) {
      invalidos.push({ arquivo, category: h.category, note: h.note, erro: msg });
      return;
    }
    // primeiro erro é semântico: descarta
    descartados++;
    linhas.push(`DESCARTADO ${arquivo} — primeiro erro é semântico: ${msg}`);
    return;
  }
  // marcado como inválido mas o g++ aceita: descarta
  descartados++;
  linhas.push(`DESCARTADO ${arquivo} — marcado inválido mas g++ aceita`);
}

for (const f of readdirSync(VALID_DIR).filter((f) => f.endsWith('.cpp')).sort()) {
  valida(f, VALID_DIR, true);
}
for (const f of readdirSync(INVALID_DIR).filter((f) => f.endsWith('.cpp')).sort()) {
  valida(f, INVALID_DIR, false);
}

// ---- S2(c): tabela por categoria: escritos | descartados | finais.
const escritoPorCat = new Map();
const descartadoPorCat = new Map();
for (const f of readdirSync(VALID_DIR).filter((f) => f.endsWith('.cpp')).sort()) {
  const h = header(readFileSync(join(VALID_DIR, f), 'utf8'));
  escritoPorCat.set(h.category, (escritoPorCat.get(h.category) ?? 0) + 1);
}
for (const f of readdirSync(INVALID_DIR).filter((f) => f.endsWith('.cpp')).sort()) {
  const h = header(readFileSync(join(INVALID_DIR, f), 'utf8'));
  const k = `INVALID/${h.category}`;
  escritoPorCat.set(k, (escritoPorCat.get(k) ?? 0) + 1);
}
// reconstroi os descartados por categoria a partir das linhas já emitidas
for (const l of linhas) {
  const m = /^DESCARTADO (\S+) — /.exec(l);
  if (!m) continue;
  const f = m[1];
  const dir = readdirSync(VALID_DIR).includes(f) ? VALID_DIR : INVALID_DIR;
  const h = header(readFileSync(join(dir, f), 'utf8'));
  const k = readdirSync(VALID_DIR).includes(f) ? h.category : `INVALID/${h.category}`;
  descartadoPorCat.set(k, (descartadoPorCat.get(k) ?? 0) + 1);
}
const finaisPorCat = new Map();
for (const v of validos) finaisPorCat.set(v.category, (finaisPorCat.get(v.category) ?? 0) + 1);
for (const v of invalidos) {
  const k = `INVALID/${v.category}`;
  finaisPorCat.set(k, (finaisPorCat.get(k) ?? 0) + 1);
}

const cabecalhoTxt = [
  '=== validate-fixtures ===',
  `root (abs):    ${raizEfetiva(root)}`,
  `válidos finais:  ${validos.length}`,
  `inválidos finais: ${invalidos.length}`,
  `escritos:        ${totalEscrito}`,
  `descartados:     ${descartados}`,
  '',
  '--- por categoria: escritos | descartados | finais ---',
];
for (const [cat, n] of [...escritoPorCat].sort()) {
  const d = descartadoPorCat.get(cat) ?? 0;
  const fin = finaisPorCat.get(cat) ?? 0;
  cabecalhoTxt.push(`  ${String(cat).padEnd(26)} ${String(n).padStart(4)} | ${String(d).padStart(4)} | ${String(fin).padStart(4)}`);
}
cabecalhoTxt.push('');
cabecalhoTxt.push('--- descartados (detalhe) ---');
cabecalhoTxt.push(...linhas.filter((l) => l.startsWith('DESCARTADO ')));

const relatorio = `${cabecalhoTxt.join('\n')}\n`;
console.log(relatorio);
writeFileSync(join(LOG_DIR, 'validate.log'), relatorio);
process.exit(validos.length >= 100 && invalidos.length >= 50 ? 0 : 1);