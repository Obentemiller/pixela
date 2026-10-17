/**
 * diagnostics.js — Diagnostic messages for the C++ compiler.
 * 
 * Severity levels: error, warning, note
 * All messages are in Portuguese (regra de ouro do projeto).
 * Each diagnostic includes line/column location and a code frame snippet.
 */

export class Diagnostic {
  /**
   * @param {string} severity - 'error', 'warning', or 'note'
   * @param {string} code - Error code (e.g., 'E0101')
   * @param {string} message - Human-readable message
   * @param {{line: number, column: number}} loc - Source location
   * @param {Array<{message: string, line?: number, column?: number}}} notes - Additional notes
   */
  constructor(severity, code, message, loc, notes = []) {
    this.severity = severity;
    this.code = code;
    this.message = message;
    this.loc = loc; // {line, column} 1-based
    this.notes = notes;
  }

  /**
   * "Code frame": a linha do erro com um cursor `^` na coluna.
   * Tabs são expandidos para 4 espaços ANTES de calcular a posição do cursor,
   * senão a coluna do código frame não bate com a coluna do editor.
   * @param {string} source - código-fonte completo (texto cru)
   * @returns {string}
   */
  formatCodeFrame(source) {
    const { line, column } = this.loc;
    const lines = String(source).split('\n');
    const alvo = lines[(line || 1) - 1] ?? '';

    // Expande tabs na linha inteira para exibição, e calcula em quantos
    // caracteres visuais a coluna original cai (para alinhar o cursor).
    let linhaVisivel = '';
    for (const ch of alvo) {
      if (ch === '\t') linhaVisivel += '    ';
      else if (ch === '\r') continue;
      else linhaVisivel += ch;
    }
    let prefixoVisivel = '';
    for (const ch of alvo.slice(0, Math.max(0, (column || 1) - 1))) {
      prefixoVisivel += (ch === '\t') ? '    ' : (ch === '\r' ? '' : ch);
    }
    const colunaVisual = prefixoVisivel.length;

    const larguraNum = String(line || 1).length;
    const pad = ' '.repeat(larguraNum);
    return [
      `${pad} ${line}:${column}`,
      `${pad} | ${linhaVisivel}`,
      `${pad} | ${' '.repeat(colunaVisual)}^`,
    ].join('\n');
  }

  toString(source) {
    const linhas = [];
    linhas.push(`${this.severity}: ${this.code} - ${this.message}`);
    linhas.push(this.formatCodeFrame(source));
    for (const note of this.notes ?? []) {
      const msg = typeof note === 'string' ? note : note.message;
      linhas.push(`  nota: ${msg}`);
      if (typeof note === 'object' && note.loc) {
        linhas.push(`  linha ${note.loc.line}:${note.loc.column}`);
      }
    }
    return linhas.join('\n');
  }
}

/**
 * Formata um diagnóstico no formato padrão do compilador:
 *
 *   main.cpp:12:9: erro E0201: identificador 'x' não declarado
 *       12 |     pix_cirle(10, 10);
 *          |     ^~~~~~~~~
 *   nota: você quis dizer 'pix_circle'?
 *
 * @param {Diagnostic} diag
 * @param {import('./source.js').SourceFile|{text:string,name?:string,getLine(n:number):string}} fonte
 * @returns {string}
 */
export function formatDiagnostic(diag, fonte) {
  if (!diag) return '';
  const texto = typeof fonte === 'string' ? fonte : (fonte?.text ?? '');
  const arquivo = (typeof fonte === 'object' && (fonte?.name || fonte?.fileName)) || 'main.cpp';
  const linha = diag.loc?.line ?? 1;
  const coluna = diag.loc?.column ?? 1;

  const linhas = [`${arquivo}:${linha}:${coluna}: ${diag.severity} ${diag.code}: ${diag.message}`];

  if (texto) {
    const num = String(linha).length;
    const pad = ' '.repeat(num);
    const src = String(texto).split('\n')[linha - 1] ?? '';
    let vis = '';
    for (let i = 0; i < src.length; i++) {
      if (src[i] === '\t') vis += '    ';
      else if (src[i] === '\r') continue;
      else vis += src[i];
    }
    let antes = '';
    for (const ch of src.slice(0, Math.max(0, coluna - 1))) antes += (ch === '\t') ? '    ' : (ch === '\r' ? '' : ch);
    linhas.push(`${pad} ${String(linha)} | ${vis}`);
    linhas.push(`${pad}     | ${' '.repeat(antes.length)}^`);
  }

  for (const note of diag.notes ?? []) {
    linhas.push(`nota: ${typeof note === 'string' ? note : note.message}`);
  }
  return linhas.join('\n');
}

