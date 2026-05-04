#!/usr/bin/env node
'use strict';

/**
 * raspar-propostas-cdp.js
 *
 * ESTRATÉGIA ANTI-CAPTCHA:
 *   1. Você navega manualmente no Chrome até o item 1 da compra
 *   2. O script conecta via CDP e NÃO faz page.goto() (isso dispara CAPTCHA)
 *   3. Para trocar de item, usa navegação interna do SPA Angular (history API)
 *   4. Intercepta respostas da API para capturar JSON direto
 *
 * Uso:
 *   node raspar-propostas-cdp.js <compra_id> <total_itens>
 *   node raspar-propostas-cdp.js <compra_id> <total_itens> --recon
 *
 * Pré-requisitos:
 *   1. Chrome aberto com: "C:\Program Files\Google\Chrome\Application\chrome.exe"
 *      --remote-debugging-port=9222 --user-data-dir="<pasta>/chrome-debug-profile"
 *   2. No Chrome, navegar manualmente até:
 *      https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/
 *      acompanhamento-compra/item/1?compra=<compra_id>
 *   3. Esperar a tabela de propostas carregar (resolver CAPTCHA se pedir)
 *   4. Rodar este script
 */

const { chromium } = require('playwright');
const ExcelJS      = require('exceljs');
const path         = require('path');
const fs           = require('fs');

