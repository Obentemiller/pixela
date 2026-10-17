//! expect: valid
//! category: lambdas
//! note: lambda com captura
int a = 1; auto f = [a](int x) { return x + a; };
