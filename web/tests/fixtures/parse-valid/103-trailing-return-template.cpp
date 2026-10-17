//! expect: valid
//! category: trailing-return
//! note: trailing return em template
template<class T> auto f(T x) -> T { return x; }
