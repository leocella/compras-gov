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
  const novoCaminho = `/comprasnet-web/public/compras/acompanhamento-compra/item/${numItem}?compra=${compraId}`;
  log(`  Navegando SPA → item ${numItem}...`);
  await page.evaluate((path) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }, novoCaminho);
  await sleep(4000);
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
    const itemMatch = texto.match(/(\d+)\s+(.+?)\n(?:Exclusividade[^\n]*\n)?(?:(Homologado|Em andamento|Deserto|Fracassado|Revogado|Anulado)[^\n]*\n)?Qtde solicitada:\nQtde aceita:\nValor estimado \(unitário\)\n(\d+)\n(\d+)\nR\$\s*([\d.,]+)/);
    if (itemMatch) {
      result.dadosItem = {
        descricao: itemMatch[2].trim(),
        quantidade: itemMatch[5],
        qtdeSolicitada: itemMatch[4],
        valorEstimado: itemMatch[6],
        situacaoItem: itemMatch[3] || '',
      };
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

      result.propostas.push({
        posicao: String(posicao), cnpj, porte, status, razaoSocial, uf,
        valorOfertado, valorNegociado, marca: '', modelo: '', fabricante: '',
      });
    }
    return result;
  }, numItem);

  return dados;
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
        const textoExpandido = await page.evaluate((idx, sel) => {
          const panels = document.querySelectorAll(sel);
          const panel = panels[idx];
          // O conteúdo fica no elemento pai ou irmão do header
          const parent = panel.closest('mat-expansion-panel, [class*="expansion-panel"], [class*="accordion-item"]');
          if (parent) return parent.innerText;
          // Fallback: pegar o próximo sibling
          const next = panel.nextElementSibling;
          return next ? next.innerText : '';
        }, i, seletorFuncional);

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
async function gerarExcel(resultados, compraId) {
  ensureDir(DADOS_DIR);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Propostas');

  const FILL_PRETO  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
  const FONT_HEADER = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
  const FILL_CINZA  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
  const FONT_ITEM   = { bold: true, size: 11, name: 'Calibri' };
  const BORDER      = { top: {style:'thin'}, bottom: {style:'thin'}, left: {style:'thin'}, right: {style:'thin'} };

  ws.columns = [
    { header: 'Item',             key: 'item',           width: 8  },
    { header: 'Posição',          key: 'posicao',        width: 10 },
    { header: 'CNPJ',             key: 'cnpj',           width: 22 },
    { header: 'Razão Social',     key: 'razaoSocial',    width: 45 },
    { header: 'UF',               key: 'uf',             width: 5  },
    { header: 'Porte',            key: 'porte',          width: 12 },
    { header: 'Marca',            key: 'marca',          width: 20 },
    { header: 'Modelo',           key: 'modelo',         width: 20 },
    { header: 'Valor Ofertado',   key: 'valorOfertado',  width: 18 },
    { header: 'Quantidade',       key: 'quantidade',     width: 14 },
    { header: 'Valor Total',      key: 'valorTotal',     width: 18 },
    { header: 'Valor Negociado',  key: 'valorNegociado', width: 18 },
    { header: 'Status',           key: 'status',         width: 25 },
    { header: 'Descrição',        key: 'descricao',      width: 50 },
  ];

  const hr = ws.getRow(1);
  hr.eachCell(c => { c.fill = FILL_PRETO; c.font = FONT_HEADER; c.border = BORDER; c.alignment = { horizontal:'center', vertical:'middle', wrapText:true }; });
  hr.height = 25;

  let row = 2;
  for (const r of resultados) {
    // Linha cinza do item
    const ir = ws.getRow(row);
    ir.getCell('item').value = `Item ${r.numeroItem}`;
    ir.getCell('descricao').value = r.dadosItem.descricao || '';
    ir.getCell('quantidade').value = parseQtd(r.dadosItem.quantidade);
    ir.eachCell(c => { c.fill = FILL_CINZA; c.font = FONT_ITEM; c.border = BORDER; });
    row++;

    if (!r.propostas || r.propostas.length === 0) continue;

    for (const p of r.propostas) {
      const rn = row;
      const wr = ws.getRow(rn);
      wr.getCell('item').value = r.numeroItem;
      wr.getCell('posicao').value = p.posicao;
      wr.getCell('cnpj').value = p.cnpj;
      wr.getCell('razaoSocial').value = p.razaoSocial;
      wr.getCell('uf').value = p.uf || '';
      wr.getCell('porte').value = p.porte;
      wr.getCell('marca').value = p.marca || '';
      wr.getCell('modelo').value = p.modelo || '';
      wr.getCell('status').value = p.status;
      wr.getCell('descricao').value = r.dadosItem.descricao || '';

      const val = parseValor(p.valorOfertado);
      wr.getCell('valorOfertado').value = val;
      wr.getCell('valorOfertado').numFmt = '#,##0.00';
      wr.getCell('quantidade').value = parseQtd(r.dadosItem.quantidade);
      // Fórmula: Valor Total = I (valorOfertado col 9) * J (quantidade col 10)
      wr.getCell('valorTotal').value = { formula: `I${rn}*J${rn}`, result: 0 };
      wr.getCell('valorTotal').numFmt = '#,##0.00';
      const valNeg = parseValor(p.valorNegociado);
      wr.getCell('valorNegociado').value = valNeg;
      if (valNeg) wr.getCell('valorNegociado').numFmt = '#,##0.00';
      wr.eachCell(c => { c.border = BORDER; c.alignment = { vertical:'middle', wrapText:true }; });
      row++;
    }
  }

  const nome = `Propostas_${compraId}_${hoje()}.xlsx`;
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
    --expandir         Expande cada card para capturar marca/modelo (mais lento)

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

    // Item 1: já carregado
    log('Extraindo item 1 (já carregado)...');
    const item1 = await extrairDadosPaginaAtual(page, 1);
    if (isExpandir) {
      const det = await expandirCardsECapturarDetalhes(page, 1);
      for (const p of item1.propostas) {
        if (det[p.cnpj]) { p.marca = det[p.cnpj].marca; p.modelo = det[p.cnpj].modelo; p.fabricante = det[p.cnpj].fabricante; }
      }
    }
    resultados.push(item1);
    log(`  ✅ Item 1: ${item1.propostas.length} proposta(s)`);
    if (item1.propostas.length) log(`     1ª: ${item1.propostas[0].cnpj} | ${item1.propostas[0].razaoSocial} | ${item1.propostas[0].valorOfertado} | ${item1.propostas[0].status}`);

    // Itens 2..N
    for (let i = 2; i <= N; i++) {
      try {
        await navegarParaItemSPA(page, compraId, i);
        const dados = await extrairDadosPaginaAtual(page, i);
        if (isExpandir && dados.propostas.length > 0) {
          const det = await expandirCardsECapturarDetalhes(page, i);
          for (const p of dados.propostas) {
            if (det[p.cnpj]) { p.marca = det[p.cnpj].marca; p.modelo = det[p.cnpj].modelo; p.fabricante = det[p.cnpj].fabricante; }
          }
        }
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

main();
