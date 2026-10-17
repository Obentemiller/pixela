/**
 * types.js — Sistema de tipos para o compilador C++ → JavaScript.
 * 
 * Define:
 * STATUS: NÃO VERIFICADO — escrito antes do front-end; pode ser reescrito
 * - Tipos escalares (int32, float64, bool, etc.)
 - Tipos compostos (struct, array, pointer, reference)
 - Conversões implícitas (promoção usual aritmética)
 - Ranking de sobrecargas
 */

export class Type {
  constructor(name, size, align, isSigned = true, isConst = false) {
    this.name = name; // nome legível (ex: "int", "float", "int&")
    this.size = size; // tamanho em bits (32, 64, etc.)
    this.align = align; // alinhamento em bits
    this.isSigned = isSigned;
    this.isConst = isConst;
    this.isPointer = false;
    this.isReference = false;
    this.isArray = false;
    this.elementType = null; // para arrays e ponteiros
    this.dimensions = []; // para arrays multidimensionais
  }

  /** Tipo escalar inteiro assinado de 32 bits */
  static get int32() { return new Type('int', 32, 32, true); }
  /** Tipo escalar inteiro sem sinal de 32 bits */
  static get uint32() { return new Type('unsigned int', 32, 32, false); }
  /** Tipo escalar de 64 bits signed */
  static get int64() { return new Type('long long', 64, 64, true); }
  /** Tipo escalar de 64 bits unsigned */
  static get uint64() { return new Type('unsigned long long', 64, 64, false); }
  /** Tipo float de 32 bits */
  static get float32() { return new Type('float', 32, 32, false); }
  /** Tipo double de 64 bits */
  static get float64() { return new Type('double', 64, 64, false); }
  /** Tipo booleano de 1 bit (em JS: boolean) */
  static get bool() { return new Type('bool', 8, 8, false); }
  /** Tipo char signed de 8 bits */
  static get charSigned() { return new Type('char', 8, 8, true); }
  /** Tipo char unsigned de 8 bits */
  static get charUnsigned() { return new Type('unsigned char', 8, 8, false); }
  /** Tipo void */
  static get void_() { return new Type('void', 0, 0, false); }
  /** Tipo size_t (unsigned 32 bits no nosso modelo) */
  static get size_t() { return new Type('size_t', 32, 32, false); }

  /** Cria tipo ponteiro */
  static pointerTo(inner) {
    const t = new Type('pointer', 32, 32, true);
    t.isPointer = true;
    t.elementType = inner;
    return t;
  }

  /** Cria tipo referência */
  static referenceTo(inner) {
    const t = new Type('reference', inner.size, inner.align, inner.isSigned);
    t.isReference = true;
    t.elementType = inner;
    return t;
  }

  /** Cria tipo array [N] */
  static arrayOf(inner, count) {
    const t = new Type(`array<${inner.name}[${count}]`, inner.size * count, inner.align, inner.isSigned);
    t.isArray = true;
    t.elementType = inner;
    t.dimensions = [count];
    return t;
  }

  /** Verifica se dois tipos são compatíveis */
  isCompatibleWith(other) {
    if (this.name === other.name) return true;
    if (this.isPointer && other.isPointer) return true; // ponteiros para o "mesmo tipo" são compatíveis
    if (this.isArray && other.isArray && this.elementType.isCompatibleWith(other.elementType)) {
      return this.dimensions.length === other.dimensions.length && 
             this.dimensions.every((d, i) => d === other.dimensions[i]);
    }
    return false;
  }

  /** Promoção usual aritmética (C++17 [expr.arith.conv]) */
  static usualArithmeticConversions(typeA, typeB) {
    // Regras simplificadas
    const hierarchy = ['long long', 'double', 'unsigned long long', 'float', 'unsigned int', 'int'];
    
    const idxA = hierarchy.indexOf(typeA.name);
    const idxB = hierarchy.indexOf(typeB.name);
    
    if (idxA < 0) return typeB;
    if (idxB < 0) return typeA;
    
    // O tipo com índice maior promove o outro
    if (idxA >= idxB) return typeA;
    return typeB;
  }

  toString() {
    if (this.isPointer) return `*${this.elementType.name}`;
    if (this.isReference) return `${this.elementType.name}&`;
    if (this.isArray) {
      let dim = '';
      for (const d of this.dimensions) dim += ` ${d}`;
      return `(${this.elementType.type}${dim})`;
    }
    return this.name;
  }
}

/**
 * Converter tipo C++ string para nosso Type object.
 * Aceita: int, double, float, bool, char, signed, unsigned, short, long, etc.
 */
export function cppTypeToJS(typeName) {
  const typeMap = {
    'int': Type.int32,
    'unsigned int': Type.uint32,
    'long': Type.int32, // no nosso modelo long = 32 bits
    'unsigned long': Type.uint32,
    'long long': Type.int64,
    'unsigned long long': Type.uint64,
    'float': Type.float32,
    'double': Type.float64,
    'bool': Type.bool,
    'char': Type.charSigned,
    'signed char': Type.charSigned,
    'unsigned char': Type.charUnsigned,
    'void': Type.void_,
    'size_t': Type.size_t,
  };
  
  return typeMap[typeName] || Type.int32; // default int
}

/**
 * Ranking de sobrecargas de função (C++ [over.over]).
 * Maior ranking vence. Empate = erro ambíguo.
 * Ordem: exact_match > promotion > conversion > user_defined
 */
export function rankOverloadConversion(fromType, toType) {
  // Mesmo tipo → exata
  if (fromType.isCompatibleWith(toType)) return 10; // exact match
  
  // Conversões promovidas (usual arithmetic conversions)
  const promoted = Type.usualArithmeticConversions(fromType, toType);
  if (promoted.isCompatibleWith(toType)) return 7; // promotion
  
  // Conversões implícitas (pointer conversion, etc.)
  return 3; // conversion
}