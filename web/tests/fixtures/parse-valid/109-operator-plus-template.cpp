//! expect: valid
//! category: operator-const
//! note: operator+ em template
template<class T> struct S { T operator+(const S&) const { return T(); } };
