// hide-set: marca morre no fim da expansao interna
// `#define A B` / `#define B A` / `A`: o A de dentro de B nao esta marcado quando a expansao interna de B termina.
#define A B
#define B A
A
