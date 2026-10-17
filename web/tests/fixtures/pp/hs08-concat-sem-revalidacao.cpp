// hide-set + ## : token conctado nao reexpande
// `#define CAT(a,b) a##b` com `CAT(fo,o)` forma `foo` e o token novo NAO e reexpandido.
#define CAT(a, b) a ## b
CAT(fo, o)
