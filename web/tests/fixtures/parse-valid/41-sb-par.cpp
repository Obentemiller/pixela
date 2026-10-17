//! expect: valid
//! category: structured-bindings
//! note: structured binding de par
std::pair<int,int> p(1,2); auto [a,b] = p;
