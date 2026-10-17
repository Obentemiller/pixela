/**
 * codegen.js — Code Generation: AST → JavaScript.
 *
 * Traduz o AST produzido pelo parser (schema real em js/cpp/ast.js) para
 * código JavaScript puro que roda no navegador, chamando as funções
 * runtime do Pixela (pix_*).
 *
 * Esquema de nós suportado (todos de js/cpp/ast.js):
 *   TranslationUnit { decls[] }
 *   FunctionDecl { specifiers[], declarator { name, params[], retType? }, body }
 *   VariableDecl { specifiers[], declarators[], init? }
 *   DeclStmt { decl }
 *   CompoundStmt { stmts[] }
 *   IfStmt { cond, then, els, condInit? }
 *   WhileStmt { cond, body }
 *   DoStmt { body, cond }
 *   ForStmt { init, cond, update, body }
 *   ReturnStmt { expr? }
 *   ExprStmt { expr }
 *   Binary { op, left, right }
 *   Assign { op, target, value }
 *   Unary { op, expr, prefix? }
 *   PostfixUnary { op, expr }
 *   Ternary { cond, then, other }
 *   Paren { expr }
 *   BreakStmt / ContinueStmt / NullStmt
 *   Call { callee, args[] }
 *   Identifier { name }
 *   Literal { value, literalKind, text }
 *
 * Regras:
 * - `kind` é o discriminador (nunca `type`).
 * - Nada lança; nós ausentes geram `0` ou vazios.
 * - Funções pix_* já estão definidas no headerCode (runtime). Não gera
 *   declarações vazias para elas dentro do IIFE.
 * - Aritmética respeita tipos: `double`/`float` nunca recebem `|0`.
 *   Só expressões inteiras (ambos os lados inteiros) usam `|0`.
 *   O tipo é inferido de literais, declarações e chamadas conhecidas
 *   (Math.*, pix_time, etc.).
 * - Variáveis globais (VariableDecl no topo) são emitidas como `let`
 *   no escopo do módulo.
 * - `for` é emitido como `for` nativo (com `let` no init), de modo que
 *   `break`/`continue` têm a semântica do C++ (continue não pula o update).
 * - Funções suspensíveis (chamam pix_present direta ou indiretamente) são
 *   emitidas como function*; suas chamadas viram yield* f(...).
 */

import { Type, cppTypeToJS } from './types.js';
import { Diagnostic, ErrorCodes } from './diagnostics.js';

const JS_NUMERIC_TYPES = new Set(['int', 'unsigned int', 'float', 'double', 'long', 'short', 'char', 'bool', 'size_t']);

export class CodeGenerator {
  constructor(options = {}) {
    this.options = options;
    this.variableCounter = 0;
    this.tempCounter = 0;
    this.jsLines = [];
    this.sourcemap = {};      // linha JS → linha C++
    this.headerCode = '';     // código de header (pix_* calls)
    this.runtimeDeps = new Set(); // módulos runtime necessários
    this.suspenseSet = new Set(); // nomes de funções que chamam pix_present (direto ou indiretamente)
    this.callGraph = new Map();   // nome da função -> conjunto de nomes chamados
    this.scopeStack = [new Map()]; // pilha de escopos: nome -> { isFloat, isArray, elemFloat }
    this.funcReturnFloat = new Map(); // nome da função -> true se retorna double/float
  }

  // ---------------------------------------------------------- escopos/tipos

  _pushScope() { this.scopeStack.push(new Map()); }
  _popScope() { if (this.scopeStack.length > 1) this.scopeStack.pop(); }

  _declare(name, info) {
    if (!name) return;
    this.scopeStack[this.scopeStack.length - 1].set(name, info);
  }

  _lookup(name) {
    for (let i = this.scopeStack.length - 1; i >= 0; i--) {
      const hit = this.scopeStack[i].get(name);
      if (hit) return hit;
    }
    return null;
  }

  _specIsFloat(specifiers) {
    return (specifiers || []).some((s) => s === 'double' || s === 'float');
  }

