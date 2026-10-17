//! expect: valid
//! category: if-switch-init
//! note: switch com inicializador e múltiplos cases
void f(int v) { switch (int x = v) { case 1: case 2: break; default: break; } }
