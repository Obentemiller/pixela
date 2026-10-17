// hide-set: recursao mutua #define X Y / #define Y X
// X -> Y -> X: com hide-set a segunda expansao de X nao acontece. Resultado: Y.
#define X Y
#define Y X
X
