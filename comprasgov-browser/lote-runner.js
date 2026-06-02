'use strict';

/**
 * lote-runner.js
 * Núcleo compartilhado entre `raspar-lote.js` (CLI) e `agendador.js` (cron).
 *
 * Executa um lote de raspagem de propostas com:
 *   - Verificação proativa de sessão antes de cada compra
 *   - Pausa graciosa em caso de sessão expirada (sem erro fatal)
 *   - Persistência de progresso via lote-estado.js
 *   - Notificações de progresso e fim via Telegram (opcional)
 *
 * Não muda a mecânica de navegação (goto direto em /item/1 ao trocar de
 * compra; pushState entre itens da mesma compra) — apenas envelopa.
 */

const path = require('path');

const {
  extrairDadosPaginaAtual,
  gerarExcel,
  salvarSnapshot,
  sleep,
  log,
} = require('./raspar-propostas-cdp');

const { verificarSessao } = require('./comprasgov');
const loteEstado          = require('./lote-estado');

// Rota LOGADA (fornecedor) — reCAPTCHA estável (vs. hCaptcha da rota /public/ que cai)
const URL_ITEM_TEMPLATE = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/acompanhamento-compra/item/{N}?compra={ID}';
const DELAY_ITEM        = 3000;
const DELAY_COMPRA      = 5000;
const ESPERA_POS_GOTO   = 5000;
const ITENS_LIMITE      = 200;
const INTERVALO_RELOAD  = 25; // page.reload a cada N itens — mantém sessão fresca
const INTERVALO_PROGRESSO_DEFAULT = 5;

const URL_BASE_COMPRA = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/acompanhamento-compra?compra=';

function _urlItem(compraId, numItem) {
  return URL_ITEM_TEMPLATE.replace('{N}', String(numItem)).replace('{ID}', String(compraId));
}

/**
 * Recuperação manual que o Rafael faz quando ComprasGov mostra "compra não
 * encontrada" (bug intermitente do portal): reload → volta pro link da compra
 * (sem item) → vai pro item 1. Não depende de nova interação humana enquanto
 * o reCAPTCHA do Chrome estiver válido.
 *
 * Retorna { ok: boolean, url: string }.
 */
