//! expect: valid
//! category: range-for
//! note: range-for simples
void f() { int a[3] = {1,2,3}; for (int x : a) { (void)x; } }