/**
 * Catálogo de códigos de erro estáveis.
 * Cada código segue o padrão E01xx (erro), W02xx (warning), N03xx (note).
 * Isso permite que o frontend exiba mensagens consistentes sem
 * depender da string de mensagem.
 */
export const ErrorCodes = {
  // Sintaxe
  UNEXPECTED_TOKEN: 'E0100',
  EXPECTED_SEMICOLON: 'E0101',
  EXPECTED_CLOSE_PAREN: 'E0102',
  EXPECTED_CLOSE_BRACE: 'E0103',
  EXPECTED_IDENTIFIER: 'E0104',
  EXPECTED_TYPE: 'E0105',

  // Não suportado
  FEATURE_NOT_SUPPORTED: 'E0200',

  // Semântica
  UNDECLARED_IDENTIFIER: 'E0300',
  TYPE_MISMATCH: 'E0301',
  NO_VIABLE_OVERLOAD: 'E0302',
  AMBIGUOUS_OVERLOAD: 'E0303',
  VARIABLE_REDECLARED: 'E0304',
  FUNCTION_REDECLARED: 'E0305',
  INVALID_CAST: 'E0306',
  INVALID_OPERAND_TYPES: 'E0307',
  // Designador C++20 (`{.x = 1}`) — gramaticalmente correto, rejeitado por
  // escolha de escopo. E03xx (semântico) e não E02xx: é a única forma de
  // T2.1 que a ordem manda NÃO parsear.
  DESIGNATED_INITIALIZER_UNSUPPORTED: 'E0308',

  // Template
  INSTANTIATION_ERROR: 'E0400',
  DEPTH_EXCEEDED: 'E0401',

  // Biblioteca
  UNKNOWN_STD_FUNCTION: 'E0500',
  STDLIB_OVERLOAD_AMBIGUOUS: 'E0501',
};

/**
 * Diagnósticos pré-definidos (sem source frame ainda).
 * Use Diagnostic.fromCode(code, loc) como atalho.
 */
export const Diagnostics = {
  unexpectedToken(source, loc, found, expected) {
    return new Diagnostic(
      'error',
      ErrorCodes.UNEXPECTED_TOKEN,
      `Token inesperado '${found}' (esperava: ${expected})`,
      loc,
      []
    );
  },
  
  expectedSemicolon(source, loc, line) {
    return new Diagnostic(
      'error',
      ErrorCodes.EXPECTED_SEMICOLON,
      `';' esperado após a declaração na linha ${line}`,
      loc,
      []
    );
  },
  
  featureNotSupported(source, loc, feature) {
    return new Diagnostic(
      'error',
      ErrorCodes.FEATURE_NOT_SUPPORTED,
      `${feature} ainda não é suportado neste compilador (veja docs/linguagem-suportada.md)`,
      loc,
      []
    );
  },
  
  undeclaredIdentifier(source, loc, name) {
    return new Diagnostic(
      'error',
      ErrorCodes.UNDECLARED_IDENTIFIER,
      `Identificador '${name}' não declarado`,
      loc,
      []
    );
  },
  
  typeMismatch(source, loc, got, expected) {
    return new Diagnostic(
      'error',
      ErrorCodes.TYPE_MISMATCH,
      `Tipo incompatível: esperava ${expected}, got ${got}`,
      loc,
      []
    );
  },
  
  noViableOverload(source, loc, functionName, candidates) {
    return new Diagnostic(
      'error',
      ErrorCodes.NO_VIABLE_OVERLOAD,
      `Nenhuma sobrecarga viável para '${functionName}'.`,
      loc,
      candidates.length > 0 
        ? [{ message: `Candidatas: ${candidates.map(c => c.join('(')).join(', ')}` }] 
        : []
    );
  },
  
  ambiguousOverload(source, loc, functionName, candidates) {
    return new Diagnostic(
      'error',
      ErrorCodes.AMBIGUOUS_OVERLOAD,
      `Sobrecarga ambígua para '${functionName}'.`,
      loc,
      candidates.length > 0
        ? [{ message: `Candidatas: ${candidates.map(c => c.join('(')).join(', ')}` }] 
        : []
    );
  },
  
  variableRedeclared(source, loc, name) {
    return new Diagnostic(
      'error',
      ErrorCodes.VARIABLE_REDECLARED,
      `Variável '${name}' já declarada neste escopo`,
      loc,
      []
    );
  },
};