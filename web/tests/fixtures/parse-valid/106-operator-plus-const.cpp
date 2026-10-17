//! expect: valid
//! category: operator-const
//! note: operator+ const
struct S { int operator+(const S&) const { return 1; } };
