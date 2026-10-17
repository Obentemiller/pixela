#include <pixela.h>
#include <cstdlib>

#define N_STARS 120

int main() {
    int sx[N_STARS];
    int sy[N_STARS];
    int speed[N_STARS];

    for (int i = 0; i < N_STARS; i = i + 1) {
        sx[i] = rand() % pix_width();
        sy[i] = rand() % pix_height();
        speed[i] = 1 + rand() % 3;
    }

    while (true) {
        pix_clear();
        for (int i = 0; i < N_STARS; i = i + 1) {
            sx[i] = sx[i] - speed[i];
            if (sx[i] < 0) {
                sx[i] = pix_width() - 1;
                sy[i] = rand() % pix_height();
            }
            int shade = 80 + speed[i] * 55;
            pix_set(sx[i], sy[i], true, shade, shade, 255);
        }
        pix_present();
    }
    return 0;
}
