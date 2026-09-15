/**
 * examples.js
 * Example "main.cpp" scripts loaded into the editor. All of these run
 * through the interpreted path (js/interpreter.js) using the pix_* free
 * functions (js/pixela-bindings.js), which mirror pixela.hpp's own
 * Braille sub-pixel + true-color technique.
 */
const EXAMPLES = {
  hello: `#include <pixela.h>

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
`,

  plasma: `#include <pixela.h>
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
`,

  bounce: `#include <pixela.h>

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
`,

  starfield: `#include <pixela.h>
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
`,

  wireframecube: `#include <pixela.h>

// Cubo 3D girando, com projeção em perspectiva real — tudo ao vivo, no
// editor interpretado. Isso NÃO usa std::vector, struct, template, "::"
// nem lambda: a malha (vértices/arestas) e a matemática de rotação/projeção
// vivem nativas em js/mesh3d.js (portadas linha a linha de
// src/pixela.hpp), e aqui só montamos os 8 vértices/12 arestas do cubo UMA
// vez com inteiros e laços simples — exatamente o subconjunto de C++ que o
// interpretador (JSCPP) já sabe rodar. Veja o README, seção "Uma terceira
// camada: pix_mesh_*", para o porquê disso ser seguro e não custar
// performance (a parte cara não é interpretada passo a passo).
int main() {
    pix_mesh_reset();
    pix_mesh_set_pos(0.0, 0.0, 55.0);

    int idx[2][2][2];
    for (int xi = 0; xi < 2; xi = xi + 1)
        for (int yi = 0; yi < 2; yi = yi + 1)
            for (int zi = 0; zi < 2; zi = zi + 1) {
                double x = (xi * 2 - 1) * 18.0;
                double y = (yi * 2 - 1) * 18.0;
                double z = (zi * 2 - 1) * 18.0;
                idx[xi][yi][zi] = pix_mesh_add_vertex(x, y, z);
            }

    for (int yi = 0; yi < 2; yi = yi + 1)
        for (int zi = 0; zi < 2; zi = zi + 1)
            pix_mesh_add_edge(idx[0][yi][zi], idx[1][yi][zi]);
    for (int xi = 0; xi < 2; xi = xi + 1)
        for (int zi = 0; zi < 2; zi = zi + 1)
            pix_mesh_add_edge(idx[xi][0][zi], idx[xi][1][zi]);
    for (int xi = 0; xi < 2; xi = xi + 1)
        for (int yi = 0; yi < 2; yi = yi + 1)
            pix_mesh_add_edge(idx[xi][yi][0], idx[xi][yi][1]);

    while (true) {
        pix_clear();
        pix_mesh_spin(0.7, 1.1, 0.0, 0.016);
        pix_mesh_draw(255, 180, 60);
        pix_present();
    }
    return 0;
}
`,

  scene3d: `#include <pixela.h>
#include <cmath>
#include <cstdlib>

// scene3d — porte de examples/demo_3d.cpp (camada COMPILADA: terminal
// nativo, pix::Renderer3D/pix::Mesh com std::vector, thread, sinal SIGINT)
// para a camada INTERPRETADA (JSCPP, ao vivo no navegador, sem
// servidor/compilador). Mesma cena — campo de estrelas, grade de chão
// estilo Tron e 3 sólidos girando com a câmera orbitando tudo — só que
// reescrita no subconjunto de C++ que o interpretador sabe rodar:
//
//   - Sem std::vector/struct/classe/lambda/template/"::" (igual ao
//     "Cubo 3D Giratório"): tudo vira array de tamanho fixo + laço simples.
//   - pix_mesh_* (js/mesh3d.js) só tem UM slot de malha global — dá pra
//     montar um sólido de cada vez. Por isso cubo, icosaedro e toro são
//     reconstruídos (pix_mesh_reset + add_vertex/add_edge) a cada quadro,
//     um de cada vez, e cada um guarda seu próprio ângulo acumulado à mão
//     (cubeA*/icoA*/torA*) porque pix_mesh_reset zera o ângulo interno do
//     módulo — pix_mesh_spin sozinho não sobreviveria a esse reset.
//   - Não existem funções livres com ponteiro de saída aqui (recurso ainda
//     não testado neste projeto): a rotação/projeção da câmera para as
//     estrelas, a grade e a posição de cada sólido é feita "na mão", com
//     seno/cosseno calculados uma vez por quadro e reaproveitados.
//   - Só wireframe (sem sombreamento nem z-buffer — isso é o exemplo
//     WASM "Motor 3D (torus + icosaedro)"). O toro usa 10x16 segmentos
//     (o original nativo usa 14x22) só para manter o código mais enxuto;
//     veja o README, seção "Uma terceira camada: pix_mesh_*", para os
//     números medidos de custo por quadro dessa camada.
//   - As estrelas e a grade NÃO passam pelo pix_mesh_*: são pontos e
//     segmentos soltos, então é mais direto girar e projetar cada um à
//     mão e desenhar com pix_set/pix_line, sem disputar o único slot de
//     malha com os 3 sólidos.

#define N_STARS 140
#define N_GRID 22
#define TOR_MAJOR 10
#define TOR_MINOR 16

int main() {
    double starX[N_STARS];
    double starY[N_STARS];
    double starZ[N_STARS];
    for (int i = 0; i < N_STARS; i = i + 1) {
        starX[i] = (rand() % 1800) / 100.0 - 9.0;   // -9.0 .. 9.0
        starY[i] = (rand() % 1800) / 100.0 - 9.0;
        starZ[i] = 1.0 + (rand() % 3900) / 100.0;   // 1.0 .. 40.0
    }

    // grade do chão (estilo Tron): 22 segmentos fixos, guardados como
    // pares de pontos em arrays paralelos (sem struct Vec3 aqui).
    double gx0[N_GRID]; double gy0[N_GRID]; double gz0[N_GRID];
    double gx1[N_GRID]; double gy1[N_GRID]; double gz1[N_GRID];
    int gi = 0;
    for (int i = -10; i <= 10; i = i + 2) {
        gx0[gi] = i;      gy0[gi] = -3.0; gz0[gi] = 0.0;
        gx1[gi] = i;      gy1[gi] = -3.0; gz1[gi] = 40.0;
        gi = gi + 1;
        gx0[gi] = -10.0;  gy0[gi] = -3.0; gz0[gi] = i + 10.0;
        gx1[gi] = 10.0;   gy1[gi] = -3.0; gz1[gi] = i + 10.0;
        gi = gi + 1;
    }

    double cubeAX = 0.0; double cubeAY = 0.0; double cubeAZ = 0.0;
    double icoAX = 0.0;  double icoAY = 0.0;  double icoAZ = 0.0;
    double torAX = 0.0;  double torAY = 0.0;  double torAZ = 0.0;
    double globalAngle = 0.0;
    double lastT = pix_time();

    double icoR = 1.5 / 1.9021130325903073; // normaliza os vértices unitários abaixo p/ raio 1.5
    double icoPhi = 1.618033988749895;

    while (true) {
        double t = pix_time();
        double dt = t - lastT;
        lastT = t;
        if (dt > 0.1) dt = 0.1;   // trava saltos grandes (aba em 2º plano, etc.)
        if (dt < 0.0) dt = 0.0;

        globalAngle = globalAngle + dt * 0.25;      // câmera orbitando a cena inteira
        cubeAX = cubeAX + 0.9 * dt; cubeAY = cubeAY + 0.6 * dt;
        icoAX  = icoAX  + 0.5 * dt; icoAY  = icoAY  + 1.1 * dt; icoAZ = icoAZ + 0.3 * dt;
        torAX  = torAX  + 0.3 * dt; torAY  = torAY  + 0.4 * dt; torAZ = torAZ + 1.0 * dt;

        double camCos = cos(globalAngle);
        double camSin = sin(globalAngle);
        double starCos = cos(globalAngle * 0.3);
        double starSin = sin(globalAngle * 0.3);

        int w = pix_width();
        int h = pix_height();
        double focal = w * 0.9;   // mesmo padrão de pix::Renderer3D
        pix_clear();

        // --- estrelas: voam em direção à câmera e reaparecem no fundo ---
        for (int i = 0; i < N_STARS; i = i + 1) {
            starZ[i] = starZ[i] - dt * 6.0;
            if (starZ[i] < 0.5) {
                starX[i] = (rand() % 1800) / 100.0 - 9.0;
                starY[i] = (rand() % 1800) / 100.0 - 9.0;
                starZ[i] = 40.0;
            }
            double rx = starX[i] * starCos + starZ[i] * starSin;
            double ry = starY[i];
            double rz = -starX[i] * starSin + starZ[i] * starCos;
            if (rz > 0.05) {
                double scale = focal / rz;
                int sx = (int)(w * 0.5 + rx * scale);
                int sy = (int)(h * 0.5 - ry * scale);
                double bright = 1.0 - rz / 40.0;
                if (bright < 0.15) bright = 0.15;
                if (bright > 1.0) bright = 1.0;
                int v = (int)(180 + 75 * bright);
                pix_set(sx, sy, true, v, v, v);
            }
        }

        // --- grade do chão ---
        for (int i = 0; i < N_GRID; i = i + 1) {
            double ax = gx0[i] * camCos + gz0[i] * camSin;
            double ay = gy0[i];
            double az = -gx0[i] * camSin + gz0[i] * camCos;
            double bx = gx1[i] * camCos + gz1[i] * camSin;
            double by = gy1[i];
            double bz = -gx1[i] * camSin + gz1[i] * camCos;
            if (az > 0.05 && bz > 0.05) {
                double sa = focal / az;
                double sb = focal / bz;
                int sax = (int)(w * 0.5 + ax * sa);
                int say = (int)(h * 0.5 - ay * sa);
                int sbx = (int)(w * 0.5 + bx * sb);
                int sby = (int)(h * 0.5 - by * sb);
                pix_line(sax, say, sbx, sby, 40, 60, 90);
            }
        }

        // --- cubo (8 vértices / 12 arestas, remontado a cada quadro) ---
        pix_mesh_reset();
        int cIdx[2][2][2];
        for (int xi = 0; xi < 2; xi = xi + 1)
            for (int yi = 0; yi < 2; yi = yi + 1)
                for (int zi = 0; zi < 2; zi = zi + 1) {
                    double x = (xi * 2 - 1) * 1.1;
                    double y = (yi * 2 - 1) * 1.1;
                    double z = (zi * 2 - 1) * 1.1;
                    cIdx[xi][yi][zi] = pix_mesh_add_vertex(x, y, z);
                }
        for (int yi = 0; yi < 2; yi = yi + 1)
            for (int zi = 0; zi < 2; zi = zi + 1)
                pix_mesh_add_edge(cIdx[0][yi][zi], cIdx[1][yi][zi]);
        for (int xi = 0; xi < 2; xi = xi + 1)
            for (int zi = 0; zi < 2; zi = zi + 1)
                pix_mesh_add_edge(cIdx[xi][0][zi], cIdx[xi][1][zi]);
        for (int xi = 0; xi < 2; xi = xi + 1)
            for (int yi = 0; yi < 2; yi = yi + 1)
                pix_mesh_add_edge(cIdx[xi][yi][0], cIdx[xi][yi][1]);
        {
            double bx = -3.2; double bz = 9.0;
            double cpx = bx * camCos + bz * camSin;
            double cpz = -bx * camSin + bz * camCos;
            pix_mesh_set_pos(cpx, 0.0, cpz);
            pix_mesh_set_angle(cubeAX, cubeAY + globalAngle, cubeAZ);
        }
        pix_mesh_draw(255, 90, 90);

        // --- icosaedro (12 vértices / 30 arestas fixas do icosaedro
        // regular, escalado por icoR — remontado a cada quadro) ---
        pix_mesh_reset();
        int iv[12];
        iv[0]  = pix_mesh_add_vertex(-1.0 * icoR,  icoPhi * icoR,  0.0);
        iv[1]  = pix_mesh_add_vertex( 1.0 * icoR,  icoPhi * icoR,  0.0);
        iv[2]  = pix_mesh_add_vertex(-1.0 * icoR, -icoPhi * icoR,  0.0);
        iv[3]  = pix_mesh_add_vertex( 1.0 * icoR, -icoPhi * icoR,  0.0);
        iv[4]  = pix_mesh_add_vertex( 0.0, -1.0 * icoR,  icoPhi * icoR);
        iv[5]  = pix_mesh_add_vertex( 0.0,  1.0 * icoR,  icoPhi * icoR);
        iv[6]  = pix_mesh_add_vertex( 0.0, -1.0 * icoR, -icoPhi * icoR);
        iv[7]  = pix_mesh_add_vertex( 0.0,  1.0 * icoR, -icoPhi * icoR);
        iv[8]  = pix_mesh_add_vertex( icoPhi * icoR,  0.0, -1.0 * icoR);
        iv[9]  = pix_mesh_add_vertex( icoPhi * icoR,  0.0,  1.0 * icoR);
        iv[10] = pix_mesh_add_vertex(-icoPhi * icoR,  0.0, -1.0 * icoR);
        iv[11] = pix_mesh_add_vertex(-icoPhi * icoR,  0.0,  1.0 * icoR);
        pix_mesh_add_edge(iv[0], iv[1]);   pix_mesh_add_edge(iv[0], iv[5]);
        pix_mesh_add_edge(iv[0], iv[7]);   pix_mesh_add_edge(iv[0], iv[10]);
        pix_mesh_add_edge(iv[0], iv[11]);  pix_mesh_add_edge(iv[1], iv[5]);
        pix_mesh_add_edge(iv[1], iv[7]);   pix_mesh_add_edge(iv[1], iv[8]);
        pix_mesh_add_edge(iv[1], iv[9]);   pix_mesh_add_edge(iv[2], iv[3]);
        pix_mesh_add_edge(iv[2], iv[4]);   pix_mesh_add_edge(iv[2], iv[6]);
        pix_mesh_add_edge(iv[2], iv[10]);  pix_mesh_add_edge(iv[2], iv[11]);
        pix_mesh_add_edge(iv[3], iv[4]);   pix_mesh_add_edge(iv[3], iv[6]);
        pix_mesh_add_edge(iv[3], iv[8]);   pix_mesh_add_edge(iv[3], iv[9]);
        pix_mesh_add_edge(iv[4], iv[5]);   pix_mesh_add_edge(iv[4], iv[9]);
        pix_mesh_add_edge(iv[4], iv[11]);  pix_mesh_add_edge(iv[5], iv[9]);
        pix_mesh_add_edge(iv[5], iv[11]);  pix_mesh_add_edge(iv[6], iv[7]);
        pix_mesh_add_edge(iv[6], iv[8]);   pix_mesh_add_edge(iv[6], iv[10]);
        pix_mesh_add_edge(iv[7], iv[8]);   pix_mesh_add_edge(iv[7], iv[10]);
        pix_mesh_add_edge(iv[8], iv[9]);   pix_mesh_add_edge(iv[10], iv[11]);
        {
            double bx = 0.0; double bz = 7.0;
            double ipx = bx * camCos + bz * camSin;
            double ipz = -bx * camSin + bz * camCos;
            pix_mesh_set_pos(ipx, 0.0, ipz);
            pix_mesh_set_angle(icoAX, icoAY + globalAngle, icoAZ);
        }
        pix_mesh_draw(90, 200, 255);

        // --- toro (10x16 segmentos, remontado a cada quadro) ---
        pix_mesh_reset();
        double torR = 1.3; double torr = 0.5;
        int tIdx[TOR_MAJOR][TOR_MINOR];
        for (int i = 0; i < TOR_MAJOR; i = i + 1) {
            double theta = (i * 6.283185307179586) / TOR_MAJOR;
            for (int j = 0; j < TOR_MINOR; j = j + 1) {
                double phi = (j * 6.283185307179586) / TOR_MINOR;
                double x = (torR + torr * cos(phi)) * cos(theta);
                double y = torr * sin(phi);
                double z = (torR + torr * cos(phi)) * sin(theta);
                tIdx[i][j] = pix_mesh_add_vertex(x, y, z);
            }
        }
        for (int i = 0; i < TOR_MAJOR; i = i + 1) {
            int ni = i + 1;
            if (ni >= TOR_MAJOR) ni = 0;
            for (int j = 0; j < TOR_MINOR; j = j + 1) {
                int nj = j + 1;
                if (nj >= TOR_MINOR) nj = 0;
                pix_mesh_add_edge(tIdx[i][j], tIdx[i][nj]);   // anel
                pix_mesh_add_edge(tIdx[i][j], tIdx[ni][j]);   // ao longo do tubo
            }
        }
        {
            double bx = 3.2; double bz = 9.5;
            double tpx = bx * camCos + bz * camSin;
            double tpz = -bx * camSin + bz * camCos;
            pix_mesh_set_pos(tpx, 0.0, tpz);
            pix_mesh_set_angle(torAX, torAY + globalAngle, torAZ);
        }
        pix_mesh_draw(120, 255, 140);

        pix_present();
    }
    return 0;
}
`,

  saturn: `#include <pixela.h>
#include <cmath>

// Saturno — planeta (esfera de arame em grade lat/long), anéis (dois
// círculos + raios, inclinados) e uma lua (tetraedro) orbitando, tudo ao
// vivo no editor interpretado. Terceiro exemplo "pix_mesh_*" do projeto,
// depois do "Cubo 3D Giratório" e da "Cena 3D Completa": prova que o mesmo
// truque (matemática pesada em js/mesh3d.js, C++ interpretado só monta
// vértices/arestas com inteiros/doubles em laços simples) também dá conta
// de uma esfera, um anel achatado e um sólido pequeno com órbita própria —
// sem std::vector, struct, template, "::", auto nem lambda, e sem precisar
// mexer no interpretador JSCPP. Ver README, seção "Uma terceira camada:
// pix_mesh_*".
//
// Igual à "Cena 3D Completa": como pix_mesh_* só tem UM slot de malha
// global, planeta/anéis/lua são remontados (pix_mesh_reset +
// add_vertex/add_edge) um de cada vez, a cada quadro.

#define LAT_SEG 8
#define LAT_ROWS 9
#define LON_SEG 16
#define RING_SEG 40
#define RING_SPOKE_STEP 5

int main() {
    double planetAngleY = 0.0;
    double moonOrbit = 0.0;
    double lastT = pix_time();

    double PI2 = 6.283185307179586;
    double PIHALF = 1.5707963267948966;

    double planetR = 6.0;
    double ringOuter = 10.0;
    double ringInner = 7.5;
    double moonOrbitR = 16.0;
    double moonTilt = 0.3;

    while (true) {
        double t = pix_time();
        double dt = t - lastT;
        lastT = t;
        if (dt > 0.1) dt = 0.1;
        if (dt < 0.0) dt = 0.0;

        planetAngleY = planetAngleY + dt * 0.35;
        moonOrbit = moonOrbit + dt * 0.6;

        pix_clear();

        // --- planeta: esfera de arame (grade lat/long) ---
        pix_mesh_reset();
        int sIdx[LAT_ROWS][LON_SEG];
        for (int i = 0; i < LAT_ROWS; i = i + 1) {
            double theta = -PIHALF + PIHALF * 2.0 * (i / (LAT_SEG * 1.0));
            for (int j = 0; j < LON_SEG; j = j + 1) {
                double phi = PI2 * (j / (LON_SEG * 1.0));
                double x = planetR * cos(theta) * cos(phi);
                double y = planetR * sin(theta);
                double z = planetR * cos(theta) * sin(phi);
                sIdx[i][j] = pix_mesh_add_vertex(x, y, z);
            }
        }
        for (int i = 0; i < LAT_ROWS; i = i + 1) {
            for (int j = 0; j < LON_SEG; j = j + 1) {
                int nj = j + 1;
                if (nj >= LON_SEG) nj = 0;
                pix_mesh_add_edge(sIdx[i][j], sIdx[i][nj]);
                if (i < LAT_SEG) pix_mesh_add_edge(sIdx[i][j], sIdx[i + 1][j]);
            }
        }
        pix_mesh_set_pos(0.0, 0.0, 60.0);
        pix_mesh_set_angle(0.25, planetAngleY, 0.0);
        pix_mesh_draw(230, 190, 120);

        // --- anéis: dois círculos concêntricos + raios, inclinados ---
        pix_mesh_reset();
        int outIdx[RING_SEG];
        int inIdx[RING_SEG];
        for (int j = 0; j < RING_SEG; j = j + 1) {
            double phi = PI2 * (j / (RING_SEG * 1.0));
            outIdx[j] = pix_mesh_add_vertex(ringOuter * cos(phi), 0.0, ringOuter * sin(phi));
            inIdx[j] = pix_mesh_add_vertex(ringInner * cos(phi), 0.0, ringInner * sin(phi));
        }
        for (int j = 0; j < RING_SEG; j = j + 1) {
            int nj = j + 1;
            if (nj >= RING_SEG) nj = 0;
            pix_mesh_add_edge(outIdx[j], outIdx[nj]);
            pix_mesh_add_edge(inIdx[j], inIdx[nj]);
            if (j % RING_SPOKE_STEP == 0) pix_mesh_add_edge(outIdx[j], inIdx[j]);
        }
        pix_mesh_set_pos(0.0, 0.0, 60.0);
        pix_mesh_set_angle(0.45, planetAngleY, 0.0);
        pix_mesh_draw(210, 180, 140);

        // --- lua: tetraedro pequeno, em órbita inclinada ao redor do planeta ---
        pix_mesh_reset();
        double mv = 3.0;
        int t0 = pix_mesh_add_vertex(mv, mv, mv);
        int t1 = pix_mesh_add_vertex(mv, -mv, -mv);
        int t2 = pix_mesh_add_vertex(-mv, mv, -mv);
        int t3 = pix_mesh_add_vertex(-mv, -mv, mv);
        pix_mesh_add_edge(t0, t1);
        pix_mesh_add_edge(t0, t2);
        pix_mesh_add_edge(t0, t3);
        pix_mesh_add_edge(t1, t2);
        pix_mesh_add_edge(t1, t3);
        pix_mesh_add_edge(t2, t3);

        double bx = moonOrbitR * cos(moonOrbit);
        double by0 = 0.0;
        double bz0 = moonOrbitR * sin(moonOrbit);
        double by = by0 * cos(moonTilt) - bz0 * sin(moonTilt);
        double bz = by0 * sin(moonTilt) + bz0 * cos(moonTilt);
        pix_mesh_set_pos(bx, by, 60.0 + bz);
        pix_mesh_set_angle(moonOrbit * 1.7, moonOrbit * 2.1, 0.0);
        pix_mesh_draw(150, 210, 255);

        pix_present();
    }
    return 0;
}
`,
};

window.EXAMPLES = EXAMPLES;
