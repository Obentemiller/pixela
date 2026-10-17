//! expect: valid
//! category: t21
//! note: new T{...} — init-list em new de objeto
struct S { int a; int b; };
S* s = new S{1, 2};
