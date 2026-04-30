const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const fs = require('fs');
const path = require('path');

async function extrairPropostasParaCsv(urlCompra) {
  console.log('Iniciando o verdadeiro Google Chrome (Modo Anti-Bot Avançado)...');
  
  const userDataDir = path.join(__dirname, 'chrome_perfil_robo');
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  // Lança o Chrome usando um perfil persistente para ganhar "Trust Score" do hCaptcha
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome', // Usa o Chrome instalado na máquina (não o Chromium embutido)
    viewport: null,
    args: ['--start-maximized']
  });
  
  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
  
  let jsonCapturado = null;
  let dadosCompra = null;

  // Interceptar chamadas de rede
  page.on('response', async (res) => {
    const url = res.url();
    
    // Captura qualquer chamada da API de compras que retorne sucesso
    if (url.includes('/v1/compras/') && res.request().method() === 'GET') {
      try {
        const json = await res.json();
        // Se o JSON tiver uma propriedade itens ou for um array com itens, é o que queremos!
        if (json.itens || Array.isArray(json) || (json._links && json.itens !== undefined) || url.includes('/itens')) {
           console.log(`\n>>> BINGO! JSON interceptado da URL: ${url}`);
           jsonCapturado = json;
        } else if (!dadosCompra) {
           dadosCompra = json; // Guarda os dados básicos do pregão
        }
      } catch(e) {}
    }
  });

  console.log(`\nNavegando para: ${urlCompra}`);
  console.log('⚠️ DICA: O hCaptcha invisível do Serpro é bugado. Continue dando F5 (Atualizar a página) até a tabela carregar!');
  console.log('Aguardando os dados da API...\n');

  try {
    await page.goto(urlCompra, { waitUntil: 'domcontentloaded', timeout: 0 });
    
    while (!jsonCapturado) {
      await page.waitForTimeout(1000);
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
    await context.close();
  }
}

// Pega a URL do argumento da linha de comando, ou usa a URL de exemplo fornecida
const urlAlvo = process.argv[2] || 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra/item/1?compra=16030405900012026';

extrairPropostasParaCsv(urlAlvo);