  // Diz se uma expressão C++ tem tipo ponto-flutuante. Usado para decidir
  // se o JS gerado pode usar aritmética pura (float) ou precisa de `|0`
  // (int). Em caso de dúvida sobre variável desconhecida, devolve false
  // (comportamento antigo, inteiro) — exceto chamadas sabidamente float.
  _exprIsFloat(node) {
    if (!node || typeof node !== 'object') return false;
    switch (node.kind) {
      case 'Literal':
        if (node.literalKind === 'float') return true;
        return typeof node.value === 'number' && !Number.isInteger(node.value);
      case 'Identifier': {
        if (node.name === 'M_PI' || node.name === 'M_E') return true;
        if (node.name === 'RAND_MAX') return false;
        const info = this._lookup(node.name);
        return !!(info && info.isFloat);
      }
      case 'Paren':
        return this._exprIsFloat(node.expr);
      case 'Binary': {
        if (['<', '>', '<=', '>=', '==', '!=', '&&', '||'].includes(node.op)) return false;
        if (node.op === '<<' || node.op === '>>') return false;
        return this._exprIsFloat(node.left) || this._exprIsFloat(node.right);
      }
      case 'Assign': {
        // O tipo da atribuição é o tipo do alvo.
        const t = this._targetIsFloat(node.target);
        if (t !== null) return t;
        return this._exprIsFloat(node.value);
      }
      case 'Unary': {
        if (node.op === '!' || node.op === 'sizeof') return false;
        return this._exprIsFloat(node.expr);
      }
      case 'PostfixUnary':
        return this._exprIsFloat(node.expr);
      case 'Ternary':
        return this._exprIsFloat(node.then) || this._exprIsFloat(node.other);
      case 'Cast': {
        const spec = node.typeId && node.typeId.expr && node.typeId.expr.specifierText || '';
        if (spec === 'double' || spec === 'float') return true;
        if (['int', 'long', 'short', 'char', 'unsigned int', 'size_t', 'bool'].includes(spec)) return false;
        return this._exprIsFloat(node.expr);
      }
      case 'Call': {
        const callee = node.callee;
        const nm = callee && callee.kind === 'Identifier' ? callee.name : '';
        const floatFns = new Set(['sin', 'cos', 'tan', 'sqrt', 'floor', 'ceil', 'pow', 'abs', 'fabs',
          'exp', 'log', 'atan', 'atan2', 'fmod', 'atof', 'pix_time',
          'std::sin', 'std::cos', 'std::sqrt', 'std::floor', 'std::ceil', 'std::pow', 'std::abs']);
        if (floatFns.has(nm)) return true;
        if (nm === 'rand' || nm === 'pix_width' || nm === 'pix_height' || nm === 'pix_get') return false;
        if (nm && this.funcReturnFloat.has(nm)) return this.funcReturnFloat.get(nm);
        return false;
      }
      case 'Index': {
        const base = node.base;
        if (base && base.kind === 'Identifier') {
          const info = this._lookup(base.name);
          if (info && info.isArray) return !!info.elemFloat;
        }
        return false;
      }
      default:
        return false;
    }
  }

  // Tipo do ALVO de uma atribuição (lado esquerdo). Devolve true/false, ou
  // null quando o tipo é desconhecido.
  _targetIsFloat(target) {
    if (!target || typeof target !== 'object') return null;
    if (target.kind === 'Identifier') {
      const info = this._lookup(target.name);
      return info ? !!info.isFloat : null;
    }
    if (target.kind === 'Index') {
      const base = target.base;
      if (base && base.kind === 'Identifier') {
        const info = this._lookup(base.name);
        if (info && info.isArray) return !!info.elemFloat;
      }
      return null;
    }
    return null;
  }

