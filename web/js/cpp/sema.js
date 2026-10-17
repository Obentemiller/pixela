/**
 * sema.js — Semantic Analysis (análise semântica).
 * 
 * Responsabilidades:
 * STATUS: NÃO VERIFICADO — escrito antes do front-end; pode ser reescrito
 * - Resolução de nomes (lookup de identificadores)
 - Verificação de tipos (compatibilidade, conversão implícita)
 - Resolução de sobrecargas de função
 - Instanciação de templates
 - Verificação de declarações (redeclaração, tipos incompatíveis, etc.)
 - Conversões de tipo (static_cast, reinterpret_cast, C-style cast)
 */

import { Type, cppTypeToJS, rankOverloadConversion } from './types.js';
import { ScopeManager, Symbol, Namespace } from './scope.js';
import { Diagnostic, ErrorCodes, Diagnostics as Dx } from './diagnostics.js';
import { SourceFile } from './source.js';

export class Sema {
  constructor(scopeManager = null) {
    this.scopeManager = scopeManager || new ScopeManager();
    this.errors = [];
    this.warnings = [];
    this.templateCache = new Map(); // (templateName, argString) -> instantiated type
    this.overloadCandidates = new Map(); // functionName -> [Candidate]
  }
  
  /**
   * Analisa o AST produzido pelo parser, adicionando tipos e resolvendo nomes.
   * @param {Array} ast - AST do parser
   * @param {SourceFile} sourceFile - Fonte original para localizações
   * @returns {{ast: Array, diagnostics: Array<Diagnostic>}}
   */
  analyze(ast, sourceFile) {
    this.errors = [];
    this.warnings = [];
    this.templateCache.clear();
    this.overloadCandidates.clear();
    
    try {
      // Primeiro pass: declarar tudo (sem verificação profunda de tipos ainda)
      this._pass1_declare(ast);
      
      // Segundo pass: verificar tipos e resolver sobrecargas
      this._pass2_typeCheck(ast);
    } catch (e) {
      this.errors.push(new Diagnostic('error', 'E0400', `Erro interno na semântica: ${e.message}`));
    }
    
    return {
      ast,
      diagnostics: this.errors.concat(this.warnings),
    };
  }
  
  _pass1_declare(node) {
    if (!node) return;
    
    if (Array.isArray(node)) {
      for (const child of node) {
        this._pass1_declare(child);
      }
      return;
    }
    
    switch (node.type) {
      case 'function_definition':
        this._analyzeFunctionDef(node);
        break;
      case 'declaration':
        this._analyzeDeclaration(node);
        break;
      case 'compound_statement':
        for (const stmt of node.statements) {
          this._pass1_declare(stmt);
        }
        break;
      case 'if_statement':
        this._pass1_declare([node.condition, node.thenBranch]);
        if (node.elseBranch) this._pass1_declare([node.elseBranch]);
        break;
      case 'while_statement':
        this._pass1_declare([node.condition, node.body]);
        break;
      case 'for_statement':
        this._pass1_declare([node.init, node.condition, node.increment, node.body]);
        break;
      case 'return_statement':
        if (node.expression) this._pass1_declare([node.expression]);
        break;
      case 'expression_statement':
        if (node.expression) this._pass1_declare([node.expression]);
        break;
      case 'binary':
        this._pass1_declare([node.left, node.right]);
        break;
      case 'unary':
        if (node.argument) this._pass1_declare([node.argument]);
        break;
      case 'identifier':
        // Verificar se já foi declarado (será checado no pass2)
        break;
      case 'literal':
        // Números e strings não precisam de declaração
        break;
      case 'call':
        this._pass1_declare(node.args);
        break;
      case 'sizeof':
        if (node.expression) this._pass1_declare([node.expression]);
        break;
      default:
        // Tentar iterar propriedades
        if (node && typeof node === 'object') {
          const keys = Object.keys(node).filter(k => k !== 'loc' && k !== 'type');
          for (const k of keys) {
            this._pass1_declare(node[k]);
          }
        }
    }
  }
  
