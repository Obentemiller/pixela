// hide-set + ##: o token formado nao reexpande como macro
// `#define J(a,b) a##b` + `#define foo 42`: `J(fo,o)` vale `foo` LITERAL, nao 42.
#define foo 42
#define J(a, b) a ## b
J(fo, o)
