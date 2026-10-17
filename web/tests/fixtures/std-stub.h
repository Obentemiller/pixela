/**
 * tests/fixtures/std-stub.h — stub de std para os fixtures de parse.
 *
 * Concatenado ANTES do texto do fixture para g++, clang e o parser (mesmo
 * texto). Assim a divergência não depende da resolução de include de cada
 * commit: os três lados veem exatamente as mesmas declarações.
 *
 * Contém apenas o mínimo que os fixtures usam: size_t, uint8_t, int32_t,
 * std::vector, std::string, std::min/max, std::sin/cos/sqrt, std::cout.
 * Nada de implementação — só declaração.
 *
 * REGRA: o stub tem de dar **0 diagnósticos** no parser do HEAD. Se um
 * fixture válido diverge porque o STUB não parseia, a divergência é de
 * INFRAESTRUTURA, não do parser — medir isso seria ruído.
 *
 * Duas construções que o parser do HEAD ainda NÃO aceita foram removidas do
 * stub e registradas como bug do parser em `reports/A3/divergencias-stub.md`:
 *
 *   - `template<class T, class A = int>` — argumento padrão de template
 *   - `extern T x;` — variável com linkage externo
 *
 * Nada mais saiu daqui: o resto é C++ que o parser aceita.
 */
typedef unsigned long size_t;
typedef signed char int8_t;
typedef unsigned char uint8_t;
typedef short int16_t;
typedef unsigned short uint16_t;
typedef int int32_t;
typedef unsigned int uint32_t;
typedef long long int64_t;
typedef unsigned long long uint64_t;

namespace std {
template<class T, class A> struct vector {  // sem o `= int`: ver S2-BUG-1
  vector();
  vector(size_t n);
  void push_back(const T& v);
  T& operator[](size_t i);
  size_t size() const;
  void resize(size_t n);
  bool empty() const;
};
struct string {
  string();
  string(const char* s);
  size_t size() const;
  const char* c_str() const;
};
template<class A, class B> struct pair {
  pair();
  pair(A a, B b);
  A first;
  B second;
};
template<class A, class B> pair<A, B> make_pair(A a, B b);
template<class... Args> struct tuple { tuple(); };
template<class A, class B> tuple<A, B> make_tuple(A a, B b);
struct nothrow_t {};
nothrow_t nothrow;  // sem `extern`: ver S2-BUG-2
template<class T> const T& min(const T& a, const T& b);
template<class T> const T& max(const T& a, const T& b);
// A sobrecarga de initializer_list e o que faz `std::min({1,2,3})` compilar
// (T2.1). Sem ela o fixture 115 e descartado por erro do STUB, nao do parser.
// O nome `initializer_list` nao pode ser redeclarado: o libstdc++ ja o
// declara e o g++ acusa "does not match #include <initializer_list>".
// A sobrecarga abaixo usa um template proprio.
template<class T> struct ilist { const T* begin() const; const T* end() const; unsigned long size() const; };
template<class T> T min(ilist<T> l);
template<class T> T max(ilist<T> l);
double abs(double);
double sqrt(double);
double sin(double);
double cos(double);
double floor(double);
double ceil(double);
struct ostream {
  ostream& operator<<(const char* s);
  ostream& operator<<(int v);
  ostream& operator<<(double v);
  ostream& flush();
};
ostream cout;  // sem `extern`: ver S2-BUG-2
ostream cerr;  // sem `extern`: ver S2-BUG-2
ostream& endl(ostream&);
}