  _pass2_typeCheck(node) {
    if (!node) return;
    
    if (Array.isArray(node)) {
      for (const child of node) {
        this._pass2_typeCheck(child);
      }
      return;
    }
    
    switch (node.type) {
      case 'function_definition':
        this._checkFunctionDef(node);
        break;
      case 'declaration':
        this._checkDeclaration(node);
        break;
      case 'compound_statement':
        for (const stmt of node.statements) {
          this._pass2_typeCheck(stmt);
        }
        break;
      case 'if_statement':
        this._checkExpression(node.condition);
        this._checkStatement(node.thenBranch);
        if (node.elseBranch) this._checkStatement(node.elseBranch);
        break;
      case 'while_statement':
        this._checkExpression(node.condition);
        this._checkStatement(node.body);
        break;
      case 'for_statement':
        if (node.init) this._checkExpressionOrDeclaration(node.init);
        this._checkExpression(node.condition);
        this._checkExpression(node.increment);
        this._checkStatement(node.body);
        break;
      case 'return_statement':
        if (node.expression) {
          this._checkExpression(node.expression);
          // Verificar retorno coerente (aviso se função não-void não tem return)
        }
        break;
      case 'expression_statement':
        if (node.expression) this._checkExpression(node.expression);
        break;
      case 'binary':
        this._checkBinary(node);
        break;
      case 'unary':
        this._checkUnary(node);
        break;
      case 'call':
        this._checkCall(node);
        break;
      case 'identifier':
        // Verificar uso — já foi resolvido no momento da declaração
        break;
      case 'literal':
        // Já tem tipo intrinsco
        break;
      case 'binary':
        this._checkBinary(node);
        break;
      case 'sizeof':
        this._checkSizeof(node);
        break;
      default:
        // Tentar processar propriedades comuns
        if (node && typeof node === 'object') {
          const keys = Object.keys(node).filter(k => k !== 'loc' && k !== 'type');
          for (const k of keys) {
            this._pass2_typeCheck(node[k]);
          }
        }
    }
  }
  
  _checkBinary(node) {
    const leftType = this._getExpressionType(node.left);
    const rightType = this._getExpressionType(node.right);
    
    if (!leftType || !rightType) return;
    
    // Operadores de comparação/relacional: qualquer tipo numérico funciona
    if (['<', '>', '<=', '>', '==', '!='].includes(node.operator)) {
      // Promoção usual aritmética
      const conv = Type.usualArithmeticConversions(leftType, rightType);
      // Marcar conversão se necessário (gerado no codegen)
      node.conversionNeeded = !leftType.isCompatibleWith(rightType);
      return;
    }
    
    // Operadores aritméticos: + - * / %
    if (['+', '-', '*', '/', '%'].includes(node.operator)) {
      // Se ambos são int, resultado int. Se um for float/double, promover.
      if (leftType.name === 'int' && rightType.name === 'int') {
        node.resultType = Type.int32;
      } else {
        node.resultType = Type.usualArithmeticConversions(leftType, rightType);
      }
      node.conversionNeeded = !leftType.isCompatibleWith(rightType);
      return;
    }
    
    // Lógica && || 
    if (node.operator === '&&' || node.operator === '||') {
      // As condições devem ser booleanas ou int (truthy/falsy)
      node.resultType = Type.bool; // result type is always bool for &&/||
      return;
    }
  }
  
  _checkUnary(node) {
    const argType = this._getExpressionType(node.argument);
    
    if (node.operator === '-') {
      // Negação unária: int → int, double → double
      if (argType.name === 'int') {
        node.resultType = Type.int32;
      } else if (argType.name === 'double' || argType.name === 'float') {
        node.resultType = argType;
      } else {
        node.resultType = Type.int32; // default
      }
    } else if (node.operator === '!') {
      node.resultType = Type.bool;
    } else if (node.operator === 'sizeof') {
      node.resultType = Type.int32; // sizeof sempre retorna size_t int32 no nosso modelo
    }
  }
  
