'use strict';

/**
 * anexos-runner.js
 *
 * Baixa e salva localmente os anexos das propostas de itens especificos de um
 * pregao (comando /anexos do Telegram). Sob demanda, nao mexe em lote-estado.
 *
 * Mecanismo (recon ao vivo 2026-06-01): na sub-aba "Anexos" de cada card de
 * proposta, cada arquivo tem um icone fa-download dentro de um <button>. Clicar
 * dispara um `download` event do Playwright (suggestedFilename = nome real).
 * Exclui o botao do header "Downloads relacionados a compra" (nivel da compra).
 *
 * Salva em: dados/anexos/<compraId>/item_<n>/<cnpjDigits>/<nome_do_arquivo>
 */

const path = require('path');
const fs   = require('fs');

const { sleep, log }       = require('./raspar-propostas-cdp');
const { verificarSessao }  = require('./comprasgov');
const { navegarParaItemGoto, recuperarCompra } = require('./lote-runner');

const DADOS_DIR  = path.join(__dirname, 'dados');
const URL_ITEM   = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/acompanhamento-compra/item/{N}?compra={ID}';
const DELAY_ITEM = 1000;

const SEL_BTN_PROPOSTA = 'app-botao-expandir-ocultar button[data-test="btn-expandir"], button[aria-label="Mostrar proposta do item"]';
const SEL_BTN_ITEM     = 'app-botao-expandir-item button[data-test="btn-expandir"], button[aria-label="Mostrar detalhes do item"]';
// Botoes de download POR-ARQUIVO; exclui o "Downloads relacionados a compra" do header.
const SEL_DOWNLOAD     = 'button:has(i[class*="fa-download"]):not([aria-label*="relacionados"]):not([aria-label*="compra"])';

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

// Helpers puros (testaveis)
function _cnpjDigits(cnpj) { return String(cnpj || '').replace(/\D/g, ''); }

function _sanitizeNome(nome) {
  // Troca apenas os caracteres proibidos em nome de arquivo no Windows.
  const s = String(nome || '').replace(/[<>:"/\\|?*]/g, '_').trim();
  return s || 'arquivo';
}

function _pastaAnexos(compraId, item, cnpj) {
  return path.join(DADOS_DIR, 'anexos', String(compraId), 'item_' + item, _cnpjDigits(cnpj));
}

// Abre a estrutura ate os arquivos aparecerem: detalhes do item -> aba
// "Todas as propostas" -> expande cada card -> abre a sub-aba "Anexos".
async function _abrirTodosAnexos(page) {
  try {
    const det = page.locator(SEL_BTN_ITEM);
    const nd = await det.count();
    for (let i = 0; i < nd; i++) {
      if ((await det.nth(i).getAttribute('aria-expanded')) === 'false') {
        await det.nth(i).click({ timeout: 5000 }).catch(() => {});
        await sleep(700);
      }
    }
  } catch (e) { /* segue */ }

  try {
    const ok = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('a,span,li,button,[role="tab"]'))
        .find(e => (e.textContent || '').trim() === 'Todas as propostas');
      if (!el) return false;
      (el.closest('a,li,[role="tab"],button') || el).click();
      return true;
    });
    if (ok) await sleep(2500);
  } catch (e) { /* segue */ }

  const cards = page.locator(SEL_BTN_PROPOSTA);
  const nc = await cards.count();
  for (let i = 0; i < nc; i++) {
    try {
      if ((await cards.nth(i).getAttribute('aria-expanded')) === 'false') {
        await cards.nth(i).scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await cards.nth(i).click({ timeout: 5000 }).catch(() => {});
        await sleep(200);
      }
    } catch (e) { /* segue */ }
  }
  if (nc > 0) await sleep(1000);

  // Sub-aba "Anexos" de cada card (clique REAL; sintetico nao dispara o Angular).
  const anexosBtns = page.locator('button[data-test="btn-expandir-anexos"]').filter({ hasText: 'Anexos' });
  const na = await anexosBtns.count();
  for (let i = 0; i < na; i++) {
    try {
      await anexosBtns.nth(i).scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      await anexosBtns.nth(i).click({ timeout: 3000 }).catch(() => {});
      await sleep(200);
    } catch (e) { /* segue */ }
  }
  if (na > 0) await sleep(1200);
}

