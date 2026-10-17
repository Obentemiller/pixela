//! expect: valid
//! category: structured-bindings
//! note: structured binding de struct
struct S { int a; int b; }; S s{1,2}; auto [x,y] = s;
