# Design — Raspagem de itens avulsos via Telegram (`/raspar`)

Data: 2026-05-26
Projeto: ComprasGov Automation (PROJETO 2)
Autor: Leo (dev) — cliente/operador: Rafael

## Objetivo

Permitir, pelo Telegram, raspar **apenas itens específicos** de um pregão e receber
um Excel só com esses itens. Útil para "preencher buracos" quando o lote pulou itens
ou quando o Rafael quer conferir itens pontuais sem rodar um lote inteiro.

Hoje o bot tem apenas `/responder` (resposta ao pregoeiro) e `/retomar` (retoma lote
pausado). Não existe disparo de raspagem sob demanda — é o que este spec adiciona.

Escopo decidido no brainstorming:
- **Entrada:** compraId (17 dígitos) + lista de itens.
- **Saída:** Excel contendo **somente** os itens pedidos, enviado no Telegram.
- **Sem** mesclar com Excel anterior; **sem** tocar em `lote-estado.json`.

A validação ao vivo do lote (pedida junto) é operacional — não gera código novo. Este
comando, porém, é o melhor instrumento para esse teste: valida itens pontuais em
segundos em vez de rodar o lote completo.

## Abordagem escolhida

**A — Função isolada `rasparItensEspecificos()` em `lote-runner.js`**, reusando o motor
de extração existente (`navegarParaItemGoto`, `recuperarCompra`, `extrairDadosPaginaAtual`,
`verificarSessao`, `gerarExcel`). Fiação no Telegram espelhando o padrão `/retomar`.

Rejeitadas: estender `executarLote` (arrisca regressão no caminho do lote que se quer
manter estável); script CLI sem Telegram (contraria o pedido).

## Componentes

### 1. Parser de itens (telegram.js, função pura)

`_parseItens(spec) → number[]`
- Aceita lista e intervalos combinados: `3,5,7`, `3-7`, `1-3,5,8`.
- Resultado deduplicado e ordenado crescente.
- Cada número validado como inteiro em `[1, 200]` (mesmo teto do `ITENS_LIMITE` do lote).
- Entrada vazia, não-numérica, intervalo invertido (`7-3`) ou fora de faixa → lança erro
  com mensagem clara, capturada pelo handler para responder o uso.

### 2. Handler do comando (telegram.js)

No loop de polling, antes do bloco de "chave de detalhe":
```
if (texto.startsWith('/raspar ') || texto === '/raspar') {
  await _processarSlashRaspar(texto, chatId);
  continue;
}
```

`_processarSlashRaspar(texto, chatId)`:
- Regex: `^/raspar\s+(\S+)\s+([\s\S]+)$` → `compraId`, `itensSpec`.
- Sem match → responde `Uso: /raspar <compraId> <itens>  (ex: /raspar 15838305900012026 3,5,7)`.
- `compraId` precisa casar `^\d{17}$` → senão responde erro de formato.
- `_parseItens(itensSpec)` → em erro, responde a mensagem do erro.
- Chama `_onRaspar({ compraId, itens }, chatId)` (callback registrado via `setRasparCallback`).
- Se callback não registrado → responde `❌ /raspar não configurado neste servidor`.

`setRasparCallback(fn)` / `_getRasparCallback()` seguem o padrão dos demais callbacks,
e `setRasparCallback` é adicionado ao `module.exports`.

### 3. Callback no server.js (`telegram.setRasparCallback`)

Registrado junto dos outros, dentro do bloco de init do Telegram. Espelha `/retomar`:
- `const estado = loteEstado.obterEstado();` — se `estado?.status === loteEstado.STATUS.RODANDO`
  → retorna `⏳ Lote rodando agora; aguarde concluir/pausar antes de raspar itens avulsos.`
  (a aba logada é compartilhada — não atropelar um lote em andamento).
- Lock em memória `_avulsaEmAndamento` (boolean no escopo do server): se já `true`
  → retorna `⏳ Já há uma raspagem avulsa em andamento.`
- Acha a aba logada:
  `browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/'))`.
  Se não houver → retorna instrução de login (mesma do `/retomar`).
- Fire-and-forget: seta `_avulsaEmAndamento = true`, chama
  `rasparItensEspecificos({ page: pageLogada, compraId, itens, telegram })`, e no
  `.finally()` zera `_avulsaEmAndamento`. Erros são logados e notificados no Telegram
  dentro da própria função.
- Retorna imediatamente: `🔍 Raspando itens <lista> de <compraId>… Resultado chega aqui.`

### 4. `rasparItensEspecificos()` (lote-runner.js)

