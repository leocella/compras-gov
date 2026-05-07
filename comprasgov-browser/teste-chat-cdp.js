#!/usr/bin/env node
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { lerMensagensChat, SEL_MSG } = require('./comprasgov');

const CDP_ENDPOINT = 'http://127.0.0.1:9222';

async function main() {
  console.log('Conectando ao Chrome via CDP na porta 9222...');
  
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_ENDPOINT);
  } catch (err) {
    console.error('❌ Erro: Não foi possível conectar ao Chrome. Ele está aberto com --remote-debugging-port=9222?');
    process.exit(1);
  }

  const contexts = browser.contexts();
  let pageSessao = null;

  for (const ctx of contexts) {
    for (const p of ctx.pages()) {
      const url = p.url();
      if (url.includes('comprasnet') || url.includes('gov.br/compras')) {
        pageSessao = p;
        break;
      }
    }
  }

  if (!pageSessao) {
    console.error('❌ Erro: Não encontrei nenhuma aba do ComprasGov ou ComprasNet aberta no seu Chrome.');
    process.exit(1);
  }

  console.log(`✅ Conectado na aba: ${pageSessao.url()}`);

  const args = process.argv.slice(2);
  const compraId = args[0];

  if (!compraId) {
    console.log(`
Uso: node teste-chat-cdp.js <COMPRA_ID> [--recon]

Exemplos:
  node teste-chat-cdp.js 92611506000192025
  node teste-chat-cdp.js 92611506000192025 --recon
`);
    process.exit(0);
  }

  const isRecon = args.includes('--recon');

  if (isRecon) {
    console.log('\n[RECON] Navegando para o chat de mensagens...');
    await pageSessao.goto(SEL_MSG.urlChat, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 3000));
    
    console.log('[RECON] Salvando HTML da página atual em dados/recon-chat.html');
    const html = await pageSessao.content();
    if (!fs.existsSync(path.join(__dirname, 'dados'))) fs.mkdirSync(path.join(__dirname, 'dados'));
    fs.writeFileSync(path.join(__dirname, 'dados', 'recon-chat.html'), html);
    console.log('✅ Salvo! Você pode inspecionar o HTML para corrigir os seletores.');
    
    process.exit(0);
  }

  console.log(`\n🔍 Extraindo mensagens da compra ${compraId}...`);
  try {
    const resultado = await lerMensagensChat(pageSessao, compraId);
    console.log('\n✅ Extração concluída!');
    console.log(`Total de mensagens: ${resultado.total}`);
    if (resultado.total > 0) {
      const outPath = path.join(__dirname, 'dados', `mensagens_${compraId}.json`);
      if (!fs.existsSync(path.dirname(outPath))) fs.mkdirSync(path.dirname(outPath));
      fs.writeFileSync(outPath, JSON.stringify(resultado.mensagens, null, 2), 'utf8');
      console.log(`\n✅ Todas as ${resultado.total} mensagens foram salvas no arquivo: ${outPath}`);
      console.log('\nÚltimas 3 mensagens:');
      const ultimas = resultado.mensagens.slice(-3);
      ultimas.forEach(m => {
        console.log(`[${m.dataHora}] ${m.remetente}: ${m.texto}`);
      });
    }
  } catch (err) {
    console.error(`\n❌ Erro ao extrair mensagens: ${err.message}`);
    console.log('Se o erro for sobre seletores, rode com a flag --recon para inspecionar o HTML da página.');
  }

  process.exit(0);
}

main();