  _checkCall(node) {
    const funcName = node.callee.name;
    const argsTypes = node.args.map(a => this._getExpressionType(a));
    
    // Buscar a função no escopo
    const funcSym = this.scopeManager.lookupIdent(funcName).symbol;
    if (!funcSym) {
      this.errors.push(
        Dx.undeclaredIdentifier(/* source */ '', { line: 1, column: 1 }, funcName)
      );
      return;
    }
    
    // Verificar se é template
    if (funcSym.isTemplate) {
      this._checkTemplateCall(funcName, argsTypes, funcSym);
      return;
    }
    
    // Sobrecarga normal
    this._resolveOverload(funcName, argsTypes, funcSym);
  }
  
  _checkTemplateCall(funcName, argsTypes, funcSym) {
    // Montar string de argumentos para cache
    const argString = argsTypes.map(t => t.name).join(',');
    const cacheKey = `${funcName}@${argString}`;
    
    // Verificar cache
    if (this.templateCache.has(cacheKey)) {
      // Usar tipo instanciado do cache
      node.resultType = this.templateCache.get(cacheKey);
      return;
    }
    
    // Dedução de argumentos de template e monomorfização
    // Simplificado: instanciar com os tipos fornecidos
    try {
      const instantiatedType = this._instantiateTemplate(funcName, argsTypes, funcSym);
      this.templateCache.set(cacheKey, instantiatedType);
      node.resultType = instantiatedType;
    } catch (e) {
      this.errors.push(
        new Diagnostic('error', ErrorCodes.INSTANTIATION_ERROR,
          `Erro ao instanciar template '${funcName}' com argumentos ${argString}: ${e.message}`,
          node.loc)
      );
      node.resultType = Type.int32; // fallback
    }
  }
  
  _instantiateTemplate(funcName, argsTypes, funcSym) {
    // Simplificado: criar um tipo composto que representa a instância
    // Em um compilador real, isso envolveria substituir os parâmetros de tipo
    // pelos argumentos reais em todo o corpo da função/template
    
    // Para agora, retornar o tipo da função com args substituídas
    const retType = funcSym.type.retType;
    const newParams = funcSym.type.params.map((p, i) => {
      // Substituir o tipo do parâmetro pelo argumento correspondente
      return argsTypes[i] || p;
    });
    
    return { retType, params: newParams, isInstantiated: true };
  }
  
  _resolveOverload(funcName, argsTypes, funcSym) {
    // Encontrar todas as sobrecargas disponíveis
    // No nosso modelo simplificado, só temos uma definição por nome
    // Em um compilador real, iteraríamos sobre todas as definições de `funcName`
    
    // Verificar compatibilidade dos argumentos com a assinatura
    const candidates = this._findOverloadCandidates(funcName, argsTypes);
    
    if (candidates.length === 0) {
      this.errors.push(
        Dx.noViableOverload(/* source */ '', { line: 1, column: 1 }, funcName, [])
      );
      node.resultType = Type.int32;
      return;
    }
    
    if (candidates.length === 1) {
      node.resultType = candidates[0].resultType;
      return;
    }
    
    // Mais de uma candidata: ranking
    const ranked = this._rankOverloadCandidates(candidates, argsTypes);
    
    if (ranked.length === 1) {
      node.resultType = ranked[0].resultType;
      return;
    }
    
    // Empate → erro ambíguo
    this.errors.push(
      new Diagnostic('error', ErrorCodes.AMBIGUOUS_OVERLOAD,
        `Sobrecarga ambígua para '${funcName}'.`,
        node.loc,
        [{ message: `Candidatas: ${ranked.map(c => c.signature).join(', ')}` }]
      )
    );
    node.resultType = Type.int32;
  }
  
