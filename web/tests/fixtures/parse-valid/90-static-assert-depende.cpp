//! expect: valid
//! category: static-assert
//! note: static_assert dependente
template<class T> struct S { static_assert(sizeof(T) == sizeof(T), "ok"); };
