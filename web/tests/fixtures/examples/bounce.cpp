#include <pixela.h>

int main() {
    double x = 10, y = 10;
    double vx = 1.1, vy = 0.8;
    int radius = 4;
    while (true) {
        int w = pix_width();
        int h = pix_height();

        x = x + vx;
        y = y + vy;
        if (x < radius || x > w - radius) vx = -vx;
        if (y < radius || y > h - radius) vy = -vy;

        pix_clear();
        pix_rect(0, 0, w, h, false, 80, 90, 100);
        pix_circle((int)x, (int)y, radius, true, 255, 210, 80);
        pix_present();
    }
    return 0;
}
