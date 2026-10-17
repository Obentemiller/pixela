//! expect: valid
//! category: init-lists
//! note: BraceInit aninhado
struct S { int a; int b; }; S s[2] = {{1, 2}, {3, 4}};
