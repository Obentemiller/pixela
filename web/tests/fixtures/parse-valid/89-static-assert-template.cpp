//! expect: valid
//! category: static-assert
//! note: static_assert em template
template<class T> struct S { static_assert(sizeof(T) > 0, "ok"); };
