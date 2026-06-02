#!/usr/bin/env node
'use strict';

/**
 * raspar-propostas-cdp.js
 *
 * Conecta ao Chrome via CDP, extrai propostas do ComprasGov SPA e gera Excel.
 *
 * Uso:
 *   node raspar-propostas-cdp.js <compra_id> <total_itens> [flags]
 *
 * Flags:
 *   --recon           Analisa estrutura HTML da página atual
 *   --recon-detalhes  Expande 1 card e analisa estrutura do detalhe
 *   --expandir        Expande cada card para capturar marca/modelo
 *
 * Pré-requisitos:
 *   1. Chrome aberto com --remote-debugging-port=9222
 *   2. Navegue manualmente até item 1 da compra
 *   3. Rode o script
 */

const { chromium } = require('playwright');
const ExcelJS      = require('exceljs');
const path         = require('path');
const fs           = require('fs');

const CDP_ENDPOINT      = 'http://127.0.0.1:9222';
const DADOS_DIR         = path.join(__dirname, 'dados');
const SNAPSHOTS_DIR     = path.join(DADOS_DIR, 'snapshots');
const DELAY_ENTRE_ITENS = 3000;

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`);
}
function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function hoje() { return new Date().toISOString().slice(0, 10); } // YYYY-MM-DD

// ---------------------------------------------------------------------------
// Conectar ao Chrome via CDP
// ---------------------------------------------------------------------------
async function conectarChrome() {
  log('Conectando ao Chrome via CDP...');
  const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
  const contexts = browser.contexts();
  if (!contexts.length) throw new Error('Nenhum contexto no Chrome.');

  let page = null;
  const allPages = [];
  for (const ctx of contexts) {
    for (const p of ctx.pages()) {
      allPages.push(p);
      const url = p.url();
      if (url.includes('comprasnet') || url.includes('compras.gov') || url.includes('serpro.gov')) {
        page = p;
      }
    }
  }
  if (!page) {
    page = allPages.find(p => !p.url().startsWith('chrome://')) || allPages[0];
  }
  log(`Conectado! ${allPages.length} aba(s). Usando: ${page.url()}`);
  return { browser, page };
}

// ---------------------------------------------------------------------------
// Navegar dentro do SPA (sem page.goto, sem CAPTCHA)
// ---------------------------------------------------------------------------
async function navegarParaItemSPA(page, compraId, numItem) {
  // Rota LOGADA (fornecedor) — reCAPTCHA estável, sessão persiste
  const novoCaminho = `/comprasnet-web/seguro/fornecedor/acompanhamento-compra/item/${numItem}?compra=${compraId}`;
  log(`  Navegando SPA → item ${numItem}...`);
  await page.evaluate((path) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }, novoCaminho);
  await sleep(4000);
}

// ---------------------------------------------------------------------------
// Parser puro de UM card de proposta (texto = sumário + detalhe expandido).
// Pure JS (sem DOM) → testável com node --test.
//
// Card EXPANDIDO traz, no formato "Rótulo\nValor":
//   Marca/Fabricante\nMOTOMIL · Modelo/Versão\nX · Valor ofertado (unitário | total)\nR$ ...
// Card COLAPSADO lista os rótulos "Valor ofertado/negociado (unitário)" juntos
// e só depois os valores → exige fallback posicional para o R$.
// ---------------------------------------------------------------------------
function parsearCardProposta(texto) {
  const result = {
    cnpj: '', porte: '', status: '', razaoSocial: '', uf: '',
    valorOfertado: '', valorNegociado: '', marca: '', modelo: '', fabricante: '',
  };
  if (!texto) return result;

  const linhas = texto.split('\n').map(l => l.trim()).filter(l => l);

  const cnpjMatch = texto.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
  if (cnpjMatch) result.cnpj = cnpjMatch[1];

  // Caminhada a partir do CNPJ: porte → status → razão social → UF
  let idx = linhas.findIndex(l => /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(l));
  idx = idx === -1 ? 0 : idx + 1;

  if (idx < linhas.length && /^(ME\/EPP|ME|EPP|DEMAIS|Demais)$/i.test(linhas[idx])) {
    result.porte = linhas[idx]; idx++;
  }

  const statusKeywords = ['Inabilitada', 'Adjudicada', 'Aceita e habilitada', 'Aceita',
    'Desclassificada', 'Recusada', 'Classificada', 'Cancelada', 'Habilitada'];
  while (idx < linhas.length) {
    const l = linhas[idx];
    if (/equidade|programa de integridade/i.test(l)) { idx++; continue; }
    const kw = statusKeywords.find(s => l.toLowerCase() === s.toLowerCase());
    if (kw) { result.status = l; idx++; }
    break;
  }
  while (idx < linhas.length && /equidade|programa de integridade/i.test(linhas[idx])) idx++;

  if (idx < linhas.length && linhas[idx].length > 3 &&
      !/^R\$/.test(linhas[idx]) && !/^Valor/.test(linhas[idx]) && !/^[A-Z]{2}$/.test(linhas[idx])) {
    result.razaoSocial = linhas[idx]; idx++;
  }
  if (idx < linhas.length && /^[A-Z]{2}$/.test(linhas[idx])) {
    result.uf = linhas[idx]; idx++;
  }

  // Valores — preferir rótulo no formato expandido "(unitário | total)" seguido
  // imediatamente pelo valor. Exigir "| total" evita o falso-positivo do layout
  // colapsado (onde os dois rótulos vêm antes dos valores).
  const ofertadoMatch = texto.match(/Valor ofertado \(unit[áa]rio\s*\|\s*total\)\s*\n\s*(R\$\s*[\d.,]+)/i);
  const negociadoMatch = texto.match(/Valor negociado \(unit[áa]rio\s*\|\s*total\)\s*\n\s*(R\$\s*[\d.,]+|-)/i);
  const rsLines = linhas.filter(l => /^R\$\s*[\d.,]+$/.test(l));

  if (ofertadoMatch) {
    result.valorOfertado = ofertadoMatch[1].trim();
  } else if (rsLines.length >= 1) {
    result.valorOfertado = rsLines[0]; // fallback colapsado: 1º R$ = ofertado
  }

  if (negociadoMatch) {
    const v = negociadoMatch[1].trim();
    result.valorNegociado = v === '-' ? '' : v;
  } else if (!ofertadoMatch && rsLines.length >= 2) {
    result.valorNegociado = rsLines[1]; // fallback colapsado: 2º R$ = negociado
  }

  // Marca/Modelo — só existem no card EXPANDIDO, formato "Rótulo\nValor"
  const marcaMatch = texto.match(/Marca\/Fabricante\s*\n\s*([^\n]+)/i);
  const modeloMatch = texto.match(/Modelo\/Vers[ãa]o\s*\n\s*([^\n]+)/i);
  if (marcaMatch) result.marca = marcaMatch[1].trim();
  if (modeloMatch) result.modelo = modeloMatch[1].trim();
  result.fabricante = result.marca; // campo combinado "Marca/Fabricante"

  return result;
}

// ---------------------------------------------------------------------------
// Extrair dados da página atual
// ---------------------------------------------------------------------------
async function extrairDadosPaginaAtual(page, numItem) {
  await sleep(2000);

  const dados = await page.evaluate((itemNum) => {
    const texto = document.body.innerText;
    const result = { numeroItem: itemNum, dadosItem: {}, propostas: [], headers: [] };

    // Dados do item
    // 1. Tentar match completo (com Qtde Aceita e Valor estimado)
    const itemMatch = texto.match(/(\d+)\s+(.+?)\n(?:Exclusividade[^\n]*\n)?(?:(Homologado|Em andamento|Deserto|Fracassado|Revogado|Anulado)[^\n]*\n)?Qtde solicitada:\nQtde aceita:\nValor estimado \(unitário\)\n(\d+)\n(\d+)\nR\$\s*([\d.,]+)/);
    
    if (itemMatch) {
      result.dadosItem = {
        descricao: itemMatch[2].trim(),
        quantidade: itemMatch[5],
        qtdeSolicitada: itemMatch[4],
        valorEstimado: itemMatch[6],
        situacaoItem: itemMatch[3] || '',
      };
    } else {
      // 2. Fallback mais permissivo (ignora a presença do valor estimado)
      const limpo = texto.trim();
      const descMatch = limpo.match(/^(\d+)[\s\n]+([^\n]+)/);
      const qtdMatch = limpo.match(/Qtde solicitada:\s*\n?\s*(\d+)/i) || limpo.match(/Quantidade:\s*\n?\s*(\d+)/i);
      
      if (descMatch) {
        result.dadosItem = {
          descricao: descMatch[2].trim(),
          quantidade: qtdMatch ? qtdMatch[1] : '',
        };
      } else {
         result.dadosItem = { descricao: "Item não identificado" };
      }
    }

    // Propostas (cards de fornecedores via texto)
    const blocos = texto.split(/(?=\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\n)/);
    let posicao = 0;
    for (const bloco of blocos) {
      const cnpjMatch = bloco.match(/^(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\n/);
      if (!cnpjMatch) continue;
      posicao++;
      const cnpj = cnpjMatch[1];
      const linhas = bloco.split('\n').map(l => l.trim()).filter(l => l);

      let porte = '', status = '', razaoSocial = '', uf = '';
      let valorOfertado = '', valorNegociado = '';
      let marca = '', modelo = '';
      let idx = 1;

      if (idx < linhas.length && /^(ME\/EPP|ME|EPP|DEMAIS|Demais)$/i.test(linhas[idx])) {
        porte = linhas[idx]; idx++;
      }

      const statusKeywords = ['Inabilitada', 'Adjudicada', 'Aceita', 'Desclassificada', 'Recusada',
        'Aceita e habilitada', 'Classificada', 'Cancelada'];
      while (idx < linhas.length) {
        const l = linhas[idx];
        if (statusKeywords.find(s => l.toLowerCase().includes(s.toLowerCase()))) { status = l; idx++; break; }
        if (/equidade|programa de integridade/i.test(l)) { idx++; continue; }
        break;
      }
      while (idx < linhas.length && /equidade|programa de integridade/i.test(linhas[idx])) idx++;

      if (idx < linhas.length && linhas[idx].length > 3 && !/^R\$/.test(linhas[idx]) && !/^Valor/.test(linhas[idx])) {
        razaoSocial = linhas[idx]; idx++;
      }
      if (idx < linhas.length && /^[A-Z]{2}$/.test(linhas[idx])) {
        uf = linhas[idx]; idx++;
      }
      for (let j = idx; j < linhas.length; j++) {
        if (linhas[j].startsWith('R$') && !valorOfertado) valorOfertado = linhas[j];
        else if (linhas[j].startsWith('R$') && valorOfertado) valorNegociado = linhas[j];
      }

      // Marca/Fabricante e Modelo/Versao
      const marcaMatch = bloco.match(/(?:Marca\/Fabricante|Marca)[:\s]*\n?([^\n]+)/i);
      const modeloMatch = bloco.match(/(?:Modelo\/Versao|Modelo)[:\s]*\n?([^\n]+)/i);
      const fabricanteMatch = bloco.match(/Fabricante[:\s]*\n?([^\n]+)/i);
      if (marcaMatch) marca = marcaMatch[1].trim();
      if (modeloMatch) modelo = modeloMatch[1].trim();
      const fab = fabricanteMatch ? fabricanteMatch[1].trim() : marca;

      result.propostas.push({
        posicao: String(posicao), cnpj, porte, status, razaoSocial, uf,
        valorOfertado, valorNegociado, marca, modelo, fabricante: fab,
      });
    }
    
    // Tenta arrumar a descrição se tiver falhado
    if (!result.dadosItem.descricao || result.dadosItem.descricao === "Item não identificado") {
       const linhasTxt = texto.split('\n').map(l => l.trim()).filter(l => l);
       if (linhasTxt.length > 1) {
           // Geralmente a descrição é a segunda ou terceira linha
           result.dadosItem.descricao = linhasTxt[1] + (linhasTxt[2] && linhasTxt[2].length > 10 ? " " + linhasTxt[2] : "");
       }
    }
    
    return result;
  }, numItem);

  // Extração DETALHADA: expande cada card de proposta (marca/modelo só renderizam
  // expandido) e re-parseia por card. Se falhar/vier vazio, mantém as propostas
  // do parsing colapsado acima (sem regressão).
  try {
    const cardsTexto = await expandirECapturarPropostas(page);
    if (cardsTexto && cardsTexto.length > 0) {
      const detalhadas = cardsTexto
        .map((t, i) => { const p = parsearCardProposta(t); p.posicao = String(i + 1); return p; })
        .filter(p => p.cnpj);
      if (detalhadas.length > 0) dados.propostas = detalhadas;
    }
  } catch (err) {
    log(`  ⚠️ expansão de cards falhou (mantendo parsing colapsado): ${err.message}`);
  }

  return dados;
}

// ---------------------------------------------------------------------------
// Expande os cards de proposta e devolve o innerText de cada proposta
// (sumário + detalhe revelado). Seletores canônicos do portal govbr-ds:
//   proposta: app-botao-expandir-ocultar button[data-test="btn-expandir"]
//             (aria-label "Mostrar proposta do item")
//   item:     app-botao-expandir-item    button[data-test="btn-expandir"]
//             (aria-label "Mostrar detalhes do item")
// ---------------------------------------------------------------------------
const SEL_BTN_PROPOSTA = 'app-botao-expandir-ocultar button[data-test="btn-expandir"], button[aria-label="Mostrar proposta do item"]';
const SEL_BTN_ITEM     = 'app-botao-expandir-item button[data-test="btn-expandir"], button[aria-label="Mostrar detalhes do item"]';
const SEL_ACOMPANHAR   = 'app-botao-icone[data-test="acompanhar-item"] button, button[aria-label="Acompanhar Item"]';

async function expandirECapturarPropostas(page) {
  // 1a) Clica "Acompanhar Item" — é o que revela "Todas as propostas" nesta etapa.
  try {
    const aco = page.locator(SEL_ACOMPANHAR);
    const na = await aco.count();
    for (let i = 0; i < na; i++) {
      await aco.nth(i).scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await aco.nth(i).click({ timeout: 5000 }).catch(() => {});
      await sleep(800);
    }
  } catch (e) { /* sem botão acompanhar — segue */ }

  // 1b) Abre os detalhes do item, caso a lista de propostas ainda esteja oculta.
  try {
    const det = page.locator(SEL_BTN_ITEM);
    const nd = await det.count();
    for (let i = 0; i < nd; i++) {
      if ((await det.nth(i).getAttribute('aria-expanded')) === 'false') {
        await det.nth(i).click({ timeout: 5000 }).catch(() => {});
        await sleep(800);
      }
    }
  } catch (e) { /* layout sem botão de detalhe — segue */ }

  // 1c) Ativa a aba "Todas as propostas" — os cards dos concorrentes só
  //     renderizam quando essa aba está ativa (a default é "Minha proposta").
  try {
    const clicou = await page.evaluate(() => {
      const cands = Array.from(document.querySelectorAll('a, span, li, button, [role="tab"]'));
      const tab = cands.find(el => (el.textContent || '').trim() === 'Todas as propostas');
      if (!tab) return false;
      const alvo = tab.closest('a, li, [role="tab"], button') || tab;
      alvo.click();
      return true;
    });
    if (clicou) await sleep(2500);
  } catch (e) { /* sem aba — segue */ }

  // 2) Expande cada card de proposta (clique real do Playwright — mais confiável
  //    que .click() do DOM para componentes Angular).
  const botoes = page.locator(SEL_BTN_PROPOSTA);
  const total = await botoes.count();
  for (let i = 0; i < total; i++) {
    try {
      if ((await botoes.nth(i).getAttribute('aria-expanded')) === 'false') {
        await botoes.nth(i).scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await botoes.nth(i).click({ timeout: 5000 }).catch(() => {});
        await sleep(250);
      }
    } catch (e) { /* card problemático — ignora e segue */ }
  }
  if (total > 0) await sleep(1200); // render/animação final

  // 2b) Ativa a sub-aba "Proposta" de cada card com clique REAL do Playwright.
  //     É AQUI que Marca/Fabricante, Modelo/Versão, Valor proposta e Quantidade
  //     ofertada são carregados — clique sintético via evaluate NÃO dispara o
  //     handler do Angular (a default do card é a sub-aba "Chat").
  try {
    const propTabs = page.getByText('Proposta', { exact: true });
    const np = await propTabs.count();
    for (let i = 0; i < np; i++) {
      try {
        await propTabs.nth(i).scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
        await propTabs.nth(i).click({ timeout: 3000 });
        await sleep(150);
      } catch (e) { /* aba problemática — segue */ }
    }
    if (np > 0) await sleep(1500);
  } catch (e) { /* sem sub-aba Proposta — segue */ }

  // 3) Para cada botão, sobe até o ancestral que contém UM único CNPJ (a "linha"
  //    da proposta) e lê seu innerText — já com o detalhe revelado.
  const cards = await page.evaluate((selBtn) => {
    const reCnpj = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g;
    const botoes = Array.from(document.querySelectorAll(selBtn));
    const vistos = new Set();
    const out = [];
    for (const b of botoes) {
      let el = b;
      let container = null;
      for (let up = 0; up < 14 && el.parentElement; up++) {
        el = el.parentElement;
        const cnpjs = (el.innerText || '').match(reCnpj);
        if (cnpjs && new Set(cnpjs).size === 1) { container = el; break; }
      }
      if (!container) continue;
      const txt = container.innerText || '';
      const cnpj = (txt.match(reCnpj) || [])[0];
      if (!cnpj || vistos.has(cnpj)) continue;
      vistos.add(cnpj);
      out.push(txt);
    }
    return out;
  }, SEL_BTN_PROPOSTA);

  return cards;
}

// ---------------------------------------------------------------------------
// Expandir cards para capturar marca/modelo (--expandir)
// ---------------------------------------------------------------------------
async function expandirCardsECapturarDetalhes(page, numItem) {
  log(`  🔍 Expandindo cards do item ${numItem} para marca/modelo...`);

  // Encontrar todos os cards clicáveis (accordion headers)
  // O ComprasGov usa mat-expansion-panel ou divs clicáveis com CNPJ
  const seletoresCard = [
    'mat-expansion-panel-header',
    '.mat-expansion-panel-header',
    '[class*="expansion"] [class*="header"]',
    '[class*="accordion"] [class*="header"]',
    '[class*="fornecedor"] [class*="header"]',
    '[class*="proposta-header"]',
    '[class*="card-header"]',
    '[aria-expanded]',
    '.br-accordion',
    '.br-item'
  ];

  let seletorFuncional = null;
  for (const sel of seletoresCard) {
    const count = await page.locator(sel).count();
    if (count > 0) {
      seletorFuncional = sel;
      log(`  📌 Seletor de card: ${sel} (${count} encontrados)`);
      break;
    }
  }

  if (!seletorFuncional) {
    // Fallback: tentar clicar nos elementos que contêm CNPJ
    log('  ⚠️ Nenhum seletor de accordion encontrado. Tentando clicar nos CNPJs...');
    seletorFuncional = null;
  }

  const detalhes = {};

  if (seletorFuncional) {
    const cards = page.locator(seletorFuncional);
    const total = await cards.count();

    for (let i = 0; i < total; i++) {
      try {
        // Clicar para expandir
        await cards.nth(i).click();
        await sleep(1500);

        // Capturar texto expandido
        const textoExpandido = await page.evaluate(([idx, sel]) => {
          const panels = document.querySelectorAll(sel);
          const panel = panels[idx];
          // O conteúdo fica no elemento pai ou irmão do header
          const parent = panel.closest('mat-expansion-panel, [class*="expansion-panel"], [class*="accordion-item"]');
          if (parent) return parent.innerText;
          // Fallback: pegar o próximo sibling
          const next = panel.nextElementSibling;
          return next ? next.innerText : '';
        }, [i, seletorFuncional]);

        // Extrair CNPJ, marca, modelo do texto expandido
        const cnpjMatch = textoExpandido.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
        const cnpj = cnpjMatch ? cnpjMatch[1] : `card_${i}`;

        const marcaMatch = textoExpandido.match(/Marca[:\s]*([^\n]+)/i);
        const modeloMatch = textoExpandido.match(/Modelo[:\s]*([^\n]+)/i);
        const fabricanteMatch = textoExpandido.match(/Fabricante[:\s]*([^\n]+)/i);

        detalhes[cnpj] = {
          marca:      marcaMatch ? marcaMatch[1].trim() : '',
          modelo:     modeloMatch ? modeloMatch[1].trim() : '',
          fabricante: fabricanteMatch ? fabricanteMatch[1].trim() : '',
        };

        if (marcaMatch || modeloMatch) {
          log(`     ${cnpj}: marca="${detalhes[cnpj].marca}" modelo="${detalhes[cnpj].modelo}"`);
        }

        // Clicar novamente para fechar (colapsar)
        await cards.nth(i).click();
        await sleep(500);
      } catch (err) {
        log(`     ⚠️ Card ${i}: erro ao expandir — ${err.message}`);
      }
    }
  }

  return detalhes;
}

// ---------------------------------------------------------------------------
// Recon de detalhes (expande 1 card e mostra a estrutura)
// ---------------------------------------------------------------------------
async function reconDetalhes(page) {
  log('[RECON-DETALHES] Procurando cards expandíveis...');
  await sleep(2000);

  const reconData = await page.evaluate(() => {
    const r = {
      expansionPanels: [],
      clickableElements: [],
      allClasses: new Set(),
    };

    // Procurar expansion panels
    const seletores = [
      'mat-expansion-panel', '.mat-expansion-panel',
      '[class*="expansion"]', '[class*="accordion"]',
      '[class*="fornecedor"]', '[class*="proposta"]',
    ];
    for (const sel of seletores) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        r.expansionPanels.push({
          seletor: sel,
          count: els.length,
          classes: Array.from(els[0].classList),
          tag: els[0].tagName,
          childrenTags: Array.from(els[0].children).map(c => `${c.tagName}.${Array.from(c.classList).join('.')}`),
          snippet: els[0].innerText.substring(0, 300),
        });
      }
    }

    // Procurar elementos com CNPJ que sejam clicáveis
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      if (el.innerText && el.innerText.match(/^\d{2}\.\d{3}\.\d{3}\//) && el.children.length < 3) {
        r.clickableElements.push({
          tag: el.tagName,
          classes: Array.from(el.classList).join(' '),
          parentTag: el.parentElement?.tagName,
          parentClasses: Array.from(el.parentElement?.classList || []).join(' '),
          clickable: el.style.cursor === 'pointer' || el.onclick !== null,
          snippet: el.innerText.substring(0, 100),
        });
        if (r.clickableElements.length >= 3) break;
      }
    }

    return {
      expansionPanels: r.expansionPanels,
      clickableElements: r.clickableElements,
    };
  });

  return reconData;
}

// ---------------------------------------------------------------------------
// Gerar .xlsx formatado
// ---------------------------------------------------------------------------
function _nomeArquivoExcel(compraId, sufixo) {
  return `Resultados_CN_${compraId}_${sufixo || 'RASPAGEM'}.xlsx`;
}

async function gerarExcel(resultados, compraId, opts = {}) {
  ensureDir(DADOS_DIR);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Exportação de resultados');

  const EMPTY = " ";

  // Cabeçalhos (Linha 1)
  ws.columns = [
    { header: EMPTY,               key: 'colA',         width: 3 },
    { header: 'Posição',           key: 'posicao',      width: 10 },
    { header: 'Item',              key: 'item',         width: 8 },
    { header: 'Descrição',         key: 'descricao',    width: 40 },
    { header: 'CNPJ',              key: 'cnpj',         width: 18 },
    { header: 'Nome Empresa',      key: 'razaoSocial',  width: 40 },
    { header: 'Porte',             key: 'porte',        width: 12 },
    { header: 'Modelo',            key: 'modelo',       width: 20 },
    { header: 'Marca',             key: 'marca',        width: 20 },
    { header: 'Fabricante',        key: 'fabricante',   width: 20 },
    { header: 'Quantidade',        key: 'quantidade',   width: 12 },
    { header: 'Unidade de medida', key: 'unidade',      width: 18 },
    { header: 'Valor Unitário',    key: 'valorUnitario',width: 18 },
    { header: 'Valor Total',       key: 'valorTotal',   width: 18 },
  ];

  function soDigitos(cnpj) {
    if (!cnpj) return EMPTY;
    const digits = String(cnpj).replace(/[^\d]/g, '');
    return digits || EMPTY;
  }

  function parseValorUnitario(s) {
    if (!s) return null;
    const n = parseFloat(String(s).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  function parseQuantidade(s) {
    if (!s) return null;
    const n = parseInt(String(s).replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  }

  for (const r of resultados) {
    const temDescricao = r.dadosItem && r.dadosItem.descricao;
    const temPropostas = r.propostas && r.propostas.length > 0;
    
    // Só pula se não tiver NENHUMA descrição E NENHUMA proposta
    if (!temDescricao && !temPropostas) continue;

    // 1. Linha-cabeçalho do item
    const qtd = r.dadosItem ? parseQuantidade(r.dadosItem.quantidade) : null;
    ws.addRow({
      colA: EMPTY,
      posicao: EMPTY,
      item: String(r.numeroItem || EMPTY),
      descricao: temDescricao ? r.dadosItem.descricao : EMPTY,
      cnpj: EMPTY,
      razaoSocial: EMPTY,
      porte: EMPTY,
      modelo: EMPTY,
      marca: EMPTY,
      fabricante: EMPTY,
      quantidade: qtd !== null ? qtd : EMPTY,
      unidade: EMPTY,
      valorUnitario: EMPTY,
      valorTotal: EMPTY,
    });

    if (!r.propostas || r.propostas.length === 0) continue;

    // 2. Linhas de proposta
    const propostasOrdenadas = r.propostas.sort((a, b) => {
      const posA = parseInt(String(a.posicao).replace(/[^\d]/g, ''), 10) || 999;
      const posB = parseInt(String(b.posicao).replace(/[^\d]/g, ''), 10) || 999;
      return posA - posB;
    });

    for (let idx = 0; idx < propostasOrdenadas.length; idx++) {
      const p = propostasOrdenadas[idx];
      const valOfertado = parseValorUnitario(p.valorOfertado);
      let valTotal = EMPTY;
      
      if (valOfertado !== null && qtd !== null) {
        valTotal = valOfertado * qtd;
      }

      ws.addRow({
        colA: EMPTY,
        posicao: `${idx + 1}º`,
        item: EMPTY,
        descricao: EMPTY,
        cnpj: soDigitos(p.cnpj),
        razaoSocial: p.razaoSocial || EMPTY,
        porte: p.porte || EMPTY,
        modelo: p.modelo || EMPTY,
        marca: p.marca || EMPTY,
        fabricante: p.fabricante || EMPTY,
        quantidade: EMPTY,
        unidade: EMPTY,
        valorUnitario: valOfertado !== null ? valOfertado : EMPTY,
        valorTotal: valTotal !== EMPTY ? valTotal : EMPTY,
      });
    }
  }

  const nome = _nomeArquivoExcel(compraId, opts.sufixo);
  const caminho = path.join(DADOS_DIR, nome);
  await wb.xlsx.writeFile(caminho);
  log(`\n✅ Excel: ${caminho}`);
  log(`   Itens: ${resultados.length} | Propostas: ${resultados.reduce((s, r) => s + (r.propostas?.length || 0), 0)}`);
  return caminho;
}

function parseValor(s) {
  if (!s) return null;
  const n = parseFloat(String(s).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function parseQtd(s) {
  if (!s) return null;
  const n = parseFloat(String(s).replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Salvar snapshot datado (para comparação diária)
// ---------------------------------------------------------------------------
function salvarSnapshot(resultados, compraId) {
  ensureDir(SNAPSHOTS_DIR);
  const nome = `snapshot_${compraId}_${hoje()}.json`;
  const caminho = path.join(SNAPSHOTS_DIR, nome);
  fs.writeFileSync(caminho, JSON.stringify(resultados, null, 2), 'utf8');
  log(`📸 Snapshot salvo: ${caminho}`);
  return caminho;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2 || args[0] === '--help') {
    console.log(`
  Uso: node raspar-propostas-cdp.js <compra_id> <total_itens> [flags]

  Flags:
    --recon            Analisa estrutura HTML da página atual
    --recon-detalhes   Expande 1 card e mostra seletores disponíveis
    --capture          Expande os cards do item atual e mostra/salva o texto +
                       o parse por proposta (marca/modelo) — para validar/ajustar

  Obs: a extração normal JÁ expande cada card de proposta automaticamente para
       capturar marca/modelo (o antigo --expandir não é mais necessário).

  ANTES de rodar:
    1. Abra o Chrome com CDP (use raspar-diario.bat)
    2. Navegue manualmente até item 1 da compra
    3. Espere carregar e resolva CAPTCHA se pedir
    4. Rode este script

  Exemplos:
    node raspar-propostas-cdp.js 16030405900012026 20
    node raspar-propostas-cdp.js 16030405900012026 20 --expandir
    node raspar-propostas-cdp.js 16030405900012026 1 --recon
    node raspar-propostas-cdp.js 16030405900012026 1 --recon-detalhes
