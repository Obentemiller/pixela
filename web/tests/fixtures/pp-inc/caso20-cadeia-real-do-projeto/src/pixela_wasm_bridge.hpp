#pragma once
#include "motor.hpp"
#define PIXELA_EXPORT extern "C"
#define PIXELA_WASM_MAIN(F) PIXELA_EXPORT void run() { F(); }