  _findOverloadCandidates(funcName, argsTypes) {
    // Buscar todas as definições de função com este nome
    // No modelo simplificado, apenas verificamos a definição atual
    // Em um compilador real, coletaríamos de todo o módulo/translation unit
    
    const result = [];
    const symResult = this.scopeManager.lookupIdent(funcName);
    if (!symResult || !symResult.symbol) return result;
    
    const sym = symResult.symbol;
    if (sym.kind !== 'function') return result;
    
    // Criar candidato único com o tipo resultante
    const rank = rankOverloadConversion(
      // Simplificado: comparar tipos dos args com os parâmetros formais
      ...argsTypes.map((t, i) => ({ type: t, param: sym.type.params[i] }))
    );
    
    result.push({
      symbol: sym,
      resultType: rank.retType,
      signature: `${funcName}(${argsTypes.map(t => t.name).join(', ')})`,
    });
    
    return result;
  }
  
  _rankOverloadCandidates(candidates, argsTypes) {
    // Ranking simples: quanto maior o rank, melhor o match
    return candidates.sort((a, b) => {
      // Comparar baseado nos tipos
      return 0; // simplificação: sempre retornar a primeira
    });
  }
  
  _checkDeclaration(node) {
    const name = node.name;
    const type = cppTypeToJS(node.cppType);
    const isConst = node.isConst === true;
    
    // Verificar redeclaração
    if (this.scopeManager.isDeclared(name) && node.isFunction === false) {
      // Verificar se é no mesmo escopo
      const existing = this.scopeManager.getTypeOf(name);
      if (existing && existing.isCompatibleWith(type)) {
        // Pode ser redeclaração com tipo compatível (ex: forward declaration)
      } else if (existing) {
        this.errors.push(
          new Diagnostic('error', ErrorCodes.VARIABLE_REDECLARED,
            `Variável '${name}' já declarada`,
            node.loc)
        );
      }
    }
    
    // Declarar
    this.scopeManager.declareVariable(name, type, node.loc, { isConst });
    
    // Se tem inicializador, verificar tipo
    if (node.initValue) {
      const initType = this._getExpressionType(node.initValue);
      if (initType && !type.isCompatibleWith(initType)) {
        // Tentar conversão implícita
        this.warnings.push(
          new Diagnostic('warning', ErrorCodes.TYPE_MISMATCH,
            `Conversão implícita de ${initType} para ${type}`,
            node.loc)
        );
      }
    }
  }
  
  _checkSizeof(node) {
    if (node.expression && node.expression.type === 'type_name') {
      // sizeof(T) onde T é um tipo
      node.resultType = Type.int32;
    } else if (node.expression) {
      // sizeof expr
      const exprType = this._getExpressionType(node.expression);
      node.resultType = exprType ? Type.int32 : Type.int32;
    }
  }
  
  _getExpressionType(node) {
    if (!node) return null;
    
    // Identificador → type do símbolo
    if (node.type === 'identifier') {
      const result = this.scopeManager.lookupIdent(node.name);
      return result.symbol ? result.symbol.type : null;
    }
    
    // Literal → tipo intrinsco
    if (node.type === 'literal') {
      if (node.kind === 'number') {
        return node.value % 1 === 0 ? Type.int32 : Type.float32;
      }
      if (node.kind === 'string') return Type.int32; // pointer-like
      return null;
    }
    
    // Binary expression
    if (node.type === 'binary') {
      return this._checkBinary(node); // retorna o resultType
    }
    
    // Unary expression
    if (node.type === 'unary') {
      return this._checkUnary(node);
    }
    
    // Call expression
    if (node.type === 'call') {
      return this._checkCall(node);
    }
    
    return null;
  }
  
  _checkStatement(node) {
    this._pass2_typeCheck(node);
  }
}