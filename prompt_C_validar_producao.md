# Prompt C — Validar e colocar em produção o fluxo de raspagem em lote

## CONTEXTO

Você está em `C:\Users\leo-p\OneDrive\Documentos\RAFAEL_PRIMO`. O projeto `comprasgov-browser/` já tem:

- Cliente CDP funcional (`raspar-propostas-cdp.js`) que conecta no Chrome real e itera itens via `pushState`
- Agendador (`agendador.js`) com job diário + polling de mensagens
- Bot Telegram (`telegram.js`) com notificações funcionais
- Lista de compras-alvo (`compras-alvo.json`) que vai ser populada com 46 entradas via Prompt A

**A feira do Rafael é em 1 dia.** Esta é a tarefa de fechamento: validar que o fluxo end-to-end funciona em produção, com tratamento robusto de sessão expirada e visibilidade do que está acontecendo via Telegram.

**LEIA OBRIGATORIAMENTE antes de propor qualquer mudança:**

1. `comprasgov-browser/raspar-propostas-cdp.js` — entender como funciona hoje a navegação por `pushState`
2. `comprasgov-browser/raspar-lote.js` — entender como o lote itera as compras
3. `comprasgov-browser/agendador.js` — entender o `jobScrapingDiario` e o `jobMensagensPregoeiro`
4. `comprasgov-browser/sessao.js` — entender como a sessão é gerenciada hoje
5. `comprasgov-browser/comprasgov.js` — função `rasparItensPregao` e os seletores
6. `comprasgov-browser/telegram.js` — funções `enviar` e `notificarMudancas`

## A MECÂNICA DE NAVEGAÇÃO QUE PRECISA SER RESPEITADA

Confirmada com o usuário, **essa é a única forma que funciona** no ComprasGov SPA Angular:

1. **Login + CAPTCHA são manuais.** Sempre. CAPTCHA expira e precisa de interação humana de novo. **Nunca tentar automatizar essa etapa.**
2. **URL "verdinha" (hub do pregão):**
   ```
   https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/acompanhamento-compra?compra={COMPRA_ID}
   ```
   Essa é a página inicial da compra. Mostra status geral, lista de itens, chat geral.
3. **URL "com item" (detalhe):**
   ```
   https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/acompanhamento-compra/item/{N}?compra={COMPRA_ID}
   ```
   Onde aparecem propostas e chat específico do item.
4. **Fluxo correto:**
   1. Abrir a aba na URL **sem item** (verdinha) e aguardar SPA carregar
   2. Modificar a URL **da mesma aba** para `item/N` via `pushState` (ou clicar no item)
   3. **NÃO fazer `page.goto()` direto na URL com item** — isso recarrega tudo e quebra a sessão Angular interna.
5. **Modelo de execução para o lote:**
   - Manter UMA sessão de Chrome aberta o tempo todo (Chrome real via CDP, perfil persistente)
   - Para cada compra do lote: abrir nova aba na URL verdinha → iterar itens via pushState → fechar aba
   - Entre compras, **não fechar o Chrome.** Só fechar/abrir abas.

**Exemplos confirmados com o usuário:**
- Sem item: `https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/acompanhamento-compra?compra=15838305900012026`
- Com item 2: `https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/acompanhamento-compra/item/2?compra=15838305900012026`

## O PROBLEMA QUE PRECISA SER RESOLVIDO

Hoje o agendador roda sem saber se a sessão está válida. Quando o CAPTCHA expira (acontece durante o dia), o agendador continua tentando, dá erro silencioso, e o Rafael não fica sabendo. **Durante a feira isso é inaceitável.**

Precisa de:

1. **Detecção precoce de sessão expirada** — antes de tentar raspar, verificar se a sessão ainda está válida.
2. **Notificação Telegram imediata** quando a sessão cair — pra Rafael ou Leo ir resolver.
3. **Pausa graciosa do lote** — se cair no meio do lote, pausar e retomar de onde parou, não recomeçar do zero.
4. **Visibilidade do progresso** — ver pelo Telegram quantas compras já foram processadas no lote diário.

## TAREFAS

### Tarefa 1 — Diagnóstico do que existe

