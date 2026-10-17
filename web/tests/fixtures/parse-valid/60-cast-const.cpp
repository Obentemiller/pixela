//! expect: valid
//! category: casts
//! note: const_cast
const int* p = new int(1); int* q = const_cast<int*>(p);
