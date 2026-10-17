// Worker usado por T4: entra em laço infinito. NÃO responde ping de propósito
// (o laço síncrono bloqueia o próprio onmessage) — medir atividade pelo contador global.
let x = 0;
for (;;) { x = (x + 1) % 1000003; }