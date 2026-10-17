//! expect: valid
//! category: range-for
//! note: range-for com const
void f() { int a[3] = {1,2,3}; for (const int& x : a) { (void)x; } }
