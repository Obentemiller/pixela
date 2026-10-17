//! expect: valid
//! category: classes
//! note: operator
struct S { int operator+(const S& o) const { return 1; } };
