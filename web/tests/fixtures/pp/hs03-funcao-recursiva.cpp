// hide-set: #define f(x) f(x+1)
// A expansao de `f(1)` produz `f(1+1)`; o `f` DENTRO do corpo nao pode ser reexpandido.
#define f(x) f(x + 1)
f(1)
