// hide-set: #define A A (uso em declaracao)
// Sem hide-set, `int x = A;` reexpande A ate o limite de profundidade.
#define A A
int x = A;
