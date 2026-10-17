# Ownership de arquivos compartilhados (Passo 0, item 4)

Este documento define quem é o "dono" de cada arquivo compartilhado que pode ser modificado por múltiplos agentes. O princípio é: **cada arquivo tem um único dono; outros agentes registram pedidos em `reports/<AGENTE>/pedidos.md` ao invés de editar diretamente**.

## Arquivos de configuração de testes

| Arquivo | Dono | Quem pode modificar | Como pedir alteração |
|---|---|---|---|
| `playwright.config.js` | **A0** (coordenação) | A0, A3 (browser) | Pedido em `reports/<AGENTE>/pedidos.md` |
| `playwright.config.js` | A3 (browser tests) | A3 | A3 modifica diretamente |
| `playwright.config.js` | A1 (preprocessor tests) | A0 | Pedido em `reports/A1/pedidos.md` |
| `playwright.config.js` | A2 (parser tests) | A0 | Pedido em `reports/A2/pedidos.md` |
| `tests/global-setup.js` | **A0** | A0 | Pedido em `reports/<AGENTE>/pedidos.md` |
| `tests/global-teardown.js` | **A0** | A0 | Pedido em `reports/<AGENTE>/pedidos.md` |
| `tests/server-utils.js` | **A0** | A0, A3 | Pedido em `reports/<AGENTE>/pedidos.md` |

## Arquivos de mapeamento e estado

| Arquivo | Dono | Quem pode modificar | Como pedir alteração |
|---|---|---|---|
| `tests/tools/module-map.json` | **A0** (integração) | A0 (regeneração) | A0 regenera no merge; A1/A2/A3/A4 adicionam entradas via pedido |
| `tests/tools/gen-estado.mjs` | **A0** | A0 | Pedido em `reports/<AGENTE>/pedidos.md` |
| `docs/estado.md` | **A0** (regeneração) | A0 (via `npm run gen-estado`) | Nunca editar à mão; A0 regenera no merge |
| `docs/baseline-jscpp.md` | **A0** (baseline) | A0 | Pedido em `reports/<AGENTE>/pedidos.md` |
| `docs/relatorio-portao-b.md` | **A0** (histórico) | A0 | Pedido em `reports/<AGENTE>/pedidos.md` |

## Regras de operação

1. **Regeneração na integração**: `module-map.json`, `estado.md` e `relatorio-portao-b.md` são regenerados **apenas no merge em `fase2-wip`**, nunca dentro de worktrees de feature.
2. **Pedidos formais**: Se um agente precisa de mudança em arquivo de outro dono, cria entrada em `reports/<SEU_ID>/pedidos.md` com:
   - Arquivo e linha
   - Motivo da mudança
   - Teste que valida a mudança
3. **Resolução de conflitos**: Conflitos em arquivos compartilhados resolvem-se regenerando (para `estado.md`, `module-map.json`) ou pelo dono (para `playwright.config.js`).

## Exemplo de pedido

Arquivo: `reports/A1/pedidos.md`
```
## Pedido A1 → A0: playwright.config.js

Arquivo: playwright.config.js
Linha: 15 (baseURL)
Motivo: A1 precisa de baseURL diferente para testar includes relativos
Teste: tests/fixtures/pp-inc/caso9-demo/ (novo caso de teste)
```
BASE_PARSER=68ae1b9

## Baseline do parser (A3 v1)

`BASE_PARSER=68ae1b9` — último commit **antes** do merge de A2
(`Merge wp-a2` = `9c54a27`). É nele que o A3 v1 mede o parser antes das
correções, para produzir a lista inicial de divergências.

Worktree:

```
git worktree add ../wt-a3-base 68ae1b9 --detach
```

`BASE_PARSER=68ae1b9`
