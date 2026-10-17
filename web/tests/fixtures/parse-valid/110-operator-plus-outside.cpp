//! expect: valid
//! category: operator-const
//! note: operator+ fora da classe
struct S {}; int operator+(const S&, const S&) { return 1; }
