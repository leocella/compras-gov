#!/usr/bin/env node
'use strict';

/**
 * comparar-snapshots.js
 *
 * Compara dois snapshots de propostas e gera relatório de mudanças:
 *   - Mudanças de status (desclassificado, habilitado, adjudicado)
 *   - Mudanças de posição
 *   - Novos fornecedores / fornecedores removidos
 *
 * Uso:
 *   node comparar-snapshots.js <compra_id>                        (ontem vs hoje)
 *   node comparar-snapshots.js <compra_id> 2026-05-03 2026-05-04  (datas específicas)
 *   node comparar-snapshots.js <compra_id> --listar               (lista snapshots disponíveis)
 */

const path = require('path');
const fs   = require('fs');

const SNAPSHOTS_DIR = path.join(__dirname, 'dados', 'snapshots');

function hoje() { return new Date().toISOString().slice(0, 10); }
function ontem() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Listar snapshots disponíveis
// ---------------------------------------------------------------------------
function listarSnapshots(compraId) {
  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    console.log('Nenhum snapshot encontrado. Rode raspar-propostas-cdp.js primeiro.');
    return;
  }
  const prefix = `snapshot_${compraId}_`;
  const files = fs.readdirSync(SNAPSHOTS_DIR)
    .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
    .sort();

  if (files.length === 0) {
    console.log(`Nenhum snapshot para compra ${compraId}.`);
    return;
  }

  console.log(`\n📸 Snapshots disponíveis para compra ${compraId}:\n`);
  for (const f of files) {
    const data = f.replace(prefix, '').replace('.json', '');
    const stats = fs.statSync(path.join(SNAPSHOTS_DIR, f));
    const tamanho = (stats.size / 1024).toFixed(1);
    const snapshot = JSON.parse(fs.readFileSync(path.join(SNAPSHOTS_DIR, f), 'utf8'));
    const totalItens = snapshot.length;
    const totalPropostas = snapshot.reduce((s, r) => s + (r.propostas?.length || 0), 0);
    console.log(`  📅 ${data}  |  ${totalItens} itens  |  ${totalPropostas} propostas  |  ${tamanho} KB`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Carregar snapshot
// ---------------------------------------------------------------------------
function carregarSnapshot(compraId, data) {
  const nome = `snapshot_${compraId}_${data}.json`;
  const caminho = path.join(SNAPSHOTS_DIR, nome);
  if (!fs.existsSync(caminho)) {
    throw new Error(`Snapshot não encontrado: ${caminho}\nRode: node comparar-snapshots.js ${compraId} --listar`);
  }
  return JSON.parse(fs.readFileSync(caminho, 'utf8'));
}

// ---------------------------------------------------------------------------
// Comparar snapshots
// ---------------------------------------------------------------------------
function compararSnapshots(anterior, atual) {
  const mudancas = {
    statusMudou: [],        // quem mudou de status
    posicaoMudou: [],       // quem mudou de posição
    novosFornecedores: [],  // apareceram hoje
    removidos: [],          // sumiram hoje
    novosItens: [],         // itens que não existiam antes
    resumo: { totalMudancas: 0 },
  };

  // Indexar snapshots por item + cnpj
  const indexAnterior = indexarPorItemCnpj(anterior);
  const indexAtual    = indexarPorItemCnpj(atual);

  // Todas as chaves únicas
  const todasChaves = new Set([...Object.keys(indexAnterior), ...Object.keys(indexAtual)]);

  for (const chave of todasChaves) {
    const ant = indexAnterior[chave];
    const atu = indexAtual[chave];

    if (!ant && atu) {
      // Novo fornecedor
      mudancas.novosFornecedores.push({
        item: atu.item,
        cnpj: atu.cnpj,
        razaoSocial: atu.razaoSocial,
        posicao: atu.posicao,
        status: atu.status,
        valorOfertado: atu.valorOfertado,
      });
      continue;
    }

    if (ant && !atu) {
      // Fornecedor removido
      mudancas.removidos.push({
        item: ant.item,
        cnpj: ant.cnpj,
        razaoSocial: ant.razaoSocial,
        posicaoAnterior: ant.posicao,
        statusAnterior: ant.status,
      });
      continue;
    }

    // Ambos existem — verificar mudanças
    if (ant.status !== atu.status) {
      mudancas.statusMudou.push({
        item: atu.item,
        cnpj: atu.cnpj,
        razaoSocial: atu.razaoSocial,
        statusAnterior: ant.status || '(sem status)',
        statusAtual: atu.status || '(sem status)',
        posicao: atu.posicao,
      });
    }

    if (ant.posicao !== atu.posicao) {
      mudancas.posicaoMudou.push({
        item: atu.item,
        cnpj: atu.cnpj,
        razaoSocial: atu.razaoSocial,
        posicaoAnterior: ant.posicao,
        posicaoAtual: atu.posicao,
        direcao: parseInt(atu.posicao) < parseInt(ant.posicao) ? '⬆️ subiu' : '⬇️ desceu',
      });
    }
  }

  mudancas.resumo.totalMudancas =
    mudancas.statusMudou.length +
    mudancas.posicaoMudou.length +
    mudancas.novosFornecedores.length +
    mudancas.removidos.length;

  return mudancas;
}

function indexarPorItemCnpj(snapshot) {
  const index = {};
  for (const item of snapshot) {
    if (!item.propostas) continue;
    for (const p of item.propostas) {
      const chave = `${item.numeroItem}_${p.cnpj}`;
      index[chave] = {
        item: item.numeroItem,
        descricao: item.dadosItem?.descricao || '',
        cnpj: p.cnpj,
        razaoSocial: p.razaoSocial,
        posicao: p.posicao,
        status: p.status,
        valorOfertado: p.valorOfertado,
        porte: p.porte,
      };
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// Exibir relatório no console
// ---------------------------------------------------------------------------
function exibirRelatorio(mudancas, dataAnterior, dataAtual) {
  console.log('\n' + '═'.repeat(80));
  console.log(`📊 RELATÓRIO DE MUDANÇAS: ${dataAnterior} → ${dataAtual}`);
  console.log('═'.repeat(80));

  if (mudancas.resumo.totalMudancas === 0) {
    console.log('\n  ✅ Nenhuma mudança detectada entre os dois snapshots.\n');
    return;
  }

  console.log(`\n  Total de mudanças: ${mudancas.resumo.totalMudancas}\n`);

  // Status
  if (mudancas.statusMudou.length > 0) {
    console.log('─'.repeat(80));
    console.log(`🔄 MUDANÇAS DE STATUS (${mudancas.statusMudou.length}):`);
    console.log('─'.repeat(80));
    for (const m of mudancas.statusMudou) {
      const emoji = getStatusEmoji(m.statusAtual);
      console.log(`  ${emoji} Item ${m.item} | ${m.cnpj} | ${m.razaoSocial}`);
      console.log(`     ${m.statusAnterior} → ${m.statusAtual}`);
    }
  }

  // Posição
  if (mudancas.posicaoMudou.length > 0) {
    console.log('\n' + '─'.repeat(80));
    console.log(`📈 MUDANÇAS DE POSIÇÃO (${mudancas.posicaoMudou.length}):`);
    console.log('─'.repeat(80));
    for (const m of mudancas.posicaoMudou) {
      console.log(`  ${m.direcao} Item ${m.item} | ${m.cnpj} | ${m.razaoSocial}`);
      console.log(`     Posição: ${m.posicaoAnterior}° → ${m.posicaoAtual}°`);
    }
  }

  // Novos
  if (mudancas.novosFornecedores.length > 0) {
    console.log('\n' + '─'.repeat(80));
    console.log(`🆕 NOVOS FORNECEDORES (${mudancas.novosFornecedores.length}):`);
    console.log('─'.repeat(80));
    for (const m of mudancas.novosFornecedores) {
      console.log(`  ➕ Item ${m.item} | ${m.cnpj} | ${m.razaoSocial} | Pos: ${m.posicao}° | ${m.status}`);
    }
  }

  // Removidos
  if (mudancas.removidos.length > 0) {
    console.log('\n' + '─'.repeat(80));
    console.log(`❌ REMOVIDOS (${mudancas.removidos.length}):`);
    console.log('─'.repeat(80));
    for (const m of mudancas.removidos) {
      console.log(`  ➖ Item ${m.item} | ${m.cnpj} | ${m.razaoSocial} | Era pos: ${m.posicaoAnterior}°`);
    }
  }

  console.log('\n' + '═'.repeat(80) + '\n');
}

function getStatusEmoji(status) {
  if (!status) return '⚪';
  const s = status.toLowerCase();
  if (s.includes('inabilitada') || s.includes('desclassificada') || s.includes('cancelada')) return '🔴';
  if (s.includes('adjudicada') || s.includes('aceita e habilitada')) return '🟢';
  if (s.includes('aceita')) return '🟡';
  return '🔵';
}

// ---------------------------------------------------------------------------
// Salvar relatório em arquivo texto
// ---------------------------------------------------------------------------
function salvarRelatorio(mudancas, compraId, dataAnterior, dataAtual) {
  const linhas = [];
  linhas.push(`RELATÓRIO DE MUDANÇAS: ${dataAnterior} → ${dataAtual}`);
  linhas.push(`Compra: ${compraId}`);
  linhas.push(`Gerado em: ${new Date().toLocaleString('pt-BR')}`);
  linhas.push(`Total de mudanças: ${mudancas.resumo.totalMudancas}`);
  linhas.push('');

  if (mudancas.statusMudou.length > 0) {
    linhas.push(`--- MUDANÇAS DE STATUS (${mudancas.statusMudou.length}) ---`);
    for (const m of mudancas.statusMudou) {
      linhas.push(`Item ${m.item} | ${m.cnpj} | ${m.razaoSocial} | ${m.statusAnterior} → ${m.statusAtual}`);
    }
    linhas.push('');
  }

  if (mudancas.posicaoMudou.length > 0) {
    linhas.push(`--- MUDANÇAS DE POSIÇÃO (${mudancas.posicaoMudou.length}) ---`);
    for (const m of mudancas.posicaoMudou) {
      linhas.push(`Item ${m.item} | ${m.cnpj} | ${m.razaoSocial} | Pos: ${m.posicaoAnterior} → ${m.posicaoAtual}`);
    }
    linhas.push('');
  }

  if (mudancas.novosFornecedores.length > 0) {
    linhas.push(`--- NOVOS (${mudancas.novosFornecedores.length}) ---`);
    for (const m of mudancas.novosFornecedores) {
      linhas.push(`Item ${m.item} | ${m.cnpj} | ${m.razaoSocial} | Pos: ${m.posicao} | ${m.status}`);
    }
    linhas.push('');
  }

  if (mudancas.removidos.length > 0) {
    linhas.push(`--- REMOVIDOS (${mudancas.removidos.length}) ---`);
    for (const m of mudancas.removidos) {
      linhas.push(`Item ${m.item} | ${m.cnpj} | ${m.razaoSocial} | Era pos: ${m.posicaoAnterior}`);
    }
  }

  const nome = `relatorio_${compraId}_${dataAnterior}_vs_${dataAtual}.txt`;
  const caminho = path.join(SNAPSHOTS_DIR, nome);
  fs.writeFileSync(caminho, linhas.join('\n'), 'utf8');
  console.log(`📄 Relatório salvo: ${caminho}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`
  Uso: node comparar-snapshots.js <compra_id> [data_anterior] [data_atual]

  Exemplos:
    node comparar-snapshots.js 16030405900012026                      (ontem vs hoje)
    node comparar-snapshots.js 16030405900012026 2026-05-03 2026-05-04
    node comparar-snapshots.js 16030405900012026 --listar              (lista snapshots)
`);
    process.exit(0);
  }

  const compraId = args[0];

  if (args.includes('--listar')) {
    listarSnapshots(compraId);
    return;
  }

  const dataAnterior = args[1] || ontem();
  const dataAtual    = args[2] || hoje();

  console.log(`\nComparando snapshots de ${compraId}:`);
  console.log(`  Anterior: ${dataAnterior}`);
  console.log(`  Atual:    ${dataAtual}\n`);

  try {
    const anterior = carregarSnapshot(compraId, dataAnterior);
    const atual    = carregarSnapshot(compraId, dataAtual);

    const mudancas = compararSnapshots(anterior, atual);
    exibirRelatorio(mudancas, dataAnterior, dataAtual);
    salvarRelatorio(mudancas, compraId, dataAnterior, dataAtual);

  } catch (err) {
    console.error(`❌ Erro: ${err.message}`);
    console.log('\nDica: rode --listar para ver snapshots disponíveis.');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { compararSnapshots, indexarPorItemCnpj, listarSnapshots };
