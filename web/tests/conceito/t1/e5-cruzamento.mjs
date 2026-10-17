/**
 * tests/conceito/t1/e5-cruzamento.mjs — quanto do que o T1 achou ja se sabia?
 *
 * Pergunta que o T1 tem de responder para valer alguma coisa: os 3 266
 * divergencias sao os mesmos bugs do catalogo, ou ha populacao nova?
 *
 * O cruzamento NAO e por nome de ficheiro (o corpus do T1 e feito de mutacoes,
 * nao de fixtures). E por CONSTRUCAO: cada entrada do catalogo e passed pelo
 * mesmo pipeline do T1 (E1 -> E3), e vemos em que quadrante cai. Assim
 * "o T1 achou o bug do `int int x;`" e uma afirmacao verificada, e nao uma
 * semantica.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { classificaCaso, ROTULOS } from './e3-classificar.mjs';
import { CATALOGO, ROTULO_GRUPO } from './catalogo.mjs';
import { julgar } from './runner.mjs';

const RAIZ = new URL('../../../', import.meta.url).pathname;

/** As tres listas do catalogo conhecido, com os caminhos reais. */
const CATALOGO = {
  'S7(d) — 9 bugs sintaticos': [
    '19-inv-colchete-fechando', '20-inv-typedef-sem-tipo', '24-inv-enum-sem-chave',
    '36-inv-extern-c-sem-chave', '42-inv-int-com-int', '43-inv-duplo-const',
    '47-inv-funcao-sem-corpo', '58-inv-typedef-sem-nome', '59-inv-enum-class-sem-nome',
  ],
  'aceita-indevidamente (16 do v2)': [
    '14-inv-break-sem-ponto-virgula', '15-inv-continue-sem-ponto-virgula',
    '17-inv-dupla-chave', '18-inv-parentese-extra', '19-inv-colchete-fechando',
    '20-inv-typedef-sem-tipo', '24-inv-enum-sem-chave', '31-inv-lambda-sem-parentese',
    '32-inv-sb-sem-colchete', '35-inv-static-assert-sem-msg', '36-inv-extern-c-sem-chave',
    '38-inv-const-sem-tipo', '40-inv-long-sem-tipo', '42-inv-int-com-int',
    '43-inv-duplo-const', '47-inv-funcao-sem-corpo',
  ],
  'posicao (26 do v2)': [
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

async function classificaFixture(nome) {
  for (const dir of ['parse-invalid', 'parse-valid']) {
    const p = join(RAIZ, 'tests', 'fixtures', dir, `${nome}.cpp`);
    try {
      const src = readFileSync(p, 'utf8');
      const r = await julgar(src, `x-${nome}`);
      return {
        nome, caminho: p.replace(`${RAIZ}/`, ''), achou: true,
        quadrante: classificaCaso({
          nOk: r.nosso.ok, nErros: r.nosso.nErros,
          gOk: r.gpp.ok, gMsg: r.gpp.msg, gErro1: r.gpp.erro1,
          gTimeout: r.gpp.timeout, nLancou: r.nosso.lancou === true,
        }),
        gMsg: r.gpp.msg,
        nErro1: r.nosso.erro1,
        fonte: src,
      };
    } catch { /* tenta o outro diretorio */ }
  }
  return { nome, achou: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const relatorio = {};
  for (const [grupo, lista] of Object.entries(CATALOGO)) {
    console.log(`=== ${ROTULO_GRUPO[grupo]} ===`);
    const linhas = [];
    for (const n of lista) {
      const c = await classificaFixture(n);
      if (!c.achou) { console.log(`  ${n}: FIXTURE NAO ENCONTRADA`); continue; }
      linhas.push(c);
      const bug = ROTULOS[c.quadrante]?.bug ? 'BUG' : '-';
      console.log(`  ${c.quadrante.padEnd(32)} ${bug.padEnd(4)} ${n}`);
    }
    const comBug = linhas.filter((l) => ROTULOS[l.quadrante]?.bug).length;
    const comoSilenciosa = linhas.filter((l) => l.quadrante === 'ACEITACAO-SILENCIOSA').length;
    console.log(`  -> ${comBug} de ${linhas.length} sao divergencia com bug`
      + ` (${comoSilenciosa} como aceitacao silenciosa)`);
    console.log('');
    relatorio[grupo] = linhas;
  }

  writeFileSync(`${RAIZ}reports/conceito/t1-e5-cruzamento.json`,
    `${JSON.stringify(relatorio, null, 1)}\n`);
  writeFileSync('/tmp/opencode/t1-e5-cruzamento.json',
    readFileSync(`${RAIZ}reports/conceito/t1-e5-cruzamento.json`, 'utf8'));
  console.log('gravado: reports/conceito/t1-e5-cruzamento.json');
}
