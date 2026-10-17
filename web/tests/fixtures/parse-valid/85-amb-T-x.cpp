//! expect: valid
//! category: desambiguacao
//! note: T(x); com T sendo tipo
struct T { T(int) {} }; T x(1);
