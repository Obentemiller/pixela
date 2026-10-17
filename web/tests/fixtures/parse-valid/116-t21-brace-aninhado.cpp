//! expect: valid
//! category: t21
//! note: init-list aninhado com designadores-free
struct P { int x; int y; };
struct L { P a; P b; };
L l = { {1, 2}, {3, 4} };