  /**
   * Gera código JS a partir de um AST.
   * @param {Array|Object} ast - AST do parser (TranslationUnit ou lista de decls)
   * @param {Object} sourceFile - Fonte original para sourcemap (ignorado por enquanto)
   * @returns {{code: string, map: Object, deps: Set, entry: string|null, entryIsGenerator: boolean, warnings: string[]}}
   */
  generate(ast, sourceFile) {
    this.jsLines = [];
    this.variableCounter = 0;
    this.tempCounter = 0;
    this.sourcemap = {};
    this.headerCode = '';
    this.runtimeDeps.clear();
    this.suspenseSet = new Set();
    this.callGraph = new Map();
    this.scopeStack = [new Map()];
    this.funcReturnFloat = new Map();

    const decls = Array.isArray(ast) ? ast : (ast && ast.decls) || [];
    this.entryName = null;
    let fallbackEntry = null;

    // Primeira passagem: coletar chamadas de função para construir grafo,
    // tipos de retorno das funções e tipos das variáveis globais.
    //
    // BUG-5: o Preprocessor injeta declarações da stdlib (malloc, free, abs,
    // atof) ANTES de main() nos exemplos que usam <cmath>/<cstdlib>. A regra
    // antiga "primeira função que não começa com pix_" escolhia `malloc` como
    // entry. Agora main() tem prioridade e as demais ficam como fallback.
    for (const decl of decls) {
      if (decl.kind === 'FunctionDecl') {
        const d = decl.declarator || {};
        const name = d.name || '';
        const retFloat = this._specIsFloat(decl.specifiers);
        this.funcReturnFloat.set(name, retFloat);
        if (name.startsWith('pix_')) continue;
        if (name === 'main') {
          this.entryName = name;
        } else if (!fallbackEntry) {
          fallbackEntry = name;
        }
        this._collectCalls(decl, name);
      }
    }
    if (!this.entryName) this.entryName = fallbackEntry;

    // Segunda passagem: ponto fixo para propagar suspensibilidade
    this._computeSuspension();

    // Terceira passagem: gerar código. Variáveis globais viram `let` no
    // escopo do módulo; funções pix_* declaradas no fonte são ignoradas
    // (já existem no headerCode/runtime).
    for (const decl of decls) {
      // Funções pix_* já estão definidas no headerCode (runtime). Não gera
      // declarações vazias para elas dentro do IIFE.
      if (decl.kind === 'FunctionDecl') {
        const d = decl.declarator || {};
        const name = d.name || '';
        if (name.startsWith('pix_')) continue;
        this._generateNode(decl, 0, sourceFile);
      } else if (decl.kind === 'VariableDecl') {
        const s = this._generateNode(decl, 0, sourceFile);
        if (s) {
          for (const sub of s.split('\n')) {
            if (sub.trim()) this.jsLines.push(sub);
          }
        }
      }
    }

    // Código de header (registros de funções pix_*)
    this._generatePixHeader();

    const code = this._assembleModule();
    return {
      code,
      map: this.sourcemap,
      deps: this.runtimeDeps,
      entry: this.entryName,
      entryIsGenerator: this.entryName ? this.suspenseSet.has(this.entryName) : false,
      warnings: [],
    };
  }