const CDP_ENDPOINT      = 'http://127.0.0.1:9222';
const DADOS_DIR         = path.join(__dirname, 'dados');
const DELAY_ENTRE_ITENS = 3000;

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`);
}
function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// Conectar ao Chrome via CDP
// ---------------------------------------------------------------------------
async function conectarChrome() {
  log('Conectando ao Chrome via CDP...');
  const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
  const contexts = browser.contexts();
  if (!contexts.length) throw new Error('Nenhum contexto no Chrome.');

  // Buscar a aba correta: procurar em TODOS os contextos por URL do ComprasGov
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

  // Fallback: primeira aba que NÃO seja chrome://
  if (!page) {
    page = allPages.find(p => !p.url().startsWith('chrome://')) || allPages[0];
  }

  log(`Conectado! ${allPages.length} aba(s). Usando: ${page.url()}`);
  return { browser, page };
}

// ---------------------------------------------------------------------------
// Navegar para outro item DENTRO do SPA (sem page.goto, sem CAPTCHA)
// Usa history.pushState + popstate para Angular detectar a mudança de rota
// ---------------------------------------------------------------------------
async function navegarParaItemSPA(page, compraId, numItem) {
  const novoCaminho = `/comprasnet-web/public/compras/acompanhamento-compra/item/${numItem}?compra=${compraId}`;
  log(`  Navegando SPA → item ${numItem}...`);

  await page.evaluate((path) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }, novoCaminho);

  // Esperar Angular processar a mudança de rota
  await sleep(4000);
}

async function extrairDadosPaginaAtual(page, numItem) {
  // Esperar conteúdo renderizar (não há <table>, são cards/divs)
  await sleep(2000);

  const dados = await page.evaluate((itemNum) => {
    const texto = document.body.innerText;
    const result = { numeroItem: itemNum, dadosItem: {}, propostas: [], headers: [] };

    // --- Dados do item (cabeçalho) ---
    // Padrão: "1 TORNO BANCADA\nExclusividade ME/EPP\nHomologado\nQtde solicitada:\nQtde aceita:\nValor estimado (unitário)\n8\n8\nR$ 610,7900"
    const itemMatch = texto.match(/(\d+)\s+(.+?)\n(?:Exclusividade[^\n]*\n)?(?:(Homologado|Em andamento|Deserto|Fracassado|Revogado|Anulado)[^\n]*\n)?Qtde solicitada:\nQtde aceita:\nValor estimado \(unitário\)\n(\d+)\n(\d+)\nR\$\s*([\d.,]+)/);
    if (itemMatch) {
      result.dadosItem = {
        descricao: itemMatch[2].trim(),
        quantidade: itemMatch[5],         // qtde aceita
        qtdeSolicitada: itemMatch[4],
        valorEstimado: itemMatch[6],
        situacaoItem: itemMatch[3] || '',
      };
    }

    // --- Propostas (cards de fornecedores) ---
    // Cada fornecedor aparece como bloco:
    //   CNPJ\nPORTE\n[badges...]\nRAZÃO SOCIAL\nUF\nValor ofertado (unitário)\nValor negociado (unitário)\nR$ XXX\n-
    // Regex para capturar cada bloco de fornecedor
    const blocos = texto.split(/(?=\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\n)/);

    let posicao = 0;
    for (const bloco of blocos) {
      // Verificar se começa com CNPJ
      const cnpjMatch = bloco.match(/^(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\n/);
      if (!cnpjMatch) continue;

      posicao++;
      const cnpj = cnpjMatch[1];
      const linhas = bloco.split('\n').map(l => l.trim()).filter(l => l);

      // Porte: ME/EPP, EPP, ME, etc.
      let porte = '';
      let status = '';
      let razaoSocial = '';
      let uf = '';
      let valorOfertado = '';
      let valorNegociado = '';
      let marca = '';
      let modelo = '';

      // Parsear linhas sequencialmente
      let idx = 1; // pular CNPJ (idx 0)

      // Porte (geralmente logo após CNPJ)
      if (idx < linhas.length && /^(ME\/EPP|ME|EPP|DEMAIS|Demais)$/i.test(linhas[idx])) {
        porte = linhas[idx]; idx++;
      }

      // Status e badges (Inabilitada, Adjudicada, Aceita, etc.)
      // Pode ter badges como "Equidade de gênero", "Programa de integridade" antes/depois
      const statusKeywords = ['Inabilitada', 'Adjudicada', 'Aceita', 'Desclassificada', 'Recusada',
        'Aceita e habilitada', 'Classificada', 'Cancelada'];
      while (idx < linhas.length) {
        const l = linhas[idx];
        const foundStatus = statusKeywords.find(s => l.toLowerCase().includes(s.toLowerCase()));
        if (foundStatus) { status = l; idx++; break; }
        if (/equidade|programa de integridade/i.test(l)) { idx++; continue; }
        break;
      }

      // Pular mais badges (Equidade, Programa de integridade) que podem vir depois do status
      while (idx < linhas.length && /equidade|programa de integridade/i.test(linhas[idx])) {
        idx++;
      }

      // Razão Social (próxima linha que não é badge/valor/UF curta)
      if (idx < linhas.length && linhas[idx].length > 3 && !/^R\$/.test(linhas[idx]) && !/^Valor/.test(linhas[idx])) {
        razaoSocial = linhas[idx]; idx++;
      }

      // UF (2 letras)
      if (idx < linhas.length && /^[A-Z]{2}$/.test(linhas[idx])) {
        uf = linhas[idx]; idx++;
      }

      // Valores
      for (let j = idx; j < linhas.length; j++) {
        if (linhas[j].startsWith('R$') && !valorOfertado) {
          valorOfertado = linhas[j];
        } else if (linhas[j].startsWith('R$') && valorOfertado) {
          valorNegociado = linhas[j];
        }
      }

      result.propostas.push({
        posicao: String(posicao),
        cnpj, porte, status, razaoSocial, uf,
        valorOfertado, valorNegociado,
        marca, modelo, fabricante: '',
      });
    }

    return result;
  }, numItem);

  return dados;
}


// ---------------------------------------------------------------------------
// Gerar .xlsx formatado
// ---------------------------------------------------------------------------
async function gerarExcel(resultados, compraId) {
  ensureDir(DADOS_DIR);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Propostas');

  const FILL_PRETO     = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
  const FONT_HEADER    = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
  const FILL_CINZA     = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
  const FONT_ITEM      = { bold: true, size: 11, name: 'Calibri' };
  const BORDER         = { top: {style:'thin'}, bottom: {style:'thin'}, left: {style:'thin'}, right: {style:'thin'} };

  // Colunas: A=Item, B=Posição, C=CNPJ, D=Razão Social, E=UF, F=Porte,
  //          G=Valor Ofertado, H=Quantidade, I=Valor Total(fórmula), J=Valor Negociado, K=Status, L=Descrição
  ws.columns = [
    { header: 'Item',             key: 'item',           width: 8  },
    { header: 'Posição',          key: 'posicao',        width: 10 },
    { header: 'CNPJ',             key: 'cnpj',           width: 22 },
    { header: 'Razão Social',     key: 'razaoSocial',    width: 45 },
    { header: 'UF',               key: 'uf',             width: 5  },
    { header: 'Porte',            key: 'porte',          width: 12 },
    { header: 'Valor Ofertado',   key: 'valorOfertado',  width: 18 },
    { header: 'Quantidade',       key: 'quantidade',     width: 14 },
    { header: 'Valor Total',      key: 'valorTotal',     width: 18 },
    { header: 'Valor Negociado',  key: 'valorNegociado', width: 18 },
    { header: 'Status',           key: 'status',         width: 25 },
    { header: 'Descrição',        key: 'descricao',      width: 50 },
  ];

  // Cabeçalho preto
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

    if (r.propostas.length === 0) continue;

    for (const p of r.propostas) {
      const rn = row;
      const wr = ws.getRow(rn);
      wr.getCell('item').value = r.numeroItem;
      wr.getCell('posicao').value = p.posicao;
      wr.getCell('cnpj').value = p.cnpj;
      wr.getCell('razaoSocial').value = p.razaoSocial;
      wr.getCell('uf').value = p.uf || '';
      wr.getCell('porte').value = p.porte;
      wr.getCell('status').value = p.status;
      wr.getCell('descricao').value = r.dadosItem.descricao || '';

      const val = parseValor(p.valorOfertado);
      wr.getCell('valorOfertado').value = val;
      wr.getCell('valorOfertado').numFmt = '#,##0.00';
      wr.getCell('quantidade').value = parseQtd(r.dadosItem.quantidade);
      // Fórmula: Valor Total = G (valorOfertado) * H (quantidade)
      wr.getCell('valorTotal').value = { formula: `G${rn}*H${rn}`, result: 0 };
      wr.getCell('valorTotal').numFmt = '#,##0.00';
      const valNeg = parseValor(p.valorNegociado);
      wr.getCell('valorNegociado').value = valNeg;
      if (valNeg) wr.getCell('valorNegociado').numFmt = '#,##0.00';
      wr.eachCell(c => { c.border = BORDER; c.alignment = { vertical:'middle', wrapText:true }; });
      row++;
    }
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const nome = `Propostas_${compraId}_${ts}.xlsx`;
  const caminho = path.join(DADOS_DIR, nome);
  await wb.xlsx.writeFile(caminho);
  log(`\n✅ Excel: ${caminho}`);
  log(`   Itens: ${resultados.length} | Propostas: ${resultados.reduce((s, r) => s + r.propostas.length, 0)}`);
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
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2 || args[0] === '--help') {
    console.log(`
  Uso: node raspar-propostas-cdp.js <compra_id> <total_itens> [--recon]

  ANTES de rodar:
    1. Abra o Chrome com: & "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
       --remote-debugging-port=9222 --user-data-dir="...\\chrome-debug-profile"
    2. No Chrome, navegue manualmente até:
       https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/
       acompanhamento-compra/item/1?compra=<compra_id>
    3. Espere a tabela de propostas carregar (resolva CAPTCHA se pedir)
    4. Rode este script

  Exemplos:
    node raspar-propostas-cdp.js 16030405900012026 20
    node raspar-propostas-cdp.js 16030405900012026 5 --recon
