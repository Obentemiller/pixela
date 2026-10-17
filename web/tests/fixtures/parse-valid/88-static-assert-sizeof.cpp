//! expect: valid
//! category: static-assert
//! note: static_assert com sizeof
static_assert(sizeof(int) == 4, "ok");
