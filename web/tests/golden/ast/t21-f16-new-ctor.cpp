struct T { T(int); };
void f() { T *a = new T(1); T *b = new T{1}; }
