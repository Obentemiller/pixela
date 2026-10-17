#include <pixela.h>

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
