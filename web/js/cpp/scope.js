/**
 * scope.js — Tabelas de símbolos, namespaces e lookup qualificado.
 * 
 * Gerencia:
 * STATUS: NÃO VERIFICADO — escrito antes do front-end; pode ser reescrito
 * - Escopos aninhados (blocos, functions, namespaces)
 - Namespaces (std, pix, usuário)
 - Palavras-clave `using namespace`, `using std::x`
 - Lookup de identificadores (encontrando o mais próximo/específico)
 - ADL mínimo (Argument-Dependent Lookup)
 */

import { Type, cppTypeToJS } from './types.js';

export class Symbol {
  constructor(name, type, kind, loc) {
    this.name = name;
    this.type = type; // Type object
    this.kind = kind; // 'variable', 'function', 'typedef', 'using', 'namespace', 'enum', 'template'
    this.loc = loc; // {line, column}
    this.isConst = false;
    this.isStatic = false;
    this.isTemplate = false;
    this.templateArgs = null; // para instâncias de template
  }

  toString() {
    return `${this.kind}: ${this.name} (${this.type})`;
  }
}

export class Namespace {
  constructor(name, parent = null) {
    this.name = name;
    this.parent = parent;
    this.symbols = new Map(); // nome -> Symbol
    this.children = new Map(); // nome -> Namespace
  }

  lookup(name, localOnly = false) {
    // Primeiro busca no escopo atual
    if (this.symbols.has(name)) {
      return this.symbols.get(name);
    }
    
    if (!localOnly && this.parent) {
      return this.parent.lookup(name, false);
    }
    
    return null;
  }

  insert(symbol) {
    this.symbols.set(symbol.name, symbol);
  }

  define(name, type, kind, loc) {
    // Se já existir no escopo atual, é redeclaração
    if (this.symbols.has(name)) {
      return false; // redeclaração
    }
    const sym = new Symbol(name, type, kind, loc);
    this.symbols.set(name, sym);
    return true;
  }
}

export class ScopeManager {
  constructor() {
    this.globalNS = new Namespace('global');
    this.currentNS = this.globalNS;
    this.scopes = [{ ns: this.globalNS, variables: new Map() }];
    this.namespaceStack = [this.globalNS];
  }
  
  /**
   * Entra em um novo escopo (bloco, function, namespace).
   */
  enterScope() {
    const parentNS = this.currentNS;
    const newNS = new Namespace(`anonymous_${this.scopes.length}`, parentNS);
    this.namespaceStack.push(newNS);
    this.currentNS = newNS;
    
    // Salvar variáveis do escopo pai para herança
    const parentVars = this.scopes[this.scopes.length - 1].variables;
    this.scopes.push({ variables: new Map(parentVars), ns: newNS });
  }
  
  /**
   * Sai do escopo atual.
   */
  exitScope() {
    if (this.scopes.length <= 1) return; // não sair do global
    
    this.scopes.pop();
    this.namespaceStack.pop();
    this.currentNS = this.namespaceStack.length > 0 ? this.namespaceStack[this.namespaceStack.length - 1] : this.globalNS;
  }
  
  /**
   * Declara uma variável no escopo atual.
   * @param {string} name - Nome da variável
   * @param {Type} type - Type object
   * @param {Object} loc - Localização
   * @param {boolean} isConst - Se é const
   * @param {boolean} isStatic - Se é static
   * @returns {Symbol} O símbolo criado
   */
  declareVariable(name, type, loc, { isConst = false, isStatic = false } = {}) {
    // Remover variável antiga se existir (para simplificação, ou poderia dar erro)
    this.currentNS.symbols.delete(name);
    
    const kind = isStatic ? 'static variable' : 'variable';
    const sym = new Symbol(name, type, kind, loc);
    sym.isConst = isConst;
    sym.isStatic = isStatic;
    
    this.currentNS.define(name, type, kind, loc);
    this.scopes[this.scopes.length - 1].variables.set(name, sym);
    
    return sym;
  }
  
  /**
   * Declara uma função no escopo atual.
   */
  declareFunction(name, retType, params, loc) {
    // params: Array<{name, type}>
    const kind = 'function';
    const sigType = { retType, params };
    const sym = new Symbol(name, sigType, kind, loc);
    
    this.currentNS.define(name, sigType, kind, loc);
    this.scopes[this.scopes.length - 1].variables.set(name, sym);
    
    return sym;
  }
  
  /**
   * Lookup de identificador — encontra o símbolo mais próximo.
   * Retorna {symbol, fromGlobal} onde fromGlobal indica se veio do escopo global.
   */
  lookupIdent(name) {
    // Busca da corrente para baixo (inner -> outer)
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].ns.symbols.has(name)) {
        return { symbol: this.scopes[i].ns.symbols.get(name), scopeLevel: i };
      }
    }
    
    // Busca em namespaces
    let nsResult = this.currentNS.lookup(name, true);
    if (nsResult) return { symbol: nsResult, scopeLevel: -1 };
    
    return { symbol: null, scopeLevel: -1 };
  }
  
  /**
   * Using directive: `using namespace std`
   */
  enterNamespace(nsName) {
    if (this.currentNS.children.has(nsName)) {
      this.currentNS = this.currentNS.children.get(nsName);
      return;
    }
    
    const newNS = new Namespace(nsName, this.currentNS);
    this.currentNS.children.set(nsName, newNS);
    this.currentNS = newNS;
    this.namespaceStack.push(newNS);
    this.scopes.push({ ns: newNS, variables: new Map() });
  }
  
  /**
   * Using declaration: `using std::cout`
   */
  usingDeclaration(name) {
    // Procura no namespace corrente e pais
    let found = this.currentNS.lookup(name, true);
    if (!found && this.currentNS.parent) {
      found = this.currentNS.parent.lookup(name, true);
    }
    if (found) {
      this.currentNS.define(name, found.type, 'using declaration', found.loc);
      return true;
    }
    return false;
  }
  
  /**
   * Verifica se um nome está declarado em algum escopo.
   */
  isDeclared(name) {
    return this.lookupIdent(name).symbol !== null;
  }
  
  /**
   * Obter tipo de um nome.
   */
  getTypeOf(name) {
    const result = this.lookupIdent(name);
    return result.symbol ? result.symbol.type : null;
  }
}