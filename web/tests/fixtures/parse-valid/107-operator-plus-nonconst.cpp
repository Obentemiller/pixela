//! expect: valid
//! category: operator-const
//! note: operator+ não-const
struct S { int operator+(const S&) { return 1; } };
