int f() { auto l = [](int x) mutable { return x; }; return l(1); }