1. Ler os 6 arquivos listados em CONTEXTO.
2. Me apresentar (em até 10 bullets):
   - Como o `raspar-lote.js` itera as compras hoje
   - Onde no código a sessão é verificada (se for verificada)
   - O que acontece hoje quando a sessão expira no meio de um lote
   - O que `agendador.js` faz quando o scraping retorna erro
   - Se existe algum mecanismo de "retomar de onde parou" hoje
   - Onde no código a URL "com item" é construída (procurar por `acompanhamento-compra/item`)
   - Se o `pushState` já é usado conforme a mecânica que descrevi acima, ou se faz `goto` direto

**Parar aqui e aguardar minha confirmação.** Não escrever código ainda. Esse diagnóstico é o que vai me dizer o tamanho real da mudança.

### Tarefa 2 — Plano de implementação (sem código)

Depois que eu confirmar o diagnóstico:

Me apresentar um plano em formato de checklist com:

1. **Função `verificarSessao(page)`** — qual seletor / heurística usar pra detectar sessão válida (ex: presença de elemento que só existe quando logado; ausência de redirect pra tela de login).
2. **Onde encaixar a verificação** — chamar antes de cada compra do lote? Antes de cada item? No início do job?
3. **Função `notificarSessaoExpirada()`** — usar `telegram.enviar()` com texto claro + link da página de login.
4. **Estado de "lote em andamento"** — onde persistir (sugiro arquivo JSON em `dados/lote-estado-<data>.json` com `{compras_pendentes, compras_concluidas, ultima_falha}`).
5. **Comando `/retomar` no bot** — depois que Rafael relogar, ele manda `/retomar` no Telegram e o agendador continua de onde parou.
6. **Notificação de progresso** — a cada N compras processadas (sugiro 5), enviar update no Telegram.
7. **Tratamento de erro por compra** — falha em uma compra não derruba o lote inteiro; loga, pula, segue.

Para cada item, dizer:
- Em qual arquivo a mudança vai
- Quantas linhas aproximadamente (pra eu calibrar o risco)
- Se requer mudança no schema de algum arquivo existente

**Parar aqui.** Eu reviso o plano antes de você escrever qualquer linha.

### Tarefa 3 — Implementação (em ordem específica, com checkpoint por etapa)

Implementar **uma etapa por vez**, parando após cada uma:

#### Etapa 3.1 — `verificarSessao`
1. Adicionar função em `comprasgov.js` (não criar arquivo novo).
2. Retornar `{ valida: boolean, motivo: string | null }`.
3. Testar manualmente (eu rodo um script ad-hoc) antes de continuar.

#### Etapa 3.2 — Persistência de estado do lote
1. Criar `comprasgov-browser/lote-estado.js` com funções `iniciarLote`, `marcarConcluida`, `marcarFalha`, `obterEstado`, `limpar`.
2. Persistir em `dados/lote-estado.json` (single file, último lote sobrescreve).
3. Schema:
   ```json
   {
     "iniciado_em": "ISO datetime",
     "compras_pendentes": ["compraId1", "compraId2"],
     "compras_concluidas": ["compraId3"],
     "compras_falhas": [{"compraId": "...", "motivo": "...", "tentativas": N}],
     "status": "rodando" | "pausado_sessao_expirada" | "concluido"
   }
   ```

#### Etapa 3.3 — Refatorar `raspar-lote.js`
1. Antes de cada compra, chamar `verificarSessao`.
2. Se inválida: marcar lote como `pausado_sessao_expirada`, notificar Telegram, sair com exit code 0 (não 1 — não é erro, é pausa esperada).
3. Se válida: processar compra, marcar como concluída.
4. Falha de raspagem (não-sessão) numa compra: logar, marcar como falha com motivo, seguir pra próxima.
5. **Não tocar na lógica de pushState que já existe** — só adicionar wrappers em volta.

#### Etapa 3.4 — Comando `/retomar` no `telegram.js`
1. Adicionar handler no polling.
2. Ao receber `/retomar` de chat autorizado: verificar se há lote pausado em `lote-estado.json`. Se houver, disparar `raspar-lote.js` filtrando só pelas pendentes.
3. Resposta no chat: `"Retomando lote: X compras pendentes."` ou `"Não há lote pausado."`.

