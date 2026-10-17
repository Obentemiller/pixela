#if __has_include("presente.hpp")
#include "presente.hpp"
#define TEM 1
#else
#define TEM 0
#endif
int f() { return TEM; }
