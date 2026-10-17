void f(int n) { int* p = new int[n]; delete[] p; int* q = new int(1); delete q; }
