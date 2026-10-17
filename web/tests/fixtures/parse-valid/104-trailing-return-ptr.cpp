//! expect: valid
//! category: trailing-return
//! note: trailing return ponteiro
auto f(int x) -> int* { return &x; }
