//! expect: valid
//! category: range-for
//! note: range-for com referência
void f() { int a[3] = {1,2,3}; for (int& x : a) { x = 0; } }
