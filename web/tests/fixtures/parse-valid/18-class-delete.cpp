//! expect: valid
//! category: classes
//! note: = delete
struct S { S(const S&) = delete; S& operator=(const S&) = delete; };
