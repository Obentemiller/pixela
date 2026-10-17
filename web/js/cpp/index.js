/**
 * index.js — API pública do compilador C++ → JavaScript.
 * 
 * Exports the compile function that the main application will use.
 * All modules are ES modules that can be imported individually or via this entry point.
 */

export { compile } from './core.js';
export { SourceFile } from './source.js';
export { Diagnostic, ErrorCodes } from './diagnostics.js';
export { Token } from './lexer.js';
export { Type, cppTypeToJS } from './types.js';
export { Sema } from './sema.js';
export { CodeGenerator } from './codegen.js';
export { Lexer } from './lexer.js';
export { Parser } from './parser.js';
export { Preprocessor } from './preprocessor.js';