`);
    process.exit(0);
  }

  const compraId      = args[0];
  const N             = parseInt(args[1]) || 1;
  const isRecon       = args.includes('--recon');
  const isReconDet    = args.includes('--recon-detalhes');
  const isExpandir    = args.includes('--expandir');

  const modo = isReconDet ? 'RECON-DETALHES' : isRecon ? 'RECON' : isExpandir ? 'EXTRAÇÃO+DETALHES' : 'EXTRAÇÃO';
  log(`CompraID: ${compraId} | Itens: ${N} | Modo: ${modo}`);
  log('⚠️  Certifique-se de que o item 1 JÁ está carregado no Chrome!');

  let browser;
  try {
    const conn = await conectarChrome();
    browser = conn.browser;
    const page = conn.page;

    const urlAtual = page.url();
    if (!urlAtual.includes('comprasnet') && !urlAtual.includes('compras')) {
      log(`⚠️  URL atual não parece ser ComprasGov: ${urlAtual}`);
      log('   Navegue manualmente para a página do item 1 antes de rodar o script.');
    }

    // --- RECON ---
    if (isRecon) {
      log('[RECON] Capturando estrutura da página atual...');
      await sleep(2000);
      const reconData = await page.evaluate(() => {
        const r = { title: document.title, url: location.href, tables: [], body: document.body.innerText.substring(0, 5000) };
        document.querySelectorAll('table').forEach((t, i) => {
          const h = Array.from(t.querySelectorAll('thead th, tr:first-child th')).map(e => e.textContent.trim());
          const rows = Array.from(t.querySelectorAll('tbody tr')).map(tr =>
            Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim()));
          r.tables.push({ i, type: 'html', headers: h, rows: rows.length, sample: rows.slice(0, 3) });
        });
        document.querySelectorAll('.mat-table, mat-table, [class*="cdk-table"]').forEach((t, i) => {
          const h = Array.from(t.querySelectorAll('.mat-header-cell, mat-header-cell, [class*="header-cell"]')).map(e => e.textContent.trim());
          const rows = Array.from(t.querySelectorAll('.mat-row, mat-row, [class*="mat-row"]')).map(tr =>
            Array.from(tr.querySelectorAll('.mat-cell, mat-cell, [class*="mat-cell"]')).map(c => c.textContent.trim()));
          r.tables.push({ i, type: 'mat', headers: h, rows: rows.length, sample: rows.slice(0, 3) });
        });
        return r;
      });
      console.log('\n' + JSON.stringify(reconData, null, 2));
      ensureDir(DADOS_DIR);
      fs.writeFileSync(path.join(DADOS_DIR, `recon_${compraId}.json`), JSON.stringify(reconData, null, 2));
      log('Recon salvo.');
      return;
    }

    // --- CAPTURE: expande os cards e mostra o texto + parse por proposta ---
    if (args.includes('--capture')) {
      const itemCap = N || 1;
      const urlCap = `https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/acompanhamento-compra/item/${itemCap}?compra=${compraId}`;
      log(`[CAPTURE] Navegando p/ item ${itemCap} da compra ${compraId} (rota logada)...`);
      await page.goto(urlCap, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(5000);
      log(`[CAPTURE] URL: ${page.url()}`);
      log('[CAPTURE] Expandindo cards de proposta e capturando texto por card...');
      const cardsTexto = await expandirECapturarPropostas(page);
      const parsed = cardsTexto.map(t => parsearCardProposta(t));
      const comMarca = parsed.filter(p => p.marca).length;
      console.log(`\n${cardsTexto.length} card(s) capturado(s) · ${comMarca} com marca preenchida\n`);
      parsed.forEach((p, i) => {
        console.log(`#${i + 1} ${p.cnpj} | ${p.razaoSocial} | ofertado=${p.valorOfertado} | marca="${p.marca}" | modelo="${p.modelo}"`);
      });
      ensureDir(DADOS_DIR);
      const dump = path.join(DADOS_DIR, `capture_${compraId}.json`);
      fs.writeFileSync(dump, JSON.stringify({ cardsTexto, parsed }, null, 2), 'utf8');
      log(`Capture salvo em ${dump} (inclui o innerText cru de cada card p/ ajuste fino).`);
      return;
    }

    // --- RECON-DETALHES ---
    if (isReconDet) {
      const reconData = await reconDetalhes(page);
      console.log('\n' + JSON.stringify(reconData, null, 2));
      ensureDir(DADOS_DIR);
      fs.writeFileSync(path.join(DADOS_DIR, `recon_detalhes_${compraId}.json`), JSON.stringify(reconData, null, 2));
      log('Recon de detalhes salvo.');
      return;
    }

    // --- EXTRAÇÃO ---
    const resultados = [];

    // Verificar se estamos na compra certa, senão navega
    if (!urlAtual.includes(compraId)) {
      log(`⚠️ O Chrome está em outra compra. Navegando para a compra ${compraId}...`);
      await page.goto(`https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra/item/1?compra=${compraId}`);
      await sleep(5000); // Aguarda carregar
    }

    // Item 1: já carregado (ou recém carregado)
    log('Extraindo item 1...');
    const item1 = await extrairDadosPaginaAtual(page, 1);
    resultados.push(item1);
    log(`  ✅ Item 1: ${item1.propostas.length} proposta(s)`);
    if (item1.propostas.length) log(`     1ª: ${item1.propostas[0].cnpj} | ${item1.propostas[0].razaoSocial} | ${item1.propostas[0].valorOfertado} | ${item1.propostas[0].status}`);

    // Itens 2..N
    for (let i = 2; i <= N; i++) {
      try {
        await navegarParaItemSPA(page, compraId, i);
        const dados = await extrairDadosPaginaAtual(page, i);
        resultados.push(dados);
        log(`  ✅ Item ${i}: ${dados.propostas.length} proposta(s)`);
        if (dados.propostas.length) log(`     1ª: ${dados.propostas[0].cnpj} | ${dados.propostas[0].razaoSocial} | ${dados.propostas[0].valorOfertado}`);
        await sleep(DELAY_ENTRE_ITENS);
      } catch (err) {
        log(`  ❌ Item ${i}: ${err.message}`);
        resultados.push({ numeroItem: i, dadosItem: {}, propostas: [], headers: [] });
      }
    }

    // Salvar
    salvarSnapshot(resultados, compraId);
    await gerarExcel(resultados, compraId);

  } catch (err) {
    console.error('\n❌ Erro fatal:', err.message);
    console.error('Dicas: 1) Chrome com --remote-debugging-port=9222  2) Item 1 carregado manualmente  3) http://127.0.0.1:9222/json');
    process.exit(1);
  } finally {
    if (browser) browser.close().catch(() => {});
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  conectarChrome,
  navegarParaItemSPA,
  parsearCardProposta,
  expandirECapturarPropostas,
  extrairDadosPaginaAtual,
  expandirCardsECapturarDetalhes,
  reconDetalhes,
  gerarExcel,
  _nomeArquivoExcel,
  salvarSnapshot,
  hoje,
  sleep,
  log
};
