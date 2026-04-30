# Rodada 2 — Login Manual + Mensagens + Propostas (Legado)

**Data:** 2026-04-30  
**Projeto:** comprasgov-browser  
**Status:** Aprovado

---

## Contexto

A rodada 1 implementou a infraestrutura de sessão (`sessao.js`) e stubs para
`lerMensagensChat` / `responderMensagem` em `comprasgov.js`, mas todos os seletores
`SEL_MSG` ficaram marcados `⚠️ RECON_NEEDED`. A rodada 2 resolve isso.

**Restrições confirmadas:**
- A API REST do ComprasGov é fechada (sem acesso público como o PNCP).
- Mensagens e propostas ficam no portal legado `comprasnet.gov.br` — mesmo site, login único.
- Login é sempre manual (Gov.br com usuário + senha do fornecedor, sem certificado).
- Abordagem: recon ao vivo via DOM → seletores confirmados → implementação.

---

## Arquitetura — Duas Etapas Sequenciais

### Etapa A — Recon (coleta de seletores ao vivo)

Adicionar ao `server.js` 3 endpoints que operam sobre `pageSessao`:

```
POST /recon/navegar   body: { url }   → navega pageSessao para a URL
GET  /recon/html                      → salva HTML em dados/recon-<ts>.html, retorna caminho
GET  /screenshot?sessao=1             → screenshot de pageSessao (extensão do endpoint existente)
```

Fluxo de uso:
```
POST /sessao/iniciar
  → janela Chrome abre em comprasnet.gov.br/seguro/loginPortal.asp
  → Rafael loga manualmente
GET /sessao/status
  → detecta login, salva sessions/session.json
POST /recon/navegar { url: "<página de mensagens>" }
GET  /recon/html
  → arquivo HTML salvo → inspecionamos seletores reais
POST /recon/navegar { url: "<página de propostas>" }
GET  /recon/html
  → arquivo HTML salvo → inspecionamos seletores reais
```

### Etapa B — Implementação com seletores confirmados

Com URLs e seletores extraídos do HTML real, atualizamos `comprasgov.js` e `server.js`.

---

## Arquivos Alterados

| Arquivo | Mudança |
|---|---|
| `server.js` | +3 endpoints recon + `POST /pregao/propostas` |
| `comprasgov.js` | Atualiza `SEL_MSG`, adiciona `SEL_PROP`, implementa `lerPropostasPregao` |

Nenhum arquivo novo criado.

---

## Contratos de API

### Endpoints de recon

```
POST /recon/navegar
  Body:     { url: string }
  Guard:    401 se pageSessao não ativo
  Response: { sucesso: true, url: string }

GET /recon/html
  Guard:    401 se pageSessao não ativo
  Response: { sucesso: true, arquivo: "dados/recon-<timestamp>.html", bytes: number }
  Efeito:   HTML completo da página atual salvo em disco

GET /screenshot?sessao=1
  Extensão do endpoint existente.
  Com ?sessao=1 usa pageSessao. Sem o param, comportamento atual (page principal).
```

### Endpoint de propostas

```
POST /pregao/propostas
  Body:     { uasg: string, numeroPregao: string }
  Guard:    401 se pageSessao não ativo
            400 se campos faltando
            409 se busy
  Response: {
    sucesso: true,
    uasg: string,
    numeroPregao: string,
    totalPropostas: number,
    propostas: [
      {
        item:         string,
        fornecedor:   string,
        cnpj:         string,
        valorProposta: number | null,
        situacao:     string,
        marca:        string
      }
    ],
    url: string
  }
```

---

## Funções em `comprasgov.js`

### `lerMensagensChat(page, uasg, numeroPregao)`
1. Navega para `SEL_MSG.urlChat`
2. Se URL redireciona para login → lança `Error('Sessão expirada — POST /sessao/iniciar')`
3. Preenche `campoChatUasg` + `campoChatNumero`, clica `botaoChatBuscar`
4. Aguarda `networkidle`
5. Extrai linhas da tabela → `[{ remetente, dataHora, texto }]`
6. Retorna `{ mensagens, total, url }`

### `responderMensagem(page, uasg, numeroPregao, texto)`
1. Chama `lerMensagensChat` (navega + carrega página)
2. Clica `linkResponder`
3. Preenche `campoResposta` com `texto`
4. Clica `botaoEnviar`, aguarda `networkidle`
5. Retorna `{ enviado: true, url }`

### `lerPropostasPregao(page, uasg, numeroPregao)` — nova
1. Navega para `SEL_PROP.urlPropostas`
2. Se URL redireciona para login → lança erro de sessão
3. Preenche UASG + número, busca
4. Extrai tabela de propostas → `[{ item, fornecedor, cnpj, valorProposta, situacao, marca }]`
5. Retorna `{ propostas, total, url }`

**Padrão de erro de seletor:** se qualquer `fill`/`click`/`$$eval` falha por seletor não encontrado,
o erro relançado inclui `"— verifique GET /recon/html"` para facilitar debugging.

---

## Seletores (a preencher na Etapa A)

```js
const SEL_MSG = {
  urlChat:         '',  // ← recon
  campoChatUasg:   '',  // ← recon
  campoChatNumero: '',  // ← recon
  botaoChatBuscar: '',  // ← recon
  linhasMensagens: '',  // ← recon
  colMsgRemetente: '',  // ← recon
  colMsgDataHora:  '',  // ← recon
  colMsgTexto:     '',  // ← recon
  linkResponder:   '',  // ← recon
  campoResposta:   '',  // ← recon
  botaoEnviar:     '',  // ← recon
};

const SEL_PROP = {
  urlPropostas:      '',  // ← recon
  campoUasg:         '',  // ← recon
  campoNumero:       '',  // ← recon
  botaoBuscar:       '',  // ← recon
  linhasPropostas:   '',  // ← recon
  colItem:           '',  // ← recon
  colFornecedor:     '',  // ← recon
  colCnpj:           '',  // ← recon
  colValor:          '',  // ← recon
  colSituacao:       '',  // ← recon
  colMarca:          '',  // ← recon
};
```

---

## Ordem de implementação

1. Adicionar endpoints de recon ao `server.js` (não depende de seletores)
2. Estender `GET /screenshot` com `?sessao=1`
3. Rafael faz login → recon das páginas → seletores capturados
4. Atualizar `SEL_MSG` e `SEL_PROP` em `comprasgov.js`
5. Implementar `lerPropostasPregao` + adicionar `POST /pregao/propostas` ao `server.js`
6. Corrigir `lerMensagensChat` e `responderMensagem` com seletores reais
7. Teste end-to-end manual com um pregão real

---

## O que não está no escopo

- Automatizar o login (sempre manual — Gov.br tem CAPTCHA/certificado)
- Persistência em CSV/JSON das propostas (a rodada 1 já tem `storage.js` — integrar depois se necessário)
- Deploy na VPS (só após validação local)
