#include <pixela.h>

// Toda animação começa com um main() comum.
// pix_clear()/pix_present() delimitam cada quadro. A resolução real é em
// PIXELS (2x4 por caractere do terminal, técnica Braille), não em colunas.
int main() {
    int frame = 0;
    while (frame < 300) {
        pix_clear();
        pix_rect(4, 4, pix_width() - 8, pix_height() - 8, false, 90, 220, 160);
        pix_circle(pix_width() / 2, pix_height() / 2, 20, false, 255, 180, 60);
        pix_present();
        frame = frame + 1;
    }
    return 0;
}
