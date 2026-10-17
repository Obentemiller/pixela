//! expect: valid
//! category: structured-bindings
//! note: múltiplos structured bindings
struct S { int a; int b; }; S s{1,2}; auto [x,y] = s; auto [p,q] = s;
