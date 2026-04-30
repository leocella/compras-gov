const fs = require('fs');
const path = require('path');
const da = require('./dadosabertos-api');

const DADOS_DIR = path.join(__dirname, 'dados');

function escapeCsv(str) {
  if (str === null || str === undefined) return '';
  const val = String(str);
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

async function rasparPregoesDadosAbertos() {
  if (!fs.existsSync(DADOS_DIR)) {
    fs.mkdirSync(DADOS_DIR, { recursive: true });
  }

  const csvPath = path.join(DADOS_DIR, 'pregoes_dadosabertos.csv');
  console.log('Iniciando raspagem no dadosabertos.compras.gov.br...');
  console.log('Buscando pregões do período: 01/01/2023 a 10/01/2023 (10 registros max para teste)');

  try {
    const res = await da.listarPregoes({
      dt_data_edital_inicial: '2023-01-01',
      dt_data_edital_final: '2023-01-10',
      pagina: 1,
      tamanhoPagina: 10
    });

    if (!res.resultado || res.resultado.length === 0) {
      console.log('Nenhum resultado encontrado.');
      return;
    }

    const pregoes = res.resultado;
    console.log(`\n✅ Sucesso! Recebidos ${pregoes.length} pregões (de um total de ${res.totalRegistros} na base para esse período).`);
    
    // Obter todos os campos do primeiro registro
    const campos = Object.keys(pregoes[0]);
    
    // Escrever cabeçalho se o arquivo não existir
    let isNovo = !fs.existsSync(csvPath);
    let csvContent = '';
    
    if (isNovo) {
      csvContent += campos.map(escapeCsv).join(',') + '\n';
    }

    // Escrever linhas
    for (const p of pregoes) {
      const linha = campos.map(c => escapeCsv(p[c])).join(',');
      csvContent += linha + '\n';
    }

    fs.appendFileSync(csvPath, csvContent, 'utf8');
    console.log(`\nSalvo no CSV: ${csvPath}`);
    
    // Mostrar preview dos 3 primeiros no console
    console.log('\n--- PREVIEW DOS DADOS (Primeiros 2 registros) ---');
    console.log(JSON.stringify(pregoes.slice(0, 2), null, 2));

  } catch (err) {
    console.error('Erro na raspagem:', err.message);
  }
}

rasparPregoesDadosAbertos();
