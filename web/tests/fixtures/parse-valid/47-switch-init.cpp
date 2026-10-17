//! expect: valid
//! category: if-switch-init
//! note: switch com inicializador
void f(int v) { switch (int x = v) { case 1: break; } }
