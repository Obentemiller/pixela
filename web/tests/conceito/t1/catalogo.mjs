/**
 * tests/conceito/t1/catalogo.mjs — as listas do catalogo JA CONHECIDO.
 *
 * Vivem aqui, e nao dentro do script de cruzamento, porque tanto o cruzamento
 * por pipeline (e5-cruzamento.mjs) como o cruzamento por subsequencia
 * (e5-cruzamento-minimos.mjs) precisam da MESMA lista. Duas copias da lista
 * divergiriam sem ninguem dar por isso.
 *
 * As listas sao as do catalogo de S7, em `reports/A3/relatorio-s7.md`:
 *   - 9 bugs SINTATICOS do S7(d), todos dentro dos 16 aceita-indevidamente
 *   - os 16 aceita-indevidamente do v2
 *   - os 26 posicao do v2
 */
export const CATALOGO = {
  'S7(d)-bugs-sintaticos': [
    '19-inv-colchete-fechando', '20-inv-typedef-sem-tipo', '24-inv-enum-sem-chave',
    '36-inv-extern-c-sem-chave', '42-inv-int-com-int', '43-inv-duplo-const',
    '47-inv-funcao-sem-corpo', '58-inv-typedef-sem-nome', '59-inv-enum-class-sem-nome',
  ],
  'aceita-indevidamente-v2': [
    '14-inv-break-sem-ponto-virgula', '15-inv-continue-sem-ponto-virgula',
    '17-inv-dupla-chave', '18-inv-parentese-extra', '19-inv-colchete-fechando',
    '20-inv-typedef-sem-tipo', '24-inv-enum-sem-chave', '31-inv-lambda-sem-parentese',
    '32-inv-sb-sem-colchete', '35-inv-static-assert-sem-msg', '36-inv-extern-c-sem-chave',
    '38-inv-const-sem-tipo', '40-inv-long-sem-tipo', '42-inv-int-com-int',
    '43-inv-duplo-const', '47-inv-funcao-sem-corpo',
  ],
  'posicao-v2': [
    '01-inv-falta-ponto-virgula', '03-inv-falta-chave', '04-inv-else-sem-if',
    '05-inv-int-igual', '06-inv-template-nao-fechado', '08-inv-struct-sem-ponto-virgula',
    '09-inv-if-sem-parentese', '10-inv-while-sem-parentese', '11-inv-for-sem-parentese',
    '12-inv-switch-sem-parentese', '13-inv-return-sem-ponto-virgula', '16-inv-decl-sem-tipo',
    '21-inv-using-sem-nome', '22-inv-namespace-sem-chave', '23-inv-class-sem-ponto-virgula',
    '25-inv-cast-sem-tipo', '27-inv-delete-sem-expr', '28-inv-operator-sem-nome',
    '29-inv-template-sem-menor', '34-inv-static-assert-sem-expr', '44-inv-ref-sem-nome',
    '45-inv-ptr-sem-nome', '53-inv-default-sem-switch', '56-inv-goto-sem-label',
    '57-inv-label-sem-dois-pontos', '60-inv-template-sem-tipo',
  ],
};

/** Rotulos legiveis dos tres grupos. */
export const ROTULO_GRUPO = {
  'S7(d)-bugs-sintaticos': 'S7(d) — 9 bugs sintáticos',
  'aceita-indevidamente-v2': 'aceita-indevidamente — 16 do v2',
  'posicao-v2': 'posição — 26 do v2',
};