  /**
   * Coleta chamadas de função de um nó para construir o grafo de chamadas.
   * @param {Object} node - nó do AST para escanear
   * @param {string} callerName - nome da função que contém este nó
   */
  _collectCalls(node, callerName) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) this._collectCalls(child, callerName);
      return;
    }

    if (node.kind === 'Call') {
      const callee = node.callee;
      if (callee && callee.kind === 'Identifier') {
        const targetName = callee.name;
        if (targetName && targetName !== callerName) {
          let targets = this.callGraph.get(callerName);
          if (!targets) {
            targets = new Set();
            this.callGraph.set(callerName, targets);
          }
          targets.add(targetName);
        }
      }
    }

    // Recorrer nos filhos do nó
    for (const key of Object.keys(node)) {
      if (key === 'kind' || key === 'loc' || key === 'locEnd') continue;
      const value = node[key];
      if (value && typeof value === 'object') {
        this._collectCalls(value, callerName);
      }
    }
  }

  /**
   * Computa suspensibilidade por ponto fixo: uma função é suspensível se
   * chama pix_present diretamente ou chama outra função suspensível.
   */
  _computeSuspension() {
    // Primeira passagem: marcar funções que chamam pix_present diretamente
    for (const [caller, targets] of this.callGraph) {
      for (const target of targets) {
        if (target === 'pix_present') {
          this.suspenseSet.add(caller);
        }
      }
    }

    // Segunda passagem: propagar suspensibilidade até ponto fixo
    let changed = true;
    while (changed) {
      changed = false;
      for (const [caller, targets] of this.callGraph) {
        if (this.suspenseSet.has(caller)) continue;
        for (const target of targets) {
          if (this.suspenseSet.has(target)) {
            this.suspenseSet.add(caller);
            changed = true;
            break;
          }
        }
      }
    }
  }

  /**
   * Verifica se um dado nome de função é suspensível.
   */
  _isSuspenseful(name) {
    return this.suspenseSet.has(name);
  }

  // ------------------------------------------------------------------ despacho

  _generateNode(node, depth, sourceFile) {
    if (!node) return '';
    if (Array.isArray(node)) {
      return node.map((n) => this._generateNode(n, depth, sourceFile)).join('\n');
    }
    if (typeof node !== 'object' || typeof node.kind !== 'string') return '';

    switch (node.kind) {
      case 'TranslationUnit':
        return this._generateTranslationUnit(node);
      case 'FunctionDecl':
        return this._generateFunctionDecl(node);
      case 'VariableDecl':
        return this._generateVariableDecl(node);
      case 'DeclStmt':
        return this._generateDeclStmt(node);
      case 'CompoundStmt':
        return this._generateCompoundStmt(node);
      case 'IfStmt':
        return this._generateIfStmt(node);
      case 'WhileStmt':
        return this._generateWhileStmt(node);
      case 'DoStmt':
        return this._generateDoStmt(node);
      case 'ForStmt':
        return this._generateForStmt(node);
      case 'ReturnStmt':
        return this._generateReturnStmt(node);
      case 'ExprStmt':
        return this._generateExprStmt(node);
      case 'Binary':
        return this._generateBinary(node);
      case 'Assign':
        return this._generateAssign(node);
      case 'Unary':
        return this._generateUnary(node);
      case 'PostfixUnary':
        return this._generatePostfixUnary(node);
      case 'Ternary':
        return this._generateTernary(node);
      case 'Paren':
        return this._generateParen(node);
      case 'BreakStmt':
        return 'break;';
      case 'ContinueStmt':
        return 'continue;';
      case 'NullStmt':
        return ';';
      case 'Call':
        return this._generateCall(node);
      case 'Cast':
        return this._generateCast(node);
      case 'Index':
        return this._generateIndex(node);
      case 'Identifier': {
        if (node.name === 'M_PI') return '(Math.PI)';
        if (node.name === 'M_E') return '(Math.E)';
        if (node.name === 'RAND_MAX') return '(32767)';
        return node.name || '';
      }
      case 'Literal':
        return this._generateLiteral(node);
      default:
        // Nó desconhecido: não gera nada, não lança.
        return '';
    }
  }

  // ------------------------------------------------------------------ nós

  _generateTranslationUnit(node) {
    const out = [];
    for (const decl of node.decls || []) {
      out.push(this._generateNode(decl, 0));
    }
    return out.join('\n');
  }

  _generateFunctionDecl(node) {
    const declarator = node.declarator || {};
    const name = declarator.name || 'anon';
    const rawParams = declarator.params || [];
    // Declara parâmetros no escopo da função (para inferência float/int).
    this._pushScope();
    const params = rawParams.map((p) => {
      if (p && p.kind === 'VariableDecl') {
        const spec = p.specifiers || [];
        const isFloat = this._specIsFloat(spec);
        for (const d of p.declarators || []) {
          if (d && d.name) this._declare(d.name, { isFloat, isArray: (d.array || []).length > 0, elemFloat: isFloat });
        }
        return this._paramName(p);
      }
      return this._paramName(p);
    }).join(', ');
    const body = node.body; // CompoundStmt ou null

    const isSuspenseful = this._isSuspenseful(name);
    const funcKeyword = isSuspenseful ? 'function*' : 'function';

    this.jsLines.push(`${funcKeyword} ${name}(${params}) {`);
    if (body && body.kind === 'CompoundStmt') {
      // Escopo do corpo (as chaves do corpo já criam escopo; o push extra
      // aqui cobre parâmetros + corpo sem duplicar).
      for (const stmt of body.stmts || []) {
        const s = this._generateNode(stmt, 1);
        if (s) {
          for (const sub of s.split('\n')) {
            if (sub.trim()) this.jsLines.push(`  ${sub}`);
          }
        }
      }
    }
    this.jsLines.push('}');
    this.jsLines.push('');
    this._popScope();
    return '';
  }

  _paramName(p) {
    if (!p) return 'arg';
    if (p.kind === 'Declarator') return p.name || 'arg';
    if (p.kind === 'VariableDecl') {
      const d = (p.declarators || [])[0];
      return d && d.name ? d.name : 'arg';
    }
    return 'arg';
  }

  _generateVariableDecl(node) {
    const specifiers = node.specifiers || [];
    const isConst = specifiers.includes('const');
    const isFloat = this._specIsFloat(specifiers);
    const declarators = node.declarators || [];

    // BUG-9: esta função empurrava para this.jsLines e retornava '', então quando
    // chamada via _generateNode (por exemplo, no init de um for) o código ia para
    // o FINAL de this.jsLines e o chamador recebia string vazia. Isso fazia o
    // _generateForStmt não ver o `let i = 0|0;` e emitir o while com corpo vazio,
    // deixando o `let i` no escopo externo e colidindo com um segundo `let i`
    // de um for aninhado. Agora retorna a string gerada.
    //
    // Tipos: `double`/`float` nunca recebem `|0`. Só inteiros recebem.
    // O init de var float com literal int (`double x = 10`, que o parser
    // entrega como `10|0`) tem o `|0` final removido.
    const partes = [];
    for (const d of declarators) {
      const name = d.name || `tmp${this.tempCounter++}`;
      const isArr = (d.array && d.array.length > 0);
      this._declare(name, { isFloat, isArray: isArr, elemFloat: isFloat });
      let init = '';
      const initNode = d.init || node.init;
      if (initNode) {
        init = this._generateNode(initNode);
        if (init) {
          if (isFloat && !isArr) init = init.replace(/\|0$/, '');
          init = ` = ${init}`;
        }
      } else if (isArr) {
        // Array multidimensional: cria com dimensões especificadas
        const dims = d.array.map((a) => {
          const v = this._generateNode(a);
          return v || '0';
        });
        init = ` = createArray([${dims.join(',')}])`;
      }
      const kind = isConst ? 'const' : 'let';
      partes.push(`${kind} ${name}${init};`);
    }
    return partes.join('\n');
  }

  _generateDeclStmt(node) {
    return this._generateVariableDecl(node.decl || node);
  }

  _generateCompoundStmt(node) {
    this._pushScope();
    const out = ['{'];
    for (const stmt of node.stmts || []) {
      const s = this._generateNode(stmt, 1);
      if (s) {
        // BUG-12: _generateNode pode retornar string com múltiplas linhas
        // (por exemplo, o resultado de _generateForStmt). Se empurrarmos como
        // um único elemento, apenas a primeira linha recebe a indentação e as
        // demais ficam desalinhadas. Dividimos em linhas e indentamos cada uma.
        for (const sub of s.split('\n')) {
          if (sub.trim()) out.push(`  ${sub}`);
        }
      }
    }
    out.push('}');
    this._popScope();
    return out.join('\n');
  }

  _blockify(s) {
    const t = (s || '').trim() || '{}';
    return t.startsWith('{') ? t : `{ ${t} }`;
  }

  _generateIfStmt(node) {
    const cond = this._generateNode(node.cond) || '0';
    const then = this._blockify(this._generateNode(node.then));
    const els = node.els ? this._blockify(this._generateNode(node.els)) : null;
    if (els) {
      return `if (${cond}) ${then} else ${els}`;
    }
    return `if (${cond}) ${then}`;
  }

  _generateWhileStmt(node) {
    const cond = this._generateNode(node.cond) || '0';
    const body = this._blockify(this._generateNode(node.body));
    return `while (${cond}) ${body}`;
  }

  _generateDoStmt(node) {
    const cond = this._generateNode(node.cond) || '0';
    const body = this._blockify(this._generateNode(node.body));
    return `do ${body} while (${cond});`;
  }

  _generateForStmt(node) {
    // `for` nativo do JS: preserva a semântica do C++ para `break`/`continue`
    // (continue NÃO pula o update, ao contrário da reescrita com `while`).
    // O init com `let` já tem escopo próprio no JS, sem colisão entre `for`s.
    this._pushScope();
    let init = node.init ? this._generateNode(node.init) : '';
    const cond = node.cond ? this._generateNode(node.cond) : 'true';
    const update = node.update ? this._generateNode(node.update) : '';
    const body = this._blockify(this._generateNode(node.body) || '{}');
    if (init) init = init.replace(/;\s*$/, '');
    const out = `for (${init}; ${cond}; ${update}) ${body}`;
    this._popScope();
    return out;
  }

  _generateReturnStmt(node) {
    const expr = node.expr ? this._generateNode(node.expr) : 'undefined';
    return `return ${expr};`;
  }

  _generateExprStmt(node) {
    const expr = node.expr ? this._generateNode(node.expr) : '';
    return expr ? `${expr};` : '';
  }

  // ------------------------------------------------------------------ expressões

  _generateAssign(node) {
    // Atribuição: target = value. Quando o alvo é inteiro conhecido e o valor
    // é float, trunca (semântica do C++: `int i; i = 2.9` → 2).
    const target = this._generateNode(node.target);
    const value = this._generateNode(node.value);

    if (node.op === '=') {
      const t = this._targetIsFloat(node.target);
      if (t === false) return `${target}=((${value})|0)`;
      return `${target}=(${value})`;
    }
    // Atribuição composta: o tipo do alvo manda.
    const t = this._targetIsFloat(node.target);
    const opChar = node.op.replace('=', '');
    if (t === true) return `${target}${node.op}(${value})`;
    return `${target}=((${target})${opChar}(${value})|0)`;
  }

  _generateBinary(node) {
    const left = this._generateNode(node.left) || '0';
    const right = this._generateNode(node.right) || '0';
    const op = node.op;
    const isFloat = this._exprIsFloat(node);

    // Operadores aritméticos. Inteiros usam `|0` (com operandos entre
    // parênteses para não quebrar a precedência: `|` liga mais fraco que
    // `+`); floats usam aritmética pura do JS.
    if (['+', '-', '*', '/', '%'].includes(op)) {
      if (isFloat) {
        if (op === '+') return `((${left})+(${right}))`;
        if (op === '-') return `((${left})-(${right}))`;
        if (op === '*') return `((${left})*(${right}))`;
        if (op === '/') return `((${left})/(${right}))`;
        return `((${left})%(${right}))`;
      }
      if (op === '+') return `(((${left})+(${right}))|0)`;
      if (op === '-') return `(((${left})-(${right}))|0)`;
      if (op === '*') return `(((${left})*(${right}))|0)`;
      if (op === '/') return `(((${left})/(${right})||0)|0)`;
      if (op === '%') return `(((${left})%(${right})||0)|0)`;
    }
    // Comparações → 1/0
    if (['<', '>', '<=', '>=', '==', '!='].includes(op)) {
      return `(((${left})${op}(${right}))?1:0)`;
    }
    // Lógicos → 1/0
    if (op === '&&') return `(((${left})&&(${right}))?1:0)`;
    if (op === '||') return `(((${left})||(${right}))?1:0)`;
    // Atribuição composta como Binary (quando o parser emite Binary).
    if (['+=', '-=', '*=', '/=', '%='].includes(op)) {
      const opChar = op.replace('=', '');
      if (isFloat) return `(${left}${op}(${right}))`;
      return `(${left}=((${left})${opChar}(${right})|0))`;
    }
    // Deslocamento
    if (op === '<<') return `(((${left})<<${right})>>>0)`;
    if (op === '>>') return `(((${left})>>${right}))`;

    return `((${left}) ${op} (${right}))`;
  }

  _generateTernary(node) {
    const cond = this._generateNode(node.cond) || '0';
    const then = this._generateNode(node.then) || '0';
    const other = this._generateNode(node.other) || '0';
    return `((${cond})?(${then}):(${other}))`;
  }

  _generateParen(node) {
    const inner = this._generateNode(node.expr) || '0';
    return `(${inner})`;
  }

  _generatePostfixUnary(node) {
    const target = this._generateNode(node.expr) || '0';
    if (node.op === '++') return `(${target}++)`;
    if (node.op === '--') return `(${target}--)`;
    return target;
  }

  _generateCast(node) {
    const inner = this._generateNode(node.expr) || '0';
    const spec = node.typeId && node.typeId.expr && node.typeId.expr.specifierText || '';

    // BUG-8: casts como `(int)x` geravam string vazia no código JS, produzindo
    // chamadas inválidas como `pix_circle(,,radius,true,...)`. Agora:
    // - (int)x, (long)x, (short)x, (char)x → truncamento com |0
    // - outros tipos ((double)x, (float)x, etc.) → apenas avalia a expressão
    //   interna (JS é dinamicamente tipado, então o cast é semanticamente
    //   equivalente a avaliar a expressão)
    if (['int', 'long', 'short', 'char'].includes(spec)) {
      return `(${inner})|0`;
    }
    return inner;
  }

  _generateIndex(node) {
    // BUG-10: acessos a array como `sx[i]` ou `idx[0][yi][zi]` geravam string
    // vazia (não havia case para o nó 'Index'), produzindo chamadas inválidas
    // como `pix_set(,,true,...)` e `pix_mesh_add_edge(,)`. Agora gera a expressão
    // de indexação correspondente em JS.
    const base = this._generateNode(node.base) || '0';
    const index = this._generateNode(node.index) || '0';
    return `${base}[${index}]`;
  }

  _generateUnary(node) {
    const arg = this._generateNode(node.expr) || '0';
    const op = node.op;

    if (op === '-') return `-(${arg})`;
    if (op === '+') return `+(${arg})`;
    if (op === '~') return `~(${arg})`;
    if (op === '!') return `(!(${arg}))?1:0`;
    if (op === '++') return `(++(${arg}))`;
    if (op === '--') return `(--(${arg}))`;
    if (op === 'sizeof') return '4'; // tamanho de int no nosso modelo
    if (op === '*' || op === '&') return arg; // sem ponteiros no modelo JS
    return arg;
  }

  _generateCall(node) {
    const callee = node.callee;
    const args = (node.args || []).map((a) => this._generateNode(a)).join(',');

    if (!callee) return `(${args})`;

    if (callee.kind === 'Identifier') {
      const name = callee.name;
      // Funções pix_* do runtime
      if (name === 'pix_present') {
        return `yield* pix_present()`;
      }
      if (name.startsWith('pix_')) {
        this.runtimeDeps.add('pixela');
        return `${name}(${args})`;
      }
      // Funções std::
      if (name.startsWith('std::')) {
        const stdFunc = name.split('::')[1] || '';
        if (['min', 'max', 'clamp'].includes(stdFunc)) {
          return `${name}(${args})`;
        }
        if (['sin', 'cos', 'sqrt', 'floor', 'ceil', 'pow', 'abs', 'fabs', 'exp', 'log', 'atan', 'atan2', 'tan'].includes(stdFunc)) {
          const jsName = stdFunc === 'fabs' ? 'abs' : stdFunc;
          return `Math.${jsName}(${args})`;
        }
        return `${name}(${args})`;
      }
      // BUG-15: o parser gera chamadas da stdlib SEM o prefixo std:: (por exemplo,
      // `sin(x)` em vez de `std::sin(x)`). Sem este caso, o código gerado usava
      // `sin(...)` diretamente, que não existe em JS — erro de runtime
      // "sin is not defined". Agora mapeamos as funções matemáticas comuns para
      // Math.* mesmo sem o prefixo.
      if (['sin', 'cos', 'tan', 'sqrt', 'floor', 'ceil', 'pow', 'abs', 'fabs', 'exp', 'log', 'atan'].includes(name)) {
        const jsName = name === 'fabs' ? 'abs' : name;
        return `Math.${jsName}(${args})`;
      }
      if (name === 'atan2') {
        return `Math.atan2(${args})`;
      }
      if (name === 'fmod' && node.args && node.args.length === 2) {
        const a = this._generateNode(node.args[0]);
        const b = this._generateNode(node.args[1]);
        return `((${a})%(${b}))`;
      }
      if (name === 'atof') {
        return `(parseFloat(${args}))`;
      }
      // rand()/srand(): LCG determinístico estilo ANSI C
      // (`__rand_state` vive no header do módulo gerado). Determinístico
      // entre execuções, ao contrário de Math.random().
      if (name === 'rand') {
        return `(__rand())`;
      }
      if (name === 'srand') {
        return `(__rand_seed(${args}))`;
      }
      // Chamada de função do usuário: usar yield* se for suspensível
      if (this._isSuspenseful(name)) {
        return `yield* ${name}(${args})`;
      }
      return `${name}(${args})`;
    }

    if (callee.kind === 'Member') {
      const obj = this._generateNode(callee.base) || '';
      const prop = callee.name || '';
      return `${obj}.${prop}(${args})`;
    }

    return `(${this._generateNode(callee)})(${args})`;
  }

  _generateLiteral(node) {
    if (!node) return '0';
    const kind = node.literalKind;
    const value = node.value;

    if (kind === 'string') {
      const text = node.text !== null && node.text !== undefined ? node.text : String(value);
      return JSON.stringify(text);
    }
    if (kind === 'char') return JSON.stringify(String(value));
    if (kind === 'bool') return value ? 'true' : 'false';
    if (kind === 'nullptr') return '0';
    if (kind === 'float' || (typeof value === 'number' && value % 1 !== 0)) {
      return String(value);
    }
    // int padrão
    return `${value}|0`;
  }

  // ------------------------------------------------------------------ montagem

  _assembleModule() {
    const allLines = [];
    allLines.push(this.headerCode);
    allLines.push('');
    allLines.push('var __pixela_entry = (function() {');
    allLines.push('  "use strict";');
    allLines.push('');
    for (const line of this.jsLines) {
      if (line && line.trim()) {
        // BUG-13: elementos de this.jsLines podem ser strings com múltiplas
        // linhas (por exemplo, o resultado de _generateForStmt). Se empurrarmos
        // como um único elemento, apenas a primeira linha recebe a indentação.
        // Dividimos em linhas e indentamos cada uma.
        for (const sub of line.split('\n')) {
          if (sub.trim()) allLines.push(`  ${sub}`);
        }
      }
    }
    if (this.entryName) {
      // BUG-2: antes era `${this.entryName}();` dentro do IIFE, e o IIFE
      // devolvia undefined. Como a entry costuma ser `function*`, invocá-la
      // apenas criava o generator e o descartava — o corpo nunca executava.
      // O módulo agora DEVOLVE a entry (sem executar) em `__pixela_entry`
      // para que o runner a invoque e possa distinguir generator de execução
      // síncrona via `entryIsGenerator`.
      allLines.push(`  return typeof ${this.entryName} === 'function' ? ${this.entryName} : undefined;`);
    } else {
      allLines.push('  return undefined;');
    }
    allLines.push('})();');
    return allLines.join('\n') + '\n';
  }

  _generatePixHeader() {
    // As funções pix_* são definidas aqui como declarações de função locais
    // (sem prefixo window.) para que o código gerado seja autocontido.
    // No runner, essas mesmas funções são injetadas como parâmetros via
    // new Function; a declaração local é ignorada se houver parâmetro com
    // mesmo nome, e o corpo da função aqui serve como fallback/implementação.
    this.headerCode = `
// pixela.js runtime bindings — gerado automaticamente
// Funções livres que o código C++ compilado chamará

let pixCanvas = {
  width: 0,
  height: 0,
  pixels: new Uint32Array(160 * 96),
};

// LCG determinístico estilo ANSI C para rand()/srand().
// Determinístico entre execuções (ao contrário de Math.random()).
let __rand_state = 1;
function __rand() { __rand_state = (__rand_state * 1103515245 + 12345) & 0x7fffffff; return (__rand_state >> 16) & 0x7fff; }
function __rand_seed(s) { __rand_state = (s | 0) & 0x7fffffff; return 0; }

function pix_width() { return pixCanvas.width; }
function pix_height() { return pixCanvas.height; }
function pix_time() { return (performance.now() / 1000) | 0; }
function pix_clear() { pixCanvas.pixels.fill(0); }
function pix_present() { return 0; }

function pix_set(x, y, on, r, g, b) {
  x = x | 0; y = y | 0;
  if (x >= 0 && y >= 0 && x < pixCanvas.width && y < pixCanvas.height) {
    const idx = (y * pixCanvas.width + x) << 2;
    if (on) {
      pixCanvas.pixels[idx] = r;
      pixCanvas.pixels[idx + 1] = g;
      pixCanvas.pixels[idx + 2] = b;
    }
  }
};

function pix_line(x0, y0, x1, y1, r, g, b) {
  x0 = x0 | 0; y0 = y0 | 0; x1 = x1 | 0; y1 = y1 | 0;
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    pix_set(x0, y0, true, r, g, b);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
};

function pix_rect(x, y, w, h, filled, r, g, b) {
  x = x | 0; y = y | 0; w = w | 0; h = h | 0;
  if (filled) {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) pix_set(i, j, true, r, g, b);
  } else {
    pix_line(x, y, x + w - 1, y, r, g, b);
    pix_line(x, y + h - 1, x + w - 1, y + h - 1, r, g, b);
    pix_line(x, y, x, y + h - 1, r, g, b);
    pix_line(x + w - 1, y, x + w - 1, y + h - 1, r, g, b);
  }
};

function pix_circle(cx, cy, radius, filled, r, g, b) {
  cx = cx | 0; cy = cy | 0; radius = radius | 0;
  let x = radius, y = 0, err = 0;
  while (x >= y) {
    if (filled) {
      pix_line(cx - x, cy + y, cx + x, cy + y, r, g, b);
      pix_line(cx - x, cy - y, cx + x, cy - y, r, g, b);
      pix_line(cx - y, cy + x, cx + y, cy + x, r, g, b);
      pix_line(cx - y, cy - x, cx + y, cy - x, r, g, b);
    } else {
      pix_set(cx + x, cy + y, true, r, g, b);
      pix_set(cx + y, cy + x, true, r, g, b);
      pix_set(cx - y, cy + x, true, r, g, b);
      pix_set(cx - x, cy + y, true, r, g, b);
      pix_set(cx - x, cy - y, true, r, g, b);
      pix_set(cx + y, cy - x, true, r, g, b);
    }
    y += 1;
    if (err <= 0) err += 2 * y + 1;
    if (err > 0) { x -= 1; err -= 2 * x + 1; }
  }
};

function pix_triangle(x0, y0, x1, y1, x2, y2, r, g, b) {
  pix_line(x0, y0, x1, y1, r, g, b);
  pix_line(x1, y1, x2, y2, r, g, b);
  pix_line(x2, y2, x0, y0, r, g, b);
};
`.trim();
  }
}
