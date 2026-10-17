//! expect: valid
//! category: t21
//! note: template<class... Args> — variadico
template<class... Args> struct S { int n; };
S<int, char> s{1};
