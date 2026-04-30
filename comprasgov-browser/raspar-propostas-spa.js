const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const fs = require('fs');

async function extrairPropostasParaCsv(urlCompra) {
  console.log('Iniciando Chromium (com interface gráfica)...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  let jsonCapturado = null;
  let dadosCompra = null;

  // Interceptar chamadas de rede
  page.on('response', async (res) => {
    const url = res.url();
    
    // Captura os dados gerais da compra (opcional, mas bom pra ter contexto)
    if (url.includes('/public/v1/compras/') && !url.includes('/itens') && res.request().method() === 'GET') {
      try { dadosCompra = await res.json(); } catch(e) {}
    }
    
    // Captura a lista de itens e as PROPOSTAS dos fornecedores
    if (url.includes('/itens') && url.includes('fase-externa') && res.request().method() === 'GET') {
      try {
        console.log('>>> JSON da API interceptado com sucesso!');
        jsonCapturado = await res.json();
      } catch(e) {
        console.error('Falha ao ler JSON interceptado:', e.message);
      }
    }
  });

  console.log(`\nNavegando para: ${urlCompra}`);
  console.log('⚠️ ATENÇÃO: Se aparecer um hCaptcha (desafio de imagens), resolva-o manualmente na janela do Chrome!');
  console.log('Aguardando os dados da API carregarem...\n');

  try {
    await page.goto(urlCompra, { waitUntil: 'domcontentloaded', timeout: 0 });
    
    // Loop aguardando a captura do JSON (espera até o usuário passar do captcha)
    while (!jsonCapturado) {
      await page.waitForTimeout(1000);
      // Mantém o script rodando enquanto o json não chegar
    }
    
    console.log('Processando propostas para gerar o Excel/CSV...');
    
    // Processamento do JSON para formato tabular
    let csvContent = 'Item,Descrição,Fornecedor,CNPJ,Valor Proposta,Situação,Marca/Modelo\n';
    
    // O formato exato depende do JSON retornado pelo Serpro, mas geralmente é um array de itens,
    // e cada item tem um array de propostas.
    const itens = Array.isArray(jsonCapturado) ? jsonCapturado : (jsonCapturado.itens || jsonCapturado._embedded?.itens || []);
    
    let totalPropostas = 0;
    
    for (const item of itens) {
      const numItem = item.numero || item.numeroItem || '?';
      const descricao = item.descricao || item.descricaoItem || '';
      
      const propostas = item.propostas || item.participacoes || [];
      for (const prop of propostas) {
        totalPropostas++;
        const fornecedor = prop.nomeFornecedor || prop.fornecedor?.nome || '';
        const cnpj = prop.niFornecedor || prop.fornecedor?.cnpjCpf || '';
        const valor = prop.valorProposta || prop.valorGlobal || prop.valorUnitario || '';
        const situacao = prop.situacao || prop.situacaoProposta || '';
        const marca = prop.marca || prop.modelo || '';
        
        const linha = [
          numItem,
          `"${descricao.replace(/"/g, '""')}"`,
          `"${fornecedor.replace(/"/g, '""')}"`,
          cnpj,
          valor,
          `"${situacao}"`,
          `"${marca.replace(/"/g, '""')}"`
        ].join(',');
        
        csvContent += linha + '\n';
      }
    }
    
    fs.writeFileSync('propostas_comprasgov.csv', csvContent, 'utf8');
    console.log(`\n✅ Sucesso! Foram extraídas ${totalPropostas} propostas de ${itens.length} itens.`);
    console.log('Os dados foram salvos em: propostas_comprasgov.csv (Pode abrir no Excel)');

  } catch (err) {
    console.error('Erro durante a execução:', err.message);
  } finally {
    console.log('Fechando navegador...');
    await browser.close();
  }
}

// Pega a URL do argumento da linha de comando, ou usa a URL de exemplo fornecida
const urlAlvo = process.argv[2] || 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra/item/1?compra=16030405900012026';

extrairPropostasParaCsv(urlAlvo);
