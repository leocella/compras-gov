# Reconhecimento dos seletores do form de resposta ao pregoeiro

> **Por que isso é necessário:** o `comprasgov.js:responderMensagem` precisa saber quais elementos da página de chat representam (1) o link/botão que abre o form de resposta, (2) o textarea/input do texto e (3) o botão "Enviar". Esses seletores variam entre versões do portal e precisam ser identificados ao vivo.

> **Quem executa:** humano com acesso VNC à VPS, sessão logada no ComprasGov, com permissão de mandar mensagem em algum pregão (idealmente um pregão **encerrado** ou de teste para evitar envios acidentais).

---

## Pré-requisitos

- VPS rodando: Xvfb + Chrome real em modo debug (`scripts/start-vnc.sh` e `scripts/start-chrome.sh`)
- Você logado no ComprasGov (sessão persistida em `/opt/chrome-profile`)
- VNC viewer conectado em `72.60.2.102:5900`
- Server.js rodando (`cd /opt/comprasgov-browser/comprasgov-browser && node server.js`)

---

## Roteiro

### 1. Navegar até um chat com botão de responder

Pelo VNC, no Chrome:
1. Acesse um pregão onde você consegue mandar mensagem (ex: pregão em andamento que você é fornecedor)
2. Abra o chat do pregão
3. Localize visualmente o botão/link que abre o form de resposta — clique nele

### 2. Inspecionar o form aberto

No Chrome via VNC, com o form aberto:
1. Botão direito no campo de texto da resposta → **Inspecionar elemento**
2. No DevTools, anote:
   - O seletor CSS do **textarea** (campo de input)
   - O seletor CSS do **botão "Enviar"**
3. Inspecione também o link/botão que você clicou para abrir o form (anote o seletor)

### 3. Validar os seletores no Console do DevTools

Cole no console (Ctrl+Shift+J) um por vez e verifique se cada um retorna o elemento certo:

```js
document.querySelector('SEU_SELETOR_DO_LINK_RESPONDER')
document.querySelector('SEU_SELETOR_DO_CAMPO_RESPOSTA')
document.querySelector('SEU_SELETOR_DO_BOTAO_ENVIAR')
```

Cada chamada deve retornar um único elemento (não `null`, não `undefined`).

### 4. Testar interação básica (sem submeter)

Ainda no console:

```js
// Preencher o textarea sem submeter
document.querySelector('SEU_SELETOR_DO_CAMPO_RESPOSTA').value = 'TESTE — não enviar';
document.querySelector('SEU_SELETOR_DO_CAMPO_RESPOSTA').dispatchEvent(new Event('input', { bubbles: true }));
```

Confirme visualmente que o texto apareceu no campo. **NÃO clique em enviar.**

### 5. Salvar HTML da página para referência

Ainda com o form aberto, na VPS (em outra sessão Termius):

```bash
mkdir -p /opt/comprasgov-browser/comprasgov-browser/recon
cp /opt/chrome-profile/Default/last-tab.html /opt/comprasgov-browser/comprasgov-browser/recon/chat-resposta.html 2>/dev/null

# Alternativa via endpoint:
curl -H "X-API-Key: $API_KEY" \
  "https://compras.infra-cellaflux.online/recon/html?nome=chat-resposta"
```

Isso salva o HTML em `recon/chat-resposta.html` para consulta futura.

### 6. Atualizar SEL_MSG no código

Edite `comprasgov-browser/comprasgov.js`, no objeto `SEL_MSG`:

```js
const SEL_MSG = {
  // ... valores existentes ...

  linkResponder: 'SEU_SELETOR_DO_LINK_RESPONDER',
  campoResposta: 'SEU_SELETOR_DO_CAMPO_RESPOSTA',
  botaoEnviar:   'SEU_SELETOR_DO_BOTAO_ENVIAR',
};
```

### 7. Commit + deploy

```bash
git add comprasgov-browser/comprasgov.js
git commit -m "feat(comprasgov): selectors do form de resposta após recon"
git push
```

Na VPS:
```bash
cd /opt/comprasgov-browser
git pull
# reinicia o server.js
```

### 8. Teste end-to-end em dry-run

Com `TELEGRAM_RESPONDER_DRY_RUN=true` no `.env`:

```bash
curl -X POST https://compras.infra-cellaflux.online/mensagens/responder \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"compraId":"<COMPRA_DE_TESTE>","texto":"TESTE — preencher mas não enviar"}'
```

Resposta esperada: `{ "sucesso": true, "modo": "dry-run", "preenchido": true, ... }`

Via VNC, abra a aba do Chrome e confirme:
- O texto está no campo de resposta
- O form está aberto
- **Não foi clicado** em enviar

Feche a aba. **Sucesso!**

---

## Dicas para identificar seletores robustos

- **Prefira `data-*` attributes** se existirem — são mais estáveis que classes CSS
- **Evite IDs gerados automaticamente** (ex: `id="ng_5_input"` que muda entre builds)
- **Use seletores de texto** quando possível: `button:has-text("Enviar")`
- **Se o seletor for muito específico**, teste em mais de um pregão para confirmar que não é único àquela página

## Se algum seletor não funcionar

- Verifique se o form realmente abre antes da inspeção (pode ser carregamento assíncrono)
- Use `page.waitForSelector()` em vez de `page.click()` para esperar o elemento aparecer
- Capture screenshot via `GET /screenshot?sessao=1` para ver o estado real da página

---

## Pendências conhecidas

- A função `responderMensagem` em `comprasgov.js` valida que os 3 seletores estão preenchidos antes de tentar usar — se algum estiver vazio, retorna erro claro pedindo para executar este recon.
- Logs de auditoria de toda chamada vão para `comprasgov-browser/dados/respostas-pregoeiro.log`.
