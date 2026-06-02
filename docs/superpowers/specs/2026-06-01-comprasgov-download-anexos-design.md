# Design — Download de anexos das propostas (`/anexos`)

Data: 2026-06-01 · Projeto 2 (ComprasGov) · Autor: Leo + Claude

## Objetivo

Baixar e salvar localmente os **anexos** que os fornecedores enviam em cada
proposta (proposta comercial, habilitação, etc.), sob demanda, para os itens que
o operador pedir. Hoje isso é feito manualmente clicando arquivo por arquivo.

## Escopo (decidido no brainstorming)

- **Avulso + itens escolhidos**: comando `/anexos <compraId> <itens>` (itens em
  lista/intervalo, mesmo parser do `/raspar`, ex. `3,5,7` ou `3-7`).
- **Só salvar local** — o Telegram apenas reporta quantos arquivos por item e o
  caminho da pasta. Não envia os arquivos (podem ser .zip grandes).
- Recusa se um lote estiver `RODANDO` (a aba logada é compartilhada — mesma
  salvaguarda do `/raspar`).

## Mecanismo confirmado (recon ao vivo 2026-06-01)

Na sub-aba **Anexos** de cada card, cada arquivo tem um ícone de download
`<i class="fa-download fas">` dentro de um `<button class="br-button">`. Clicar:
1. GET na API `…/comprasnet-fase-externa/v2/compras/{compraId}/itens/{n}/participacao/{cnpj}/anexos/{arquivo}` → URL assinada do storage;
2. GET no `storagegw.estaleiro.serpro.gov.br/…` → o navegador dispara um
   **`download` event** do Playwright com `suggestedFilename()` = nome real.

Logo: **clicar o botão + `page.waitForEvent('download')` + `download.saveAs()`**.

⚠️ Excluir o botão do header `aria-label="Downloads relacionados a compra"`
(`app-botao-relatorios-compra`) — esse é da compra/edital, não da proposta.

Cards sem anexo mostram "Nenhum anexo enviado." (anexos são esparsos).

## Fluxo por item

1. `goto` na rota logada `/seguro/fornecedor/acompanhamento-compra/item/{n}?compra={id}` + `verificarSessao`.
2. Expandir: "Mostrar detalhes do item" → aba "Todas as propostas" → expandir cada card → clicar a sub-aba **"Anexos"** de cada card (clique real do Playwright — o sintético não dispara o Angular).
3. Enumerar os botões de download por-arquivo (`button:has(i.fa-download):not([aria-label*="relacionados"]):not([aria-label*="compra"])`). Para cada um: descobrir o CNPJ do card (subir até o ancestral com 1 CNPJ), `waitForEvent('download')`, clicar, `saveAs`.
4. Dedup por `(cnpj, nome)` — evita rebaixar o mesmo arquivo.

## Onde salva

```
comprasgov-browser/dados/anexos/<compraId>/item_<n>/<cnpj_digits>/<nome_do_arquivo>
```
Nome do arquivo sanitizado para o filesystem (Windows): troca `<>:"/\|?*` e controles por `_`.

## Componentes

- **`anexos-runner.js`** (novo): `baixarAnexosItens({ page, compraId, itens, telegram })`
  + helpers puros `_cnpjDigits`, `_sanitizeNome`, `_pastaAnexos`.
  Reusa `sleep`/`log` de `raspar-propostas-cdp` e `verificarSessao` de `comprasgov`.
  Navegação por `navegarParaItemGoto` (exportado de `lote-runner`).
- **`telegram.js`**: comando `/anexos` (parser de itens reusado) + `setAnexosCallback`.
- **`server.js`**: callback `/anexos` → acha a aba logada → `baixarAnexosItens`, com guarda de lote `RODANDO` e lock contra concorrência (igual `/raspar`).

## Testes (TDD)

- `_cnpjDigits`, `_sanitizeNome`, `_pastaAnexos` (puros).
- Parser de itens do `/anexos` (reusa `_parseItens`).
- Guarda: `/anexos` recusa com lote RODANDO.
- A interação com o DOM (`baixarAnexosDoItem`) é validada ao vivo (como o fluxo de marca/modelo), não em unit test.

## Fora de escopo (YAGNI)

- Enviar arquivos pelo Telegram / zipar (decidido: só local).
- Baixar no lote completo ou só do vencedor (escopo é avulso por itens).
- Anexos de nível da compra/edital ("Downloads relacionados a compra").
