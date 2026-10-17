//! expect: valid
//! category: lambdas
//! note: captura por referência
int a = 1; auto f = [&a](int x) { return x + a; };
