// hide-set: argumento que contem o nome da propria macro
// `#define F(x) x` com `F(F(1))`: o `F` interno expande para `1` e nao para `F(1)`.
#define F(x) x
F(F(1))
