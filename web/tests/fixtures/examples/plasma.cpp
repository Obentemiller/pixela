#include <pixela.h>
#include <cmath>

// Efeito "plasma" em resolução Braille (bem mais nítido que 1 glifo/pixel).
// Para uma versão de alta performance com cor renderizada por
// src/pixela.hpp de verdade, veja o exemplo WASM "Shader Volumétrico".
int main() {
    while (true) {
        double t = pix_time();
        int w = pix_width();
        int h = pix_height();
        for (int y = 0; y < h; y = y + 1) {
            for (int x = 0; x < w; x = x + 1) {
                double v = sin(x * 0.12 + t) + sin(y * 0.22 + t * 1.3)
                         + sin((x + y) * 0.08 + t * 0.7);
                double n = (v + 3.0) / 6.0;
                int r = (int)(80 + 150 * n);
                int g = (int)(40 + 60 * (1.0 - n));
                int b = (int)(150 + 100 * n);
                if (n > 0.15) pix_set(x, y, true, r, g, b);
            }
        }
        pix_present();
    }
    return 0;
}
