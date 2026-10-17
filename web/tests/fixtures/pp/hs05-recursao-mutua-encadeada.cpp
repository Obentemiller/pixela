// hide-set: recursao mutua de 3
// A -> B -> C -> A: o hide-set impede a volta.
#define A B
#define B C
#define C A
A
