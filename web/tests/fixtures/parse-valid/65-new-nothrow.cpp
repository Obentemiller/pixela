//! expect: valid
//! category: new-delete
//! note: new nothrow
int* p = new (std::nothrow) int(1);
