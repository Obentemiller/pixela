//! expect: valid
//! category: operator-const
//! note: operator+ friend
struct S { friend int operator+(const S&, const S&) { return 1; } };
