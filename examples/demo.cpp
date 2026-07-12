// demo.cpp - exemplo de uso da terminal_gfx.hpp
// Compilar:  g++ -std=c++17 -O2 demo.cpp -o demo -lpthread
// Executar:  ./demo   (Ctrl+C para sair)

#include "../include/terminal_gfx.hpp"
#include <thread>
#include <chrono>
#include <csignal>
#include <atomic>

std::atomic<bool> running{true};
void onSigint(int) { running = false; }

int main() {
    tgfx::enableAnsiSupport();
    std::signal(SIGINT, onSigint);

    int cols, rows;
    tgfx::getTerminalSize(cols, rows);
    rows = std::max(1, rows - 1); // folga de 1 linha para não rolar a tela

    tgfx::Canvas cv(cols, rows);

    tgfx::clearScreen();
    tgfx::hideCursor();

    double t = 0.0;
    double ballX = cv.width() / 2.0, ballY = cv.height() / 2.0;
    double vx = 47.0, vy = 33.0; // pixels por segundo

    auto last = std::chrono::steady_clock::now();

    while (running) {
        auto now = std::chrono::steady_clock::now();
        double dt = std::chrono::duration<double>(now - last).count();
        last = now;

        cv.clear();

        // bola quicando nas bordas
        ballX += vx * dt; ballY += vy * dt;
        if (ballX < 4 || ballX > cv.width()  - 4) vx = -vx;
        if (ballY < 4 || ballY > cv.height() - 4) vy = -vy;
        cv.drawCircle((int)ballX, (int)ballY, 4, true, {255, 80, 80});

        // onda senoidal atravessando a tela
        for (int x = 0; x < cv.width(); ++x) {
            int y = cv.height() / 2 +
                    (int)(std::sin(x * 0.15 + t * 3.0) * (cv.height() / 4.0));
            cv.setPixel(x, y, true, {80, 180, 255});
        }

        // ponteiro rotativo no canto superior direito
        int cx = cv.width() - cv.width() / 6, cy = cv.height() / 6;
        int r  = std::min(cv.width(), cv.height()) / 8;
        int lx = cx + (int)(std::cos(t * 2.0) * r);
        int ly = cy + (int)(std::sin(t * 2.0) * r);
        cv.drawCircle(cx, cy, r, false, {90, 90, 90});
        cv.drawLine(cx, cy, lx, ly, {120, 255, 120});

        // moldura
        cv.drawRect(0, 0, cv.width(), cv.height(), false, {200, 200, 200});

        cv.present();

        t += dt;
        std::this_thread::sleep_for(std::chrono::milliseconds(16));
    }

    tgfx::showCursor();
    std::cout << "\x1b[0m\n";
    return 0;
}
