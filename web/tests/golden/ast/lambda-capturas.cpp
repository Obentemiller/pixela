int f() { auto a = [=] { return 1; }; auto b = [&] { return 2; }; auto c = [this] { return 3; }; return a() + b() + c(); }
