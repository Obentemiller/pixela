/**
 * tests/unit/parser-cases.mjs — corpus do parser.
 *
 * O corpus VÁLIDO tem duas fontes:
 *   - trechos escritos à mão, com o que o g++ -std=c++17 aceita;
 *   - trechos extraídos dos arquivos reais do projeto.
 *
 * O corpus de INVÁLIDOS foi conferido contra `g++ -std=c++17 -fsyntax-only`:
 * cada um é um programa que o g++ REJEITA. `tests/tools/diff-parse.mjs`
 * reexecuta essa conferência; se o g++ passar a aceitar algum deles, o
 * diferencial acusa.
 */

// ---------------------------------------------------------------- válidos

export const CASOS_VALIDOS = [
  // --- declarações simples
  'int a;',
  'int a = 1;',
  'int a, b, c;',
  'int a = 1, b = 2;',
  'const int a = 1;',
  'static const int a = 1;',
  'unsigned long long x = 1;',
  'float f = 1.5f;',
  'double d = 1.5;',
  'long double ld = 1.5L;',
  'bool ok = true;',
  'bool nao = false;',
  'char c = \'a\';',
  'char* p = "texto";',
  'const char* s = "abc";',
  'int* nulo = nullptr;',
  'int arr[10];',
  'int arr[3] = {1, 2, 3};',
  'int arr[] = {1, 2, 3};',
  'int matriz[2][3];',
  'int* ptrs[5];',
  'void* v;',
  'auto x = 42;',
  'auto& r = x;',
  'const auto& cr = x;',
  'decltype(x) y;',

  // --- ponteiros e referências
  'int* p;',
  'int** pp;',
  'int& r = x;',
  'int&& rr = std::move(x);',
  'const int* cp;',
  'int* const pc = p;',
  'const int* const cpc = p;',
  'volatile int vi;',
  'int f(int* p, const int& r);',

  // --- funções
  'int f();',
  'void f();',
  'int f(int);',
  'int f(int a);',
  'int f(int a, int b);',
  'int f(int a, int b = 0);',
  'int f(const int& a);',
  'void f(void* p);',
  'inline int f() { return 1; }',
  'constexpr int f() { return 1; }',
  'static int f() { return 1; }',
  'int f() { return 1; }',
  'int f(int a) { return a * 2; }',
  'int f(int a, int b) { return a + b; }',
  'void f() {}',
  'int f() { if (x) return 1; return 0; }',
  'int f() { for (int i = 0; i < 10; ++i) { } return 0; }',
  'int f() { int s = 0; while (s < 10) ++s; return s; }',
  'int f() { do { } while (false); return 0; }',
  'int f(int a) { switch (a) { case 1: return 1; case 2: return 2; default: return 0; } }',
  'int f(int a) { switch (a) { case 1: { break; } default: break; } return 0; }',
  'int f() { int a[3]; return a[0]; }',
  'int f(int* p) { return *p; }',
  'int f(int* p) { return p[1]; }',
  'void f(int* p) { *p = 1; }',
  'int f(int n) { int* p = new int[n]; delete[] p; return 0; }',
  'int f() { return static_cast<int>(3.5); }',
  'int f(int a) { return (int)a; }',
  'int f() { return sizeof(int); }',
  'int f(int a) { return sizeof a; }',

  // --- classes e structs
  'struct S { int x; };',
  'struct S { int x; int y; };',
  'struct S { int x; void m() {} };',
  'class C { public: int x; };',
  'class C { private: int x; };',
  'class C { int x; public: int get() { return x; } };',
  'class C { public: C() {} };',
  'class C { public: C(int x) : x_(x) {} private: int x_; };',
  'struct S { int x; }; struct T { S s; };',
  'struct S {}; struct T : S {};',
  'struct S {}; struct T : public S {};',
  'class C { public: virtual void m() {} };',
  'class C { public: virtual ~C() {} };',
  'struct S { int x = 1; };',
  'struct S { S() = default; };',
  'struct S { S(const S&) = delete; };',
  'struct S { int a : 1; };',
  'struct S { operator int() { return 1; } };',

  // --- enums
  'enum E { A, B, C };',
  'enum E { A = 1, B = 2 };',
  'enum class E { A, B };',
  'enum class E : int { A = 1 };',
  'enum struct E { A };',
  'enum E { A, B }; int x = A;',

  // --- namespaces
  'namespace n { int a; }',
  'namespace n { int a; int b; }',
  'namespace n { int f(); } namespace n { int g(); }',
  'namespace { int a; }',
  'namespace n { namespace m { int a; } }',
  'using namespace n;',
  'using n::f;',
  'using Alias = int;',

  // --- typedef e usando
  'typedef int I;',
  'typedef int* P;',
  'typedef unsigned int U;',
  'typedef struct S T;',
  'using I = int;',
  'using P = int*;',

  // --- templates
  'template<typename T> T f(T a) { return a; }',
  'template<class T> struct S { T x; };',
  'template<typename T, typename U> void f(T a, U b);',
  'template<typename T> struct S { T x; }; S<int> s;',
  'template<int N> struct S { int a[N]; };',
  'template<typename T> struct S { T x; }; S<int>* p;',
  'template<typename T> T f(T a) { return a; } template<typename T> T g(T a) { return f(a); }',

  // --- expressões
  'int x = 1 + 2 * 3;',
  'int x = (1 + 2) * 3;',
  'int x = 1 / 2 % 3;',
  'int x = 1 < 2 && 3 > 4;',
  'int x = 1 == 2 || 3 != 4;',
  'int x = 1 << 2 | 3 >> 4;',
  'int x = 1 & 2 ^ 3;',
  'int x = ~1;',
  'int x = !0;',
  'int x = -1;',
  'int x = +1;',
  'int x = 1 ? 2 : 3;',
  'int x = a ? b ? 1 : 2 : 3;',
  'int f() { int a = 1, b = 2; return (a, b); }',
  'int f() { int a = 0; a += 1; a -= 1; a *= 2; a /= 2; a %= 2; return a; }',
  'int f() { int a = 1; a <<= 1; a >>= 1; a &= 1; a |= 1; a ^= 1; return a; }',
  'int f() { int a = 1; ++a; a++; --a; a--; return a; }',
  'int f() { int a[3]; return a[0] + a[1]; }',
  'struct S { int x; }; int f(S s) { return s.x; }',
  'struct S { int x; }; int f(S* s) { return s->x; }',
  'struct S { static int f(); }; int g() { return S::f(); }',
  'struct A { int f(); }; struct B : A { int g() { return f(); } };',
  'int f() { return (1 + 2) * 3; }',
  'int f() { int a = 1; { int b = 2; a += b; } return a; }',

  // --- lambdas
  'int f() { auto l = [](int x) { return x * 2; }; return l(1); }',
  'int f() { auto l = [](int x) { return x; }; return l(1); }',
  'int f() { auto l = [] { return 1; }; return l(); }',
  'int f() { auto l = [=] { return 1; }; return l(); }',
  'int f() { auto l = [&] { return 1; }; return l(); }',
  'int f() { auto l = [this] { return 1; }; return l(); }',
  'int f() { auto l = [](int x) mutable { return x; }; return l(1); }',
  'int f() { auto l = [](int x) -> int { return x; }; return l(1); }',

  // --- inicialização
  'int arr[] = {1, 2, 3};',
  'struct S { int x; }; S s = {1};',
  'struct S { int x, y; }; S s{1, 2};',
  'int f() { int a[2] = {1, 2}; return a[0]; }',
  // --- T2.1: as 14 formas da ordem. Todas devem parsear com 0 diagnósticos.
  // Ver `tests/tools/t21-forms.mjs`, que é o harness que mede isto.
  'constexpr int kBrailleBit[2][4] = { {0,1,2,6}, {3,4,5,7} };', // F01
  'int a[2][2] = {{1,2},{3,4},};',                                // F02
  'int a[3] = {};',                                               // F03
  'int a[2][3] = {{1,2},{3,4},{5,6}};',                           // F04
  'void f() { g({1,2,3}); }',                                     // F05
  'struct Vec3 { double x, y, z; };\nVec3 operator+(const Vec3 &o) const { return {x + o.x, y + o.y, z + o.z}; }', // F06
  'int f() { return {a + b, c + d}; }',                          // F07
  'auto v = std::vector<std::vector<int>>{{1,2},{3}};',           // F08
  'int f(Proj a, Proj b, Proj c) { return std::min({a.sx, b.sx, c.sx}); }', // F09
  'struct Vec3 { double x, y, z; };\nVec3 cross(const Vec3 &o) const { return {y * o.z - z * o.y, z * o.x - x * o.z}; }', // F10
  'struct C { C(int a, int b); }; int f() { return Color{255,255,255}.a; }', // F11
  'struct T { T(); }; void f() { T x{}; }',                      // F12
  'struct T { T(); T(int); }; void f() { T x = {}; }',           // F13
  'struct T { T(); T& operator=(const T&); }; void f(T x) { x = {1, 2}; }', // F14
  'void f() { int *p = new int[3]{1,2,3}; }',                    // F15
  'struct T { T(int); }; void f() { T *a = new T(1); T *b = new T{1}; }', // F16
  'struct T { int x{0}; int y = 0; };',                          // F17
  'struct T { T() : x{1}, y(2) {} int x, y; };',                 // F18
  // --- T2.3: as DUAS formas de linkage
  'extern "C" void f(){}',
  'extern "C" { void f(){} void g(){} }',
  'extern "C" void f();',
  'extern "C" { void f(); void g(); }',
  'int f() { for (int i = 0; i < 10; ++i) { } return 0; }',
  'int f() { int s = 0; while (s < 10) ++s; return s; }',
  'int f() { do { } while (false); return 0; }',
  'int f(int a) { switch (a) { case 1: return 1; case 2: return 2; default: return 0; } }',
  'int f() { int a[3]; return a[0]; }',
  'int f(int* p) { return *p; }',
  'int f(int* p) { return p[1]; }',
  'void f(int* p) { *p = 1; }',
  'int f(int n) { int* p = new int[n]; delete[] p; return 0; }',
  'int f() { return static_cast<int>(3.5); }',
  'int f(int a) { return (int)a; }',
  'int f() { return sizeof(int); }',
  'int f(int a) { return sizeof a; }',

  // --- static_assert
  'static_assert(1 == 1);',
  'static_assert(sizeof(int) == 4, "int deve ter 4 bytes");',
  'static_assert(true, "ok");',

  // --- strings
  'const char* s = "linha1\\nlinha2";',
  'const char* s = "a" "b";',
  'const char* s = "tab\\there";',
  'char c = \'\\n\';',
  'char c = \'\\x41\';',

  // ---多种 declarações combinadas
  'int a = 1; int b = 2; int c = 3;',
  'struct S { int x; }; int f(S s) { return s.x; } int g() { return f(S{1}); }',
  'namespace n { struct S { int x; }; } int f(n::S s) { return s.x; }',
  'template<typename T> struct V { T* p; }; template<typename T> T* get(V<T>& v) { return v.p; }',

  // --- comentários e linhas em branco (o lexer já cuida)
  '// comentario\nint x;',
  '/* bloco */ int x;',
  'int /* meio */ x;',
  '\n\n\nint x;\n\n\n',
];

