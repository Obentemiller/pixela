//! expect: valid
//! category: t21
//! note: return {..} — init-list como valor de retorno
struct Color { int r; int g; int b; };
Color faz() { return {1, 2, 3}; }
