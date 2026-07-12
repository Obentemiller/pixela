# PIXELA — C++ Terminal Graphics API

A **header-only** API (`include/pixela.hpp`) with no external dependencies — just the C++17 stdlib.

## Project Structure

```
pixela/
├── include/
│   └── pixela.hpp        # the API (header-only)
├── examples/
│   └── demo.cpp          # animation example
├── Makefile
└── README.md

```

## How the Resolution Works

Each Unicode **Braille** character (`U+2800`–`U+28FF`) represents a **2x4 dot** grid (8 sub-pixels). By using these characters as the drawing unit instead of a "full" character per pixel, the resolution is **8x higher** per terminal cell. An 80x24 character terminal becomes a real **160 x 96 "pixel"** screen.

Furthermore, each cell receives **true RGB color (24-bit)** via ANSI escape sequences (`\x1b[38;2;r;g;bm`).

## Build and Run

With `make` (recommended):

```bash
make        # builds the demo
make run    # builds (if necessary) and runs it
make clean  # removes the binary

```

Or directly with g++:

```bash
g++ -std=c++17 -O2 -Iinclude examples/demo.cpp -o demo -lpthread
./demo      # Ctrl+C to exit

```

## API Usage

```cpp
#include "pixela.hpp"   // with -Iinclude in the compiler

int main() {
    int cols, rows;
    pxl::getTerminalSize(cols, rows);   // detects terminal size
    pxl::enableAnsiSupport();           // required on older Windows terminals

    pxl::Canvas cv(cols, rows);         // real resolution: cols*2 x rows*4

    cv.clear();
    cv.drawCircle(cv.width()/2, cv.height()/2, 20, false, {255, 0, 0});
    cv.drawLine(0, 0, cv.width()-1, cv.height()-1, {0, 255, 0});
    cv.drawRect(5, 5, 30, 10, true, {0, 120, 255});

    pxl::clearScreen();
    cv.pixelar();  // prints the frame
}

```

### Available Functions

| Function | Description |
| --- | --- |
| `setPixel(x, y, on, color)` | turns a "pixel" on/off with color |
| `drawLine(x0,y0,x1,y1,color)` | line (Bresenham) |
| `drawRect(x,y,w,h,filled,color)` | rectangle |
| `drawCircle(cx,cy,r,filled,color)` | circle (Bresenham) |
| `drawTriangle(...)` | triangle (outline) |
| `clear()` | clears the canvas |
| `render()` | returns the frame as a `std::string` (with ANSI codes) |
| `pixelar()` | prints the frame directly to the terminal, flicker-free |
| `width()/height()` | real resolution in "pixels" (cols*2, rows*4) |

The `examples/demo.cpp` shows an animation with a bouncing ball, a sine wave, and a spinning pointer, all running at ~60 FPS.

The demos were created using Claude; the code itself wasn't AI-generated, but I used the tool to add comments and create the demo examples. I recommend using it to better understand my tool and to build upon it—just give me credit, and I'll be happy.
