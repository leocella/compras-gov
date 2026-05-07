require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');
const telegram = require('./telegram');
telegram.init(process.env.TELEGRAM_TOKEN, process.env.TELEGRAM_CHAT_ID);
const agendador = require('./agendador');

(async () => {
  console.log('🔗 Conectando ao Chrome aberto na porta 9222...');
  
  let browser;
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  } catch (err) {
    console.error('❌ Erro: O Chrome não está aberto com a porta 9222 ou ocorreu uma falha na conexão.');
    console.error(err.message);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const abas = context.pages();
  
  // Acha a aba atual do comprasgov
  const pageSessao = abas.find(p => p.url().includes('gov.br/compras') || p.url().includes('comprasnet')) || abas[0];
  console.log(`✅ Conectado na aba: ${pageSessao.url()}`);

  console.log('\n⚙️ Inicializando Agendador (apenas para teste manual)...');
  
  agendador.init({
    telegram,
    getPage: () => pageSessao,
    getPageSessao: () => pageSessao,
    comprasAlvoPath: path.join(__dirname, 'compras-alvo.json'),
  });

  console.log('\n🚀 Executando a varredura do Pregoeiro AGORA (simulando a rodada de 5 min)...');
  console.log(`Ele vai ler o arquivo 'compras-alvo.json' e verificar cada pregão listado lá.`);
  
  try {
    await agendador.jobMensagensPregoeiro();
    console.log('\n✅ Varredura concluída com sucesso!');
    console.log('A primeira varredura não envia notificações (para não espamar mensagens velhas).');
    console.log('\n🤖 Enviando uma mensagem de TESTE FAKE para o seu Telegram agora para provar que está funcionando...');
    
    await telegram.notificarPregoeiro(
      '92611506000192025', 
      '926115', 
      'Item Teste', 
      'Esta é uma mensagem FAKE gerada pelo teste do agendador para verificar se o bot está vivo!', 
      true // marca como urgente para testar
    );
    console.log('✅ Mensagem de teste enviada!');
  } catch (err) {
    console.error('\n❌ Erro durante a varredura:', err.message);
  }

  process.exit(0);
})();
