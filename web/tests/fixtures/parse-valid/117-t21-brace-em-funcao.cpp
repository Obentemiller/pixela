//! expect: valid
//! category: t21
//! note: init-list como argumento de funcao comum
struct Color { int r; int g; int b; };
void pinta(Color c) { (void)c; }
void f() { pinta({10, 20, 30}); }
