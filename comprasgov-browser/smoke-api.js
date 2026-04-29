/**
 * smoke-api.js
 * Testa os endpoints da API PNCP diretamente (sem precisar do Express/browser).
 * Execute: node smoke-api.js
 */
'use strict';

const { buscarItensPregaoApi, listarContratacoesRecentes } = require('./pncp-api');

async function main() {
  console.log('=== Smoke test PNCP REST API ===\n');

  // --- Teste 1: Listar contratações recentes ---
  console.log('📋 Teste 1: Listando pregões eletrônicos (últimos 7 dias)...');
  try {
    const hoje = new Date();
    const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
    const df = fmt(hoje);
    const di = fmt(new Date(hoje - 7 * 86400e3));

    const resultado = await listarContratacoesRecentes({ dataInicial: di, dataFinal: df, tamanhoPagina: 10 });
    console.log(`✅ Total no PNCP: ${resultado.totalRegistros} pregões`);
    console.log(`   Retornados: ${(resultado.data || []).length} nesta página`);

    if (resultado.data && resultado.data.length > 0) {
      const ex = resultado.data[0];
      console.log(`   Exemplo: CNPJ=${ex.orgaoEntidade?.cnpj} Ano=${ex.anoCompra} Seq=${ex.sequencialCompra} Nº=${ex.numeroCompra}`);
      console.log(`   Objeto: ${(ex.objetoCompra || '').slice(0, 80)}...`);

      // --- Teste 2: Buscar itens do primeiro pregão ---
      console.log('\n📦 Teste 2: Buscando itens do primeiro pregão...');
      const cnpj = ex.orgaoEntidade?.cnpj;
      const ano = ex.anoCompra;
      const sequencial = ex.sequencialCompra;

      if (cnpj && ano && sequencial) {
        const itens = await buscarItensPregaoApi({ cnpj, ano, sequencial });
        console.log(`✅ Total de itens: ${itens.length}`);
        itens.slice(0, 3).forEach((item, i) => {
          console.log(`   [${i + 1}] ${item.descricao?.slice(0, 60)} | Qtd: ${item.quantidade} ${item.unidadeMedida} | R$ ${item.valorUnitarioEstimado}`);
        });
      }
    }
  } catch (err) {
    console.error('❌', err.message);
  }

  // --- Teste 3: Buscar itens por sequencial fixo (pregão conhecido) ---
  console.log('\n🔍 Teste 3: Itens do pregão fixo (CNPJ=90483058000126, ano=2026, seq=54)...');
  try {
    const itens = await buscarItensPregaoApi({ cnpj: '90483058000126', ano: 2026, sequencial: 54 });
    console.log(`✅ Total de itens: ${itens.length}`);
    itens.slice(0, 5).forEach((item, i) => {
      const marcas = [];
      if (item.marcaObrigatoria) marcas.push(`obrig:${item.marcaObrigatoria}`);
      if (item.marcaPreferencia) marcas.push(`pref:${item.marcaPreferencia}`);
      console.log(`   [${item.numeroItem}] ${item.descricao?.slice(0, 55)} | ${item.quantidade} ${item.unidadeMedida} | R$ ${item.valorUnitarioEstimado}${marcas.length ? ' | ' + marcas.join(', ') : ''}`);
    });
  } catch (err) {
    console.error('❌', err.message);
  }

  console.log('\n=== Fim do smoke test ===');
}

main().catch(console.error);