async function recuperarCompra(page, compraId) {
  log(`  [recuperar] reload + volta pro link da compra ${compraId}`);
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    await sleep(ESPERA_POS_GOTO);
  } catch (e) { log(`  [recuperar] reload erro: ${e.message}`); }
  try {
    await page.goto(URL_BASE_COMPRA + compraId, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await sleep(ESPERA_POS_GOTO);
  } catch (e) { log(`  [recuperar] goto base erro: ${e.message}`); }
  try {
    await page.goto(_urlItem(compraId, 1), { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await sleep(ESPERA_POS_GOTO);
  } catch (e) { log(`  [recuperar] goto item 1 erro: ${e.message}`); }
  const url = page.url();
  return { ok: !url.includes('compra-nao-encontrada'), url };
}

/**
 * Navegação por goto direto (rota logada do SPA Angular — pushState não
 * re-renderiza o componente do item, então usamos page.goto). Mais lento
 * (~5s overhead por item) mas garante render correto.
 *
 * Após o goto, valida que o cabecalho-item começa com o número esperado;
 * se não bater, retorna { ok: false } pra quem chamou decidir o que fazer.
 */
async function navegarParaItemGoto(page, compraId, numItem) {
  await page.goto(_urlItem(compraId, numItem), { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await sleep(ESPERA_POS_GOTO);

  // Detecta redirect pra "compra-nao-encontrada" — significa que o item N
  // não é acessível por este fornecedor (na rota logada, /seguro/fornecedor/
  // só mostra itens onde o fornecedor é participante).
  const urlAtual = page.url();
  if (urlAtual.includes('compra-nao-encontrada')) {
    return { ok: false, cabecalho: '', motivo: 'compra_nao_encontrada' };
  }

  const cabecalho = await page.evaluate(() => {
    const el = document.querySelector('app-cabecalho-item');
    return el?.innerText?.trim() || '';
  });
  const re = new RegExp('^\\s*' + numItem + '\\b');
  const ok = re.test(cabecalho);
  return { ok, cabecalho, motivo: ok ? null : 'cabecalho_mismatch' };
}

/**
 * Distingue PERDA REAL de sessão (exige re-login humano → pausar o lote) de
 * "a compra só não abriu" (bounce pra /compras, compra-nao-encontrada → pular a
 * compra e seguir). Recebe o resultado de verificarSessao já avaliado.
 */
function _sessaoCaiu(page, ses) {
  const url = page.url();
  // Redirect explícito pra SSO/login/intro/sessão-expirada → sessão caiu.
  if (/sso\.acesso\.gov\.br|acesso\.gov\.br\/login|contas\.acesso\.gov\.br|\/login|\/loginPortal|\/intro\.htm|\/sessao-expirada/i.test(url)) {
    return true;
  }
  // Motivos do verificarSessao que pedem humano (SSO/CAPTCHA/URL de login).
  if (ses && /SSO|CAPTCHA|URL inv[aá]lida|Fora do ComprasGov/i.test(ses.motivo || '')) {
    return true;
  }
  // compra-nao-encontrada / acesso-nao-autorizado (ex.: navegou pra item além do
  // último acessível — fim natural da compra) ou ainda dentro da área logada
  // (/seguro/) = problema da compra, NÃO da sessão.
  if (/compra-nao-encontrada|acesso-nao-autorizado/i.test(url)) return false;
  if (/comprasnet-web\/seguro\//i.test(url)) return false;
  // Fora da área logada e inválida → conservador: trata como sessão caída.
  return !ses || !ses.valida;
}

/**
 * Executa o lote.
 *
 * @param {object}        opts
 * @param {Array<object>} opts.alvos                 lista de compras a processar
 * @param {object}        opts.page                  Playwright Page conectada
 * @param {object}        [opts.telegram]            módulo telegram inicializado (opcional)
 * @param {number}        [opts.intervaloProgresso]  a cada N concluídas, envia update (default 5)
 * @param {boolean}       [opts.iniciarNovo]         se true (default), chama loteEstado.iniciarLote();
 *                                                   se false (caso /retomar), assume estado pré-existente
 *
 * @returns {Promise<{pausado: boolean, motivo: string|null, estado: object}>}
 */
async function executarLote(opts) {
  const {
    alvos,
    page,
    telegram = null,
    intervaloProgresso = INTERVALO_PROGRESSO_DEFAULT,
    iniciarNovo = true,
  } = opts;

  if (!Array.isArray(alvos) || alvos.length === 0) {
    throw new Error('lote-runner: alvos deve ser array não vazio');
  }
  if (!page) throw new Error('lote-runner: page obrigatória');

  if (iniciarNovo) {
    loteEstado.iniciarLote(alvos.map(a => a.compraId));
  } else {
    // Retomada: garante que status reflita "rodando" enquanto processamos
    loteEstado.marcarRodando();
  }

  if (telegram) {
    try { await telegram.enviar(`🟢 <b>Iniciando lote</b>\n${alvos.length} compras a processar`); }
    catch (e) { log(`[lote-runner] falha ao notificar início: ${e.message}`); }
  }

  let concluidasEsteRun = 0;
  let vaziasSeguidas    = 0;
  const LIMITE_VAZIAS_SEGUIDAS = 2; // CAPTCHA mid-lote → 2 compras vazias seguidas = pausa

  // Pausa o lote (sessão caiu de verdade): persiste estado + notifica + retorna.
  const _pausarLote = async (motivo) => {
    log(`[lote-runner] sessão inválida: ${motivo} — pausando lote`);
    loteEstado.marcarPausa(motivo);
    const estado = loteEstado.obterEstado();
    if (telegram) {
      try { await telegram.notificarSessaoExpirada(motivo, estado.compras_pendentes); }
      catch (e) { log(`[lote-runner] falha ao notificar pausa: ${e.message}`); }
    }
    return { pausado: true, motivo, estado };
  };

  for (let i = 0; i < alvos.length; i++) {
    const alvo     = alvos[i];
    const compraId = alvo.compraId;
    log(`\n[lote-runner] [${i + 1}/${alvos.length}] ${alvo.tipo || ''} ${alvo.numero || compraId}`);

    // 1) Garante que a aba está na URL da compra (goto direto pro item 1)
    try {
      if (!page.url().includes(compraId) || !page.url().includes('/item/1')) {
        await page.goto(_urlItem(compraId, 1), { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await sleep(ESPERA_POS_GOTO);
      }
    } catch (err) {
      log(`[lote-runner] erro no goto de ${compraId}: ${err.message}`);
      loteEstado.marcarFalha(compraId, `goto falhou: ${err.message}`);
      if (i < alvos.length - 1) await sleep(DELAY_COMPRA);
      continue;
    }

    // 2) Verifica sessão. Só pausa o lote quando a sessão CAIU DE VERDADE
    //    (SSO/login/CAPTCHA). Se a compra apenas não abriu (bounce pra /compras
    //    ou compra-nao-encontrada — em geral transitório), tenta recovery e, se
    //    ainda não abrir, PULA a compra sem derrubar o lote.
    let ses = await verificarSessao(page);
    if (!ses.valida) {
      if (_sessaoCaiu(page, ses)) return await _pausarLote(ses.motivo);

      log(`[lote-runner] compra ${compraId} não abriu (${ses.motivo}) — tentando recovery`);
      await recuperarCompra(page, compraId);
      ses = await verificarSessao(page);
      if (!ses.valida) {
        if (_sessaoCaiu(page, ses)) return await _pausarLote(ses.motivo);
        log(`[lote-runner] compra ${compraId} inacessível após recovery (${ses.motivo}) — pulando`);
        loteEstado.marcarFalha(compraId, `inacessível: ${ses.motivo}`);
        if (i < alvos.length - 1) await sleep(DELAY_COMPRA);
        continue;
      }
      log(`[lote-runner] recovery OK — compra ${compraId} abriu`);
    }

    // 3) Loop de itens via pushState (mecânica existente, não muda)
    const resultados = [];
    let limitItens = ITENS_LIMITE;
    if (alvo.totalItens && alvo.totalItens !== 'auto') {
      limitItens = parseInt(alvo.totalItens, 10) || ITENS_LIMITE;
    }

    let itemAtual    = 1;
    let motivoBreak  = null; // 'fim_natural' | 'cabecalho_mismatch' | 'lixo'
    try {
      while (itemAtual <= limitItens) {
        if (itemAtual > 1) {
          // Reload periódico: mantém token/sessão Angular fresco.
          // Acontece ANTES da navegação para o próximo item.
          if ((itemAtual - 1) % INTERVALO_RELOAD === 0) {
            log(`  reload preventivo no item ${itemAtual} (a cada ${INTERVALO_RELOAD})`);
            try {
              await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
              await sleep(ESPERA_POS_GOTO);
              const ses = await verificarSessao(page);
              if (!ses.valida) {
                motivoBreak = 'cabecalho_mismatch';
                log(`  reload mostrou sessão inválida (${ses.motivo})`);
                break;
              }
            } catch (e) {
              log(`  erro no reload preventivo: ${e.message}`);
            }
          }

          let nav = await navegarParaItemGoto(page, compraId, itemAtual);

          // Recovery automático para bug "compra-nao-encontrada" — replica o que o
          // usuário faz manual (reload + voltar pro link da compra) e re-tenta.
          if (!nav.ok && nav.motivo === 'compra_nao_encontrada') {
            log(`  bug compra-nao-encontrada no item ${itemAtual} — tentando recovery automático`);
            const rec = await recuperarCompra(page, compraId);
            if (rec.ok) {
              nav = await navegarParaItemGoto(page, compraId, itemAtual);
              if (nav.ok) log(`  recovery bem-sucedido — continuando do item ${itemAtual}`);
            } else {
              log(`  recovery falhou (url=${rec.url}) — vai pausar se sessão inválida`);
            }
          }

          if (!nav.ok) {
            motivoBreak = 'cabecalho_mismatch';
            log(`  navegação falhou no item ${itemAtual} (motivo=${nav.motivo}, vi: "${nav.cabecalho.slice(0,60)}")`);
            break;
          }
        }
        const dados = await extrairDadosPaginaAtual(page, itemAtual);

        if (!dados || !dados.dadosItem || !dados.dadosItem.descricao) {
          motivoBreak = 'fim_natural';
          log(`  fim da compra no item ${itemAtual} (sem descrição)`);
          break;
        }

        const d = dados.dadosItem;
        const lixo =
          d.descricao === 'Item não identificado' ||
          (
            (!d.quantidade || d.quantidade === '') &&
            dados.propostas.length === 0 &&
            (d.descricao || '').length < 30
          );
        if (lixo) {
          motivoBreak = 'lixo';
          log(`  item ${itemAtual} suspeito — abortando loop`);
          break;
        }

        resultados.push(dados);
        log(`  item ${itemAtual}: ${dados.propostas.length} proposta(s)`);
        itemAtual++;
        await sleep(DELAY_ITEM);
      }
    } catch (err) {
      log(`[lote-runner] erro raspando item ${itemAtual} de ${compraId}: ${err.message}`);
      loteEstado.marcarFalha(compraId, `item ${itemAtual}: ${err.message}`);
      if (i < alvos.length - 1) await sleep(DELAY_COMPRA);
      continue;
    }

    // Pós-loop: distingue fim natural de sessão caída.
    // Só re-checa sessão quando o fim foi AMBÍGUO (cabecalho_mismatch ou lixo).
    // Fim_natural sempre confia.
    if (motivoBreak === 'cabecalho_mismatch' || motivoBreak === 'lixo') {
      const sesPos = await verificarSessao(page);
      if (!sesPos.valida && _sessaoCaiu(page, sesPos)) {
        // Sessão caiu de verdade. Se temos parciais, SALVA como falha (pra não perder o trabalho)
        // antes de pausar o lote inteiro.
        if (resultados.length > 0) {
          let xlsxPathParcial = null;
          try {
            salvarSnapshot(resultados, compraId);
            xlsxPathParcial = await gerarExcel(resultados, compraId);
            log(`[lote-runner] ${resultados.length} item(s) parcial(is) salvos antes de pausar`);
          } catch (e) {
            log(`[lote-runner] falha ao salvar parciais: ${e.message}`);
          }
          loteEstado.marcarFalha(compraId, `parcial: ${resultados.length} item(s) antes da sessão cair`);
          // Envia Excel parcial pelo Telegram mesmo com sessão caída
          if (telegram && xlsxPathParcial) {
            const alvo = alvos.find(a => String(a.compraId) === String(compraId));
            const label = alvo?.tipo ? `${alvo.tipo} ${alvo.numero}` : compraId;
            try {
              await telegram.enviarDocumento(xlsxPathParcial,
                `⚠️ <b>${label}</b> — ${resultados.length} item(s) (PARCIAL — sessão caiu)`);
            } catch (err) {
              log(`[lote-runner] falha ao enviar Excel parcial de ${compraId}: ${err.message}`);
            }
          }
        }
        loteEstado.marcarPausa(`durante compra ${compraId}: ${sesPos.motivo}`);
        const estado = loteEstado.obterEstado();
        if (telegram) {
          try { await telegram.notificarSessaoExpirada(sesPos.motivo, estado.compras_pendentes); }
          catch (e) { log(`[lote-runner] falha ao notificar pausa: ${e.message}`); }
        }
        return { pausado: true, motivo: sesPos.motivo, estado };
      }
      // Sessão ainda válida: cabecalho/lixo foi só fim natural mesmo (cai pra persistência normal)
    }

    // 4) Persistência da compra (com detecção tardia de CAPTCHA)
    if (resultados.length === 0) {
      // Item 1 voltou vazio: re-checa sessão (pode ter caído entre verificarSessao e extrair)
      const sesPos = await verificarSessao(page);
      if (!sesPos.valida && _sessaoCaiu(page, sesPos)) {
        log(`[lote-runner] item 1 vazio + sessão inválida (${sesPos.motivo}) — pausando agora`);
        loteEstado.marcarPausa(`item vazio + ${sesPos.motivo}`);
        const estado = loteEstado.obterEstado();
        if (telegram) {
          try { await telegram.notificarSessaoExpirada(sesPos.motivo, estado.compras_pendentes); }
          catch (e) { log(`[lote-runner] falha ao notificar pausa: ${e.message}`); }
        }
        return { pausado: true, motivo: sesPos.motivo, estado };
      }

      // Sessão ainda válida, mas compra ficou vazia: marca falha e incrementa contador
      loteEstado.marcarFalha(compraId, 'nenhum item extraído');
      vaziasSeguidas++;
      if (vaziasSeguidas >= LIMITE_VAZIAS_SEGUIDAS) {
        const motivo = `${vaziasSeguidas} compras vazias seguidas (provável CAPTCHA bloqueando dados)`;
        log(`[lote-runner] ${motivo} — pausando`);
        loteEstado.marcarPausa(motivo);
        const estado = loteEstado.obterEstado();
        if (telegram) {
          try { await telegram.notificarSessaoExpirada(motivo, estado.compras_pendentes); }
          catch (e) { log(`[lote-runner] falha ao notificar pausa: ${e.message}`); }
        }
        return { pausado: true, motivo, estado };
      }
    } else {
      try {
        salvarSnapshot(resultados, compraId);
        const xlsxPath = await gerarExcel(resultados, compraId);
        loteEstado.marcarConcluida(compraId);
        concluidasEsteRun++;
        vaziasSeguidas = 0;
        // Envia Excel imediatamente após concluir cada compra
        if (telegram && xlsxPath) {
          const alvo = alvos.find(a => String(a.compraId) === String(compraId));
          const label = alvo?.tipo ? `${alvo.tipo} ${alvo.numero}` : compraId;
          try {
            await telegram.enviarDocumento(xlsxPath,
              `📎 <b>${label}</b> — ${resultados.length} item(s) raspado(s)`);
          } catch (err) {
            log(`[lote-runner] falha ao enviar Excel de ${compraId}: ${err.message}`);
          }
        }
      } catch (err) {
        log(`[lote-runner] erro salvando ${compraId}: ${err.message}`);
        loteEstado.marcarFalha(compraId, `persistência: ${err.message}`);
      }
    }

    // 5) Notificação de progresso a cada N concluídas
    if (telegram && concluidasEsteRun > 0 && concluidasEsteRun % intervaloProgresso === 0) {
      const e = loteEstado.obterEstado();
      try {
        await telegram.enviar(
          `📈 <b>Progresso do lote</b>\n` +
          `Concluídas: ${e.compras_concluidas.length}/${alvos.length}\n` +
          `Pendentes: ${e.compras_pendentes.length}\n` +
          `Falhas: ${e.compras_falhas.length}`
        );
      } catch (err) {
        log(`[lote-runner] falha ao notificar progresso: ${err.message}`);
      }
    }

    if (i < alvos.length - 1) await sleep(DELAY_COMPRA);
  }

  // 6) Fim
  try { loteEstado.marcarConcluido(); } catch (e) { log(`[lote-runner] falha ao marcar concluído: ${e.message}`); }
  const estado = loteEstado.obterEstado() || { compras_concluidas: [], compras_falhas: [] };
  if (telegram) {
    try {
      let msg = `✅ <b>Lote concluído</b>\n${estado.compras_concluidas.length} sucesso(s), ${estado.compras_falhas.length} falha(s)`;
      if (estado.compras_falhas.length > 0) {
        const amostra = estado.compras_falhas.slice(0, 10).map(f => `• ${f.compraId}: ${f.motivo}`).join('\n');
        msg += `\n\n<b>Falhas:</b>\n${amostra}`;
        if (estado.compras_falhas.length > 10) msg += `\n<i>… e mais ${estado.compras_falhas.length - 10}</i>`;
      }
      await telegram.enviar(msg);
    } catch (e) {
      log(`[lote-runner] falha ao notificar fim: ${e.message}`);
    }
  }

  return { pausado: false, motivo: null, estado };
}

/**
 * Raspagem AVULSA de itens específicos de um pregão (disparada via /raspar no
 * Telegram). Reusa o motor do lote mas NÃO mexe em lote-estado (não é retomável)
 * e gera um Excel com nome distinto (sufixo ITENS_…) pra não sobrescrever o
 * Excel completo do lote.
 *
 * @returns {Promise<{itensOk: number[], itensVazios: number[]}>}
 */
async function rasparItensEspecificos({ page, compraId, itens, telegram = null }) {
  if (!page) throw new Error('lote-runner: page obrigatória');
  if (!Array.isArray(itens) || itens.length === 0) {
    throw new Error('lote-runner: itens deve ser array não vazio');
  }

  // Navega pra compra ANTES de verificar a sessão: verificarSessao exige o
  // componente Angular da compra no DOM, que só existe depois do goto. Rodar a
  // verificação na aba genérica (/compras, sem compra aberta) dava falso
  // "sessão expirada". Mesmo padrão do executarLote (goto → verificarSessao).
  try {
    await page.goto(_urlItem(compraId, itens[0]), { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await sleep(ESPERA_POS_GOTO);
  } catch (err) {
    log(`[raspar-avulso] erro no goto inicial de ${compraId}: ${err.message}`);
  }

  const ses = await verificarSessao(page);
  if (!ses.valida) {
    log(`[raspar-avulso] sessão inválida: ${ses.motivo}`);
    if (telegram) {
      try { await telegram.enviar(`⚠️ Sessão expirada (${ses.motivo}). Faça login no Chrome e mande /raspar de novo.`); }
      catch (e) { log(`[raspar-avulso] falha ao notificar sessão: ${e.message}`); }
    }
    return { itensOk: [], itensVazios: itens.slice() };
  }

  const resultados  = [];
  const itensOk     = [];
  const itensVazios = [];

  for (const n of itens) {
    try {
      let nav = await navegarParaItemGoto(page, compraId, n);
      if (!nav.ok && nav.motivo === 'compra_nao_encontrada') {
        const rec = await recuperarCompra(page, compraId);
        if (rec.ok) nav = await navegarParaItemGoto(page, compraId, n);
      }
      if (!nav.ok) {
        log(`[raspar-avulso] item ${n} inacessível (${nav.motivo})`);
        itensVazios.push(n);
        await sleep(DELAY_ITEM);
        continue;
      }
      const dados = await extrairDadosPaginaAtual(page, n);
      if (!dados || !dados.dadosItem || !dados.dadosItem.descricao) {
        log(`[raspar-avulso] item ${n} sem dados`);
        itensVazios.push(n);
      } else {
        resultados.push(dados);
        itensOk.push(n);
        log(`[raspar-avulso] item ${n}: ${dados.propostas.length} proposta(s)`);
      }
    } catch (err) {
      log(`[raspar-avulso] erro no item ${n}: ${err.message}`);
      itensVazios.push(n);
    }
    await sleep(DELAY_ITEM);
  }

  if (resultados.length === 0) {
    if (telegram) {
      try { await telegram.enviar(`❌ Nenhum dos itens pedidos (${itens.join(', ')}) retornou dados para ${compraId}.`); }
      catch (e) { log(`[raspar-avulso] falha ao notificar vazio: ${e.message}`); }
    }
    return { itensOk, itensVazios };
  }

  const sufixo = `ITENS_${itensOk.join('-')}_${Date.now()}`;
  let xlsxPath = null;
  try {
    xlsxPath = await gerarExcel(resultados, compraId, { sufixo });
  } catch (err) {
    log(`[raspar-avulso] falha ao gerar Excel: ${err.message}`);
    if (telegram) {
      try { await telegram.enviar(`❌ Erro ao gerar Excel: ${err.message}`); }
      catch (e) { log(`[raspar-avulso] falha ao notificar erro de Excel: ${e.message}`); }
    }
    return { itensOk, itensVazios };
  }

  if (telegram && xlsxPath) {
    let legenda = `📎 <b>${compraId}</b> — itens ${itensOk.join(', ')} raspado(s)`;
    if (itensVazios.length > 0) legenda += `\n⚠️ sem dados: ${itensVazios.join(', ')}`;
    try { await telegram.enviarDocumento(xlsxPath, legenda); }
    catch (err) { log(`[raspar-avulso] falha ao enviar Excel: ${err.message}`); }
  }

  return { itensOk, itensVazios };
}

module.exports = {
  executarLote,
  rasparItensEspecificos,
  _sessaoCaiu,
  // expostos para configuração eventual
  URL_ITEM_TEMPLATE,
  DELAY_ITEM,
  DELAY_COMPRA,
  ITENS_LIMITE,
};