// ---------------------------------------------------------------- inválidos

/**
 * Cada entrada é um programa que `g++ -std=c++17 -fsyntax-only` REJEITA.
 * Confirmado por `tests/tools/diff-parse.mjs`.
 */
export const CASOS_INVALIDOS = [
  // --- ponto e vírgula faltando
  { src: 'int x', motivo: 'sem ponto e vírgula' },
  { src: 'int f() { return 1 }', motivo: 'sem ponto e vírgula no return' },
  { src: 'int a = 1 int b = 2;', motivo: 'sem ponto e vírgula entre declarações' },
  { src: 'struct S { int x }', motivo: 'sem ponto e vírgula no membro' },

  // --- parênteses e chaves
  { src: 'int f() { ', motivo: 'chave não fechada' },
  { src: 'int f( {}', motivo: 'parêntese não fechado' },
  { src: 'int x = (1;', motivo: 'parêntese de balanceamento fechado cedo' },
  { src: 'int f() { int a = 1; ', motivo: 'falta fechar a função' },

  // --- falta de identificador
  { src: 'int = 1;', motivo: 'sem nome na declaração' },
  { src: 'int f() { return ; }', motivo: 'sem tipo de retorno' },

  // --- operador faltando
  { src: 'int x = 1 +;', motivo: 'operador sem operando' },
  { src: 'int x = ;', motivo: 'sem inicializador' },
  { src: 'int x = * 1;', motivo: 'unário no lugar de binário' },
  { src: 'int f() { int a = 1; a = ; }', motivo: 'atribuição sem valor' },
  { src: 'int x = (1 + 2;', motivo: 'paren faltando' },
  { src: 'int x = 1 ? 2;', motivo: 'ternário sem os dois ramos' },

  // --- struct/class
  { src: 'struct { int x; };', motivo: 'definição anônima isolada sem declarador não é declaração válida' },
  { src: 'class C { int x', motivo: 'membro sem ponto e vírgula e sem chave' },
  { src: 'struct S : { int x; };', motivo: 'base sem nome' },
  // NOTA: `enum E { A, }; int x = B;` é rejeitado pelo g++, mas por um erro
  // SEMÂNTICO (B não declarado). O parser não tem tabela de escopo — isso é
  // da Fase 3. Fica de fora do corpus de erros de SINTAXE.

  // --- parêntese de tipo
  { src: 'int f() { return (1; }', motivo: 'cast sem fecha parênteses' },
  { src: 'int x = sizeof(int;', motivo: 'sizeof sem fecha parênteses' },
  { src: 'int x = new int;', motivo: 'new sem tipo nem parênteses' },

  // ---Statements
  { src: 'int f() { if return 1; }', motivo: 'if sem parêntese' },
  { src: 'int f() { if (1 }', motivo: 'if sem fecha parêntese nem corpo' },
  { src: 'int f() { while { } }', motivo: 'while sem parêntese' },
  { src: 'int f() { for (;; ) }', motivo: 'for sem fecha parêntese' },
  { src: 'int f() { do { } while 1; }', motivo: 'while do sem parêntese' },
  { src: 'int f() { switch (1) case 1: }', motivo: 'switch sem chaves' },

  // --- tokens que não formam nada
  { src: '}', motivo: 'chave de fechamento sozinha' },
  { src: ')', motivo: 'parêntese de fechamento sozinho' },
  { src: '...', motivo: 'reticências sozinha' },
  { src: '@', motivo: 'caractere inválido' },
  { src: '#', motivo: 'pré-processador fora de lugar' },
  { src: 'int x = @;', motivo: 'caractere inválido em expressão' },

  // --- literais quebrados
  { src: 'const char* s = "abc;', motivo: 'string não terminada' },
  { src: "char c = 'a;", motivo: 'char literal não terminado' },
  { src: 'int x = 0x;', motivo: 'hexadecimal sem dígitos' },
  { src: 'int x = 1e;', motivo: 'expoente sem dígitos' },

  // --- declaradores
  { src: 'int [3] a;', motivo: 'array sem nome' },
  { src: 'int f(int a,);', motivo: 'parâmetro sem tipo' },

  // --- namespace e using
  { src: 'using = int;', motivo: 'using sem nome' },

  // --- template
  { src: 'template<> struct S {};', motivo: 'lista de template vazia' },
  { src: 'template<typename struct S {};', motivo: 'template sem >' },

  // --- constantes fora do escopo (E02xx, não E01xx — ficam de fora daqui)
];

// Todos os casos válidos devem ser aceitos; útil para os testes de progresso.
export const TOTAL_VALIDOS = CASOS_VALIDOS.length;
export const TOTAL_INVALIDOS = CASOS_INVALIDOS.length;