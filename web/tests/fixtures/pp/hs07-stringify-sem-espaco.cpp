// hide-set + stringify: # normaliza espacos
// `#define S(x) #x` com varios espacos: o resultado tem espacos SIMPLES.
#define S(x) #x
S(  a   +   b  )
