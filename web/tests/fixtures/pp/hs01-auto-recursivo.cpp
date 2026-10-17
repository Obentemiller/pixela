// hide-set: #define A A
// A deve expandir UMA vez: #define A A  =>  o corpo e `A`, que ao expandir vira `A` marcado e NAO reexpande.
#define A A
A
