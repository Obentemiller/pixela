#include <pixela.h>
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
