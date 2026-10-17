#define PIXELA_EXPORT extern "C"
#define PIXELA_WASM_MAIN(F) PIXELA_EXPORT void f() { F(); }
