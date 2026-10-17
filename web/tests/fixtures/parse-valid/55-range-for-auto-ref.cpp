//! expect: valid
//! category: range-for
//! note: range-for com auto&
void f() { int a[3] = {1,2,3}; for (auto& x : a) { x = 0; } }
