//! expect: valid
//! category: structured-bindings
//! note: structured binding de tupla
std::tuple<int,int> t(1,2); auto [a,b] = t;
