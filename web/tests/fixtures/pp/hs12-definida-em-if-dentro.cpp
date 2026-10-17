// hide-set: macro definida dentro de #if
// Uma macro so existe no preprocessador; o hide-set nao atravessa diretiva.
#if 1
#define X 7
#endif
X
