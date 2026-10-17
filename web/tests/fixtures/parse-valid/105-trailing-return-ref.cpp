//! expect: valid
//! category: trailing-return
//! note: trailing return referência
auto f(int x) -> int& { return x; }