`);
    process.exit(0);
  }

  const compraId = args[0];
  const N        = parseInt(args[1]) || 1;
  const isRecon  = args.includes('--recon');

  log(`CompraID: ${compraId} | Itens: ${N} | Modo: ${isRecon ? 'RECON' : 'EXTRAÇÃO'}`);
  log('⚠️  Certifique-se de que o item 1 JÁ está carregado no Chrome (sem CAPTCHA)!');

  let browser;
  try {
    const conn = await conectarChrome();
    browser = conn.browser;
    const page = conn.page;

    // Verificar que estamos na página certa
    const urlAtual = page.url();
    if (!urlAtual.includes('comprasnet') && !urlAtual.includes('compras')) {
      log(`⚠️  URL atual não parece ser ComprasGov: ${urlAtual}`);
      log('   Navegue manualmente para a página do item 1 antes de rodar o script.');
    }

    // --- RECON: captura estrutura da página atual ---
    if (isRecon) {
      log('[RECON] Capturando estrutura da página atual (sem navegar)...');
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

    // --- EXTRAÇÃO ---
    const resultados = [];

    // Item 1: já está carregado — só extrair
    log('Extraindo item 1 (já carregado)...');
    const item1 = await extrairDadosPaginaAtual(page, 1);
    resultados.push(item1);
    log(`  ✅ Item 1: ${item1.propostas.length} proposta(s)`);
    if (item1.headers.length) log(`  📊 Colunas: ${item1.headers.join(' | ')}`);
    if (item1.propostas.length) log(`     1ª: ${item1.propostas[0].cnpj} | ${item1.propostas[0].razaoSocial} | ${item1.propostas[0].valorOfertado} | ${item1.propostas[0].status}`);

    // Itens 2..N: navegar via SPA (sem page.goto, sem CAPTCHA)
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
    ensureDir(DADOS_DIR);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.writeFileSync(path.join(DADOS_DIR, `propostas_debug_${compraId}_${ts}.json`), JSON.stringify(resultados, null, 2));
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