// Baixa todos os anexos do item ATUAL (ja navegado). Retorna { item, arquivos }.
async function baixarAnexosDoItem(page, compraId, item) {
  await _abrirTodosAnexos(page);

  const btns = page.locator(SEL_DOWNLOAD);
  const n = await btns.count();
  const arquivos = [];
  const vistos = new Set();

  for (let i = 0; i < n; i++) {
    const btn = btns.nth(i);
    let cnpj = '';
    try {
      // CNPJ do card = o cabeçalho de proposta (texto começa com CNPJ) mais
      // próximo ACIMA do botão na ordem do documento. Robusto ao aninhamento.
      cnpj = await btn.evaluate((el) => {
        const reCnpj = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/;
        const cabecalhos = Array.from(document.querySelectorAll('*'))
          .filter(n => reCnpj.test((n.textContent || '').trim().slice(0, 20)));
        let achado = '';
        for (const n of cabecalhos) {
          // n precede el no documento?
          if (n.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
            const m = (n.textContent || '').match(reCnpj);
            if (m) achado = m[0]; // o último que precede é o mais próximo acima
          }
        }
        return achado;
      });
    } catch (e) { /* sem CNPJ */ }

    try {
      await btn.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      const dlPromise = page.waitForEvent('download', { timeout: 30000 });
      await btn.click({ timeout: 5000 });
      const dl = await dlPromise;
      const nome = _sanitizeNome(dl.suggestedFilename());
      const cnpjDig = _cnpjDigits(cnpj) || '_sem_cnpj';
      const chave = cnpjDig + '/' + nome;
      if (vistos.has(chave)) { try { await dl.cancel(); } catch (e) {} continue; }
      vistos.add(chave);
      const pasta = _pastaAnexos(compraId, item, cnpjDig);
      ensureDir(pasta);
      const dest = path.join(pasta, nome);
      await dl.saveAs(dest);
      arquivos.push({ cnpj: cnpjDig, nome, caminho: dest });
      log('[anexos] item ' + item + ' ' + cnpjDig + ': ' + nome);
    } catch (err) {
      log('[anexos] item ' + item + ' botao ' + i + ': ' + err.message);
    }
    await sleep(400);
  }

  return { item, arquivos };
}

/**
 * Baixa os anexos das propostas dos itens pedidos.
 * @returns {Promise<{itensOk:number[], totalArquivos:number, porItem:Array}>}
 */
async function baixarAnexosItens({ page, compraId, itens, telegram = null }) {
  if (!page) throw new Error('anexos-runner: page obrigatoria');
  if (!Array.isArray(itens) || itens.length === 0) {
    throw new Error('anexos-runner: itens deve ser array nao vazio');
  }

  try {
    await page.goto(URL_ITEM.replace('{N}', String(itens[0])).replace('{ID}', String(compraId)),
      { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);
  } catch (e) { log('[anexos] goto inicial erro: ' + e.message); }

  const ses = await verificarSessao(page);
  if (!ses.valida) {
    log('[anexos] sessao invalida: ' + ses.motivo);
    if (telegram) {
      try { await telegram.enviar('⚠️ Sessao expirada (' + ses.motivo + '). Faca login no Chrome e mande /anexos de novo.'); }
      catch (e) { /* ignore */ }
    }
    return { itensOk: [], totalArquivos: 0, porItem: [] };
  }

  const porItem = [];
  const itensOk = [];
  let total = 0;

  for (const num of itens) {
    try {
      let nav = await navegarParaItemGoto(page, compraId, num);
      if (!nav.ok && nav.motivo === 'compra_nao_encontrada') {
        const rec = await recuperarCompra(page, compraId);
        if (rec.ok) nav = await navegarParaItemGoto(page, compraId, num);
      }
      if (!nav.ok) {
        log('[anexos] item ' + num + ' inacessivel (' + nav.motivo + ')');
        porItem.push({ item: num, arquivos: [] });
        await sleep(DELAY_ITEM);
        continue;
      }
      const r = await baixarAnexosDoItem(page, compraId, num);
      porItem.push(r);
      if (r.arquivos.length) { itensOk.push(num); total += r.arquivos.length; }
    } catch (err) {
      log('[anexos] erro no item ' + num + ': ' + err.message);
      porItem.push({ item: num, arquivos: [] });
    }
    await sleep(DELAY_ITEM);
  }

  if (telegram) {
    const linhas = ['📎 <b>Anexos — ' + compraId + '</b>'];
    for (const r of porItem) linhas.push('• item ' + r.item + ': ' + r.arquivos.length + ' arquivo(s)');
    linhas.push('Total: <b>' + total + '</b> arquivo(s)');
    if (total > 0) linhas.push('Pasta: <code>' + path.join(DADOS_DIR, 'anexos', String(compraId)) + '</code>');
    try { await telegram.enviar(linhas.join('\n')); }
    catch (e) { log('[anexos] falha ao notificar: ' + e.message); }
  }

  return { itensOk, totalArquivos: total, porItem };
}

module.exports = {
  baixarAnexosItens,
  baixarAnexosDoItem,
  _cnpjDigits,
  _sanitizeNome,
  _pastaAnexos,
};
