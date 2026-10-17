//! expect: valid
//! category: templates
//! note: especialização total
template<class T> struct S { T x; }; template<> struct S<int> { int y; };
