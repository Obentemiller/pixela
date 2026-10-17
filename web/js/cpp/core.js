/**
 * core.js — Core compilation pipeline.
 * 
 * Orchestrates the full compilation chain:
 *   Preprocessing → Lexical Analysis → Parsing → Semantic Analysis → Code Generation
 * 
 * This is the main entry point used by the Web Worker and by the application.
 */

import { Preprocessor } from './preprocessor.js';
import { Lexer } from './lexer.js';
import { Parser } from './parser.js';
import { Sema } from './sema.js';
import { CodeGenerator } from './codegen.js';
import { SourceFile } from './source.js';
import { Diagnostic, ErrorCodes } from './diagnostics.js';

/**
 * Compila código C++ para JavaScript.
 * 
 * @param {string} source - Código-fonte C++
 * @param {Object} options - Opções de compilação
 * @param {string} options.filename - Nome do arquivo (para mensagens de erro)
 * @param {Object} options.virtualHeaders - Headers virtuais para #include
 * @returns {{code: string, map: Object, deps: Set, diagnostics: Array<Diagnostic>}}
 */
export function compile(source, options = {}) {
  const filename = options.filename || 'main.cpp';
  const virtualHeaders = options.virtualHeaders || {};
  
  // Step 1: Pré-processamento
  const preprocessor = new Preprocessor(virtualHeaders);
  const preprocessed = preprocessor.process(source, filename);
  
  const diagnostics = [...preprocessed.diagnostics];
  
  if (preprocessed.diagnostics.length > 0) {
    return {
      code: '',
      map: {},
      deps: new Set(),
      diagnostics,
    };
  }
  
  // Step 2: Análise Lexical (Lexer)
  const lexer = new Lexer(preprocessed.text, filename);
  const tokenResult = lexer.tokenize();
  diagnostics.push(...tokenResult.errors);
  
  if (tokenResult.errors.length > 0) {
    return {
      code: '',
      map: {},
      deps: new Set(),
      diagnostics,
    };
  }
  
  // Step 3: Parsing
  const sourceFile = new SourceFile(tokenResult.text, filename);
  const parser = new Parser(tokenResult.tokens, sourceFile);
  const parseResult = parser.parse();
  diagnostics.push(...parseResult.diagnostics);
  
  if (parseResult.diagnostics.length > 0) {
    return {
      code: '',
      map: {},
      deps: new Set(),
      diagnostics,
    };
  }
  
  // Step 4: Análise Semântica (Sema)
  const sema = new Sema();
  const analyzed = sema.analyze(parseResult.ast, sourceFile);
  diagnostics.push(...analyzed.diagnostics);
  
  if (analyzed.diagnostics.length > 0) {
    return {
      code: '',
      map: {},
      deps: new Set(),
      diagnostics,
    };
  }
  
  // Step 5: Code Generation
  const codegen = new CodeGenerator({});
  const generated = codegen.generate(analyzed.ast, sourceFile);
  diagnostics.push(...generated.map ? [] : []); // codegen doesn't produce diagnostics directly
  
  return {
    code: generated.code,
    map: generated.map,
    deps: generated.deps,
    diagnostics,
  };
}