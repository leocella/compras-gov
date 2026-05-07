#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  conectarChrome,
  navegarParaItemSPA,
  extrairDadosPaginaAtual,
  gerarExcel,
  salvarSnapshot,
  sleep,
  log
} = require('./raspar-propostas-cdp');

const DELAY_ENTRE_ITENS = 3000;
const DELAY_ENTRE_COMPRAS = 5000;

async function main() {
  const alvoPath = path.join(__dirname, 'compras-alvo.json');
  if (!fs.existsSync(alvoPath)) {
    console.error(`❌ Arquivo ${alvoPath} não encontrado.`);
    process.exit(1);
  }

  const alvos = JSON.parse(fs.readFileSync(alvoPath, 'utf8'));
  if (alvos.length === 0) {
    console.error('❌ Nenhuma compra definida no JSON.');
    process.exit(1);
  }

  log(`Iniciando processamento em lote de ${alvos.length} compras...`);

  let browser;
  try {
    const conn = await conectarChrome();
    browser = conn.browser;
    const page = conn.page;

    const urlAtual = page.url();
    if (!urlAtual.includes('comprasnet') && !urlAtual.includes('compras') && !urlAtual.includes('serpro.gov')) {
      log(`⚠️ URL atual não parece ser ComprasGov: ${urlAtual}`);
      log('   Navegue manualmente para qualquer página do ComprasGov e logue antes de rodar o lote.');
    }

    for (let i = 0; i < alvos.length; i++) {
      const alvo = alvos[i];
      const compraId = alvo.compraId;
      log(`\n================================================================`);
      log(`🔄 [${i+1}/${alvos.length}] Processando Compra: ${compraId} (${alvo.tipo} ${alvo.numero})`);
      log(`================================================================`);

      const resultados = [];
      let itemAtual = 1;
      let limitItens = 200; // Hard limit para evitar loop infinito
      if (alvo.totalItens && alvo.totalItens !== "auto") {
        limitItens = parseInt(alvo.totalItens, 10) || 200;
      }

      while (itemAtual <= limitItens) {
        try {
          if (itemAtual === 1) {
            // Na mudança de compra, pushState não funciona bem no Angular. Fazemos um goto real.
            const urlAlvo = `https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra/item/1?compra=${compraId}`;
            if (!page.url().includes(compraId)) {
              await page.goto(urlAlvo);
              await sleep(5000);
            }
          } else {
            await navegarParaItemSPA(page, compraId, itemAtual);
          }
          
          const dados = await extrairDadosPaginaAtual(page, itemAtual);

          // Critério de parada: se não retornou a descrição do item, possivelmente o item não existe
          if (!dados || !dados.dadosItem || !dados.dadosItem.descricao) {
            log(`  ⚠️ Item ${itemAtual} não retornou descrição. Considerado fim da compra (ou item vazio).`);
            break; 
          }

          resultados.push(dados);
          log(`  ✅ Item ${itemAtual}: ${dados.propostas.length} proposta(s) extraída(s)`);
          
          itemAtual++;
          await sleep(DELAY_ENTRE_ITENS);
        } catch (err) {
          log(`  ❌ Erro no Item ${itemAtual} da compra ${compraId}: ${err.message}`);
          break; // Em caso de erro severo, sai do loop desta compra
        }
      }

      if (resultados.length > 0) {
        salvarSnapshot(resultados, compraId);
        await gerarExcel(resultados, compraId);
        log(`🎉 Compra ${compraId} concluída. Itens raspados: ${resultados.length}`);
      } else {
        log(`⚠️ Nenhum dado capturado para a compra ${compraId}. Verifique se a compra existe ou se precisa resolver Captcha.`);
      }

      if (i < alvos.length - 1) {
        log(`Aguardando ${DELAY_ENTRE_COMPRAS / 1000}s antes da próxima compra...`);
        await sleep(DELAY_ENTRE_COMPRAS);
      }
    }

    log(`\n✅ Lote finalizado com sucesso!`);

  } catch (err) {
    console.error('\n❌ Erro fatal no processamento em lote:', err.message);
  } finally {
    if (browser) browser.close().catch(() => {});
  }
}

main();
