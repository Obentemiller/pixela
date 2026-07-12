CXX      := g++
CXXFLAGS := -std=c++17 -O2 -Wall -Wextra -Iinclude
LDFLAGS  := -lpthread

SRC      := examples/demo.cpp
BIN      := demo

.PHONY: all run clean

all: $(BIN)

$(BIN): $(SRC) include/terminal_gfx.hpp
	$(CXX) $(CXXFLAGS) $(SRC) -o $(BIN) $(LDFLAGS)

run: $(BIN)
	./$(BIN)

clean:
	rm -f $(BIN)