#### Etapa 3.5 — Notificação de progresso
1. No `raspar-lote.js`, a cada 5 compras concluídas: enviar update no Telegram com `"Lote: X/Y concluídas."`.
2. No fim do lote: `"Lote concluído: X sucesso, Y falhas."` + lista das falhas.

#### Etapa 3.6 — Integração com `agendador.js`
1. `jobScrapingDiario` deve usar a nova lógica em vez de chamar raspagem direto.
2. Se já havia um lote do dia anterior pausado, **não iniciar novo** — só notificar e aguardar `/retomar`.

### Tarefa 4 — Testes manuais antes de produção

Sequência de testes que **eu (Leo) vou executar** e te reportar o resultado. Você só prepara os comandos:

1. **Sessão válida + 1 compra pequena:** rodar o lote com uma única compra-alvo, sessão fresca. Esperado: conclui, notifica progresso, marca como concluída no estado.
2. **Sessão expirada antes do lote:** matar a sessão manualmente (deslogar no Chrome), rodar o lote. Esperado: detecta, notifica no Telegram, sai gracioso, estado fica `pausado_sessao_expirada`.
3. **Sessão expira no meio:** rodar lote com 3 compras-alvo, deslogar no Chrome após a 1ª terminar. Esperado: 1ª concluída, 2ª detecta expirada, pausa, 3ª fica como pendente.
4. **Comando /retomar:** após teste 3, relogar no Chrome, mandar `/retomar` no Telegram. Esperado: processa só as 2 pendentes, não retenta a já concluída.
5. **Falha de raspagem isolada:** apontar uma compra-alvo pra um ID inválido. Esperado: marca como falha, segue pra próxima, não pausa o lote.

Para cada teste:
- Comando exato pra eu rodar
- Logs esperados (o que devo ver no terminal)
- Mensagens esperadas no Telegram
- Como reverter / limpar o estado entre testes

### Tarefa 5 — Smoke test em produção (na VPS)

Só depois que os 5 testes locais passarem:

1. Comandos pra fazer deploy na VPS (sugerir, eu executo):
   - `git push origin main`
   - `ssh` na VPS, `git pull`, `npm install` (se houver dep nova), reiniciar servidor
2. Forma de verificar que o agendador subiu e está rodando (`tail -f server.log` ou similar).
3. Comando pra disparar manualmente um lote (sem esperar o cron), com uma única compra de teste real.
4. Checklist de validação pós-deploy.

### Tarefa 6 — Documentação rápida pro Rafael

Criar `comprasgov-browser/docs/OPERACAO-FEIRA.md` com:

1. **O que esperar:** quais notificações chegam no Telegram, em que momento.
2. **Cenário "sessão expirou":** o que fazer (link da VPS via VNC, login manual no Chrome, mandar `/retomar` no bot).
3. **Cenário "uma compra deu erro":** como ver a lista de falhas e como retentar manualmente.
4. **Quem chamar:** Leo, telefone/Telegram.
5. **Comandos do bot:** listar todos os comandos disponíveis (`/responder`, `/retomar`, etc.).

Português claro, em formato de cartão de referência. **Sem jargão técnico.**

## REGRAS

1. **Nunca mudar a mecânica de pushState** já existente em `raspar-propostas-cdp.js`. Só adicionar wrappers.
2. **Nunca tentar automatizar login ou CAPTCHA.** É sempre manual.
3. **Sempre usar CDP** (`chromium.connectOverCDP`). Nunca `launch`.
4. **Não criar dependências novas** sem necessidade. Stack atual (Node stdlib + Playwright + node-cron) deve ser suficiente.
5. **Cada tarefa para e aguarda confirmação.** Em especial as 3.1 a 3.6 — não emendar.
6. **Se encontrar algo no código que contradiz o que descrevi, parar e me perguntar.** O snapshot do projeto pode estar levemente desatualizado.
7. **Testes locais antes de VPS.** Sem exceção.
8. Idioma: português.

## PRIORIDADE

Estamos a 1 dia da feira. Se em qualquer etapa você perceber que a mudança é maior do que o plano estimou, **parar e me avisar imediatamente.** Melhor ter um sistema com menos features e 100% confiável do que tudo implementado e flaky.