Assinatura:
```
async function rasparItensEspecificos({ page, compraId, itens, telegram = null })
  → { itensOk: number[], itensVazios: number[] }
```

Fluxo:
1. `verificarSessao(page)`. Se inválida → `telegram.enviar('⚠️ Sessão expirada…')` e
   retorna sem raspar nada. **Não** mexe em `lote-estado`.
2. Para cada `n` em `itens` (em ordem):
   - `navegarParaItemGoto(page, compraId, n)`.
   - Se `!ok && motivo === 'compra_nao_encontrada'` → `recuperarCompra(page, compraId)`
     1x, depois re-tenta `navegarParaItemGoto`.
   - Se ainda `!ok` → registra `n` em `itensVazios`, segue para o próximo (não quebra).
   - `extrairDadosPaginaAtual(page, n)`. Sem `dados.dadosItem.descricao` → `itensVazios`,
     segue. Caso contrário → `resultados.push(dados)` e `itensOk.push(n)`.
   - `await sleep(DELAY_ITEM)` entre itens.
   - `try/catch` por item: erro → loga, `itensVazios.push(n)`, continua.
3. Pós-loop:
   - `resultados.length === 0` → `telegram.enviar('❌ Nenhum dos itens pedidos retornou dados.')`,
     não gera Excel.
   - Senão → `sufixo = 'ITENS_' + itensOk.join('-') + '_' + Date.now()`;
     `gerarExcel(resultados, compraId, { sufixo })`; `telegram.enviarDocumento(path, legenda)`
     onde a legenda informa itensOk e, se houver, itensVazios.
   - **Sem** `salvarSnapshot` (avulso não é retomável).
4. Retorna `{ itensOk, itensVazios }`.

`rasparItensEspecificos` é adicionada ao `module.exports` do lote-runner.

### 5. Nome do Excel — `gerarExcel` (raspar-propostas-cdp.js)

Mudança retrocompatível:
```
async function gerarExcel(resultados, compraId, opts = {}) {
  ...
  const sufixo = opts.sufixo || 'RASPAGEM';
  const nome = `Resultados_CN_${compraId}_${sufixo}.xlsx`;
  ...
}
```
Sem `opts` → nome idêntico ao atual (`Resultados_CN_<id>_RASPAGEM.xlsx`). Garante que o
avulso nunca sobrescreva o Excel completo do lote.

## Fluxo de dados

```
Telegram /raspar <id> <itens>
  → telegram._processarSlashRaspar (parse + validação)
    → server _onRaspar (checa lote rodando / lock / acha aba logada)
      → lote-runner.rasparItensEspecificos (loop itens na aba logada do Chrome)
        → raspar-propostas-cdp: extrairDadosPaginaAtual + gerarExcel({sufixo})
          → telegram.enviarDocumento (Excel só com os itens)
```

## Tratamento de erros (resumo)

| Situação | Comportamento |
|----------|---------------|
| Sintaxe inválida | Mensagem de uso, nada executado |
| compraId ≠ 17 dígitos | Mensagem de formato |
| itens inválidos/fora de faixa | Mensagem do parser |
| Lote rodando | Recusa (aba compartilhada) |
| Outra avulsa em andamento | Recusa (lock em memória) |
| Sem aba logada | Instrui login |
| Sessão expirada | Avisa, aborta, não persiste |
| Item inacessível/sem dados | Vai para `itensVazios`, segue |
| Todos vazios | Avisa, não gera Excel |
| Erro num item | Loga, `itensVazios`, segue |

`_avulsaEmAndamento` sempre liberado em `finally`.

## Testes

Unitários (sem browser):
- `_parseItens`: `3,5,7` → `[3,5,7]`; `3-7` → `[3,4,5,6,7]`; `1-3,5,8` → `[1,2,3,5,8]`;
  dedup (`3,3,5` → `[3,5]`); erros: vazio, `abc`, `7-3`, `0`, `201`.
- `gerarExcel` com `opts.sufixo`: confirma nome `Resultados_CN_<id>_ITENS_…xlsx` e que
  sem `opts` mantém `_RASPAGEM`.

Validação ao vivo (Chrome logado do Rafael):
- `/raspar <compraId real> 1,2` → recebe Excel com 2 itens.
- Item inexistente (ex: 999) → relatado como vazio, sem quebrar.
- `/raspar` enquanto um lote está rodando → recusado.

## Fora de escopo (YAGNI)

- Mesclar com Excel/snapshot anterior.
- Retomada de raspagem avulsa (não persiste estado).
- Disparar lote completo via Telegram (continua sendo `/retomar` + CLI/cron).
- Aceitar UASG+número em vez de compraId.
