/**
 * worker.js — Web Worker entry point for the C++ → JavaScript compiler.
 * 
 * Este worker recebe mensagens da main thread e:
 * 1. Compila o código C++ fonte usando o pipeline completo
 * 2. Retorna o código JavaScript gerado, diagnostics, e/ou erros de runtime
 * 3. Gerencia o estado de execução (frames, heartbeat, etc.)
 */

import { SourceFile } from './source.js';
import { Lexer } from './lexer.js';
import { Parser } from './parser.js';
import { Sema } from './sema.js';
import { CodeGenerator } from './codegen.js';
import { Diagnostic, ErrorCodes } from './diagnostics.js';

// Estrutura de mensagens recebidas de main thread
const MESSAGE_TYPES = {
  INIT: 'init',
  COMPILE: 'compile',
  STOP: 'stop',
  RESIZE: 'resize'
};

// Respostas para main thread
const RESPONSE_TYPES = {
  DIAGNOSTICS: 'diagnostics',
  CODE: 'code',
  LOG: 'log',
  FINISHED: 'finished',
  HEARTBEAT: 'heartbeat'
};

// Inicialização: criar buffers, registrar funções, etc.
let initialized = false;
let cols = 80;
let rows = 24;

// Armazenamento de programas compilados (para reutilização)
const compiledCache = new Map();

// Função principal: processa mensagens do parent thread
self.onmessage = function(e) {
  const data = e.data;
  
  if (!data) return;
  
  const type = data.type;
  
  switch (type) {
    case MESSAGE_TYPES.INIT:
      self._handleInit(data);
      break;
    case MESSAGE_TYPES.COMPILE:
      self._handleCompile(data);
      break;
    case MESSAGE_TYPES.STOP:
      self._handleStop();
      break;
    case MESSAGE_TYPES.RESIZE:
      self._handleResize(data);
      break;
    default:
      self.postMessage({
        type: RESPONSE_TYPES.LOG,
        message: `Tipo de mensagem desconhecido: ${type}`,
        severity: 'error'
      });
  }
};

/**
 * Handle INIT message: setup the runtime environment.
 */
self._handleInit = function(data) {
  cols = data.cols || 80;
  rows = data.rows || 24;
  initialized = true;
  
  // Inicializar buffers e estado
  self.postMessage({
    type: RESPONSE_TYPES.HEARTBEAT,
    message: 'Worker initialized',
    cols,
    rows
  });
};

/**
 * Handle COMPILE message: compile C++ source to JS.
 */
self._handleCompile = function(data) {
  const source = data.source || '';
  const filename = data.filename || 'main.cpp';
  const options = data.options || {};
  
  try {
    // 1. Pré-processamento
    const preprocessor = new (require('./preprocessor.js').Preprocessor || (() => {}))(options.virtualHeaders);
    const preprocessed = preprocessor.process(source, filename);
    
    if (preprocessed.diagnostics.length > 0) {
      self.postMessage({
        type: RESPONSE_TYPES.DIAGNOSTICS,
        diagnostics: preprocessed.diagnostics,
        sourceFile: filename
      });
      return;
    }
    
    // 2. Lexing
    const lexer = new Lexer(preprocessed.text, filename);
    const tokenResult = lexer.tokenize();
    
    if (tokenResult.errors.length > 0) {
      self.postMessage({
        type: RESPONSE_TYPES.DIAGNOSTICS,
        diagnostics: tokenResult.errors,
        sourceFile: filename
      });
      return;
    }
    
    // 3. Parsing
    const sourceFile = new SourceFile(tokenResult.text, filename);
    const parser = new Parser(tokenResult.tokens, sourceFile);
    const parseResult = parser.parse();
    
    if (parseResult.diagnostics.length > 0) {
      self.postMessage({
        type: RESPONSE_TYPES.DIAGNOSTICS,
        diagnostics: parseResult.diagnostics,
        sourceFile: filename
      });
      return;
    }
    
    // 4. Semantic Analysis
    const sema = new Sema();
    const analyzed = sema.analyze(parseResult.ast, sourceFile);
    
    if (analyzed.diagnostics.length > 0) {
      self.postMessage({
        type: RESPONSE_TYPES.DIAGNOSTICS,
        diagnostics: analyzed.diagnostics,
        sourceFile: filename
      });
      return;
    }
    
    // 5. Code Generation
    const codegen = new CodeGenerator(options);
    const generated = codegen.generate(analyzed.ast, sourceFile);
    
    // 6. Retornar resultados
    self.postMessage({
      type: RESPONSE_TYPES.CODE,
      code: generated.code,
      map: generated.map,
      deps: generated.deps,
      sourceFile: filename,
      diagnostics: [], // nenhum erro semântico
      stats: {
        lines: generated.code.split('\n').length,
        size: new TextEncoder().encode(generated.code).length
      }
    });
    
  } catch (e) {
    self.postMessage({
      type: RESPONSE_TYPES.DIAGNOSTICS,
      diagnostics: [
        new Diagnostic('error', 'E0400', `Erro interno: ${e.message}`, { line: 1, column: 1 })
      ],
      sourceFile: filename
    });
  }
};

/**
 * Handle STOP message: terminate current operation.
 */
self._handleStop = function() {
  // Limpar qualquer estado ativo
  initialized = false;
  self.postMessage({
    type: RESPONSE_TYPES.FINISHED,
    exitCode: 0
  });
};

/**
 * Handle RESIZE message: resize the virtual canvas.
 */
self._handleResize = function(data) {
  cols = data.cols;
  rows = data.rows;
  
  self.postMessage({
    type: RESPONSE_TYPES.HEARTBEAT,
    message: 'Resized',
    cols,
    rows
  });
};