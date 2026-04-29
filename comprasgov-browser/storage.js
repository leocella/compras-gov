'use strict';

/**
 * storage.js
 * Persiste resultados de raspagem em disco:
 *   dados/{cnpj}_{ano}_{seq}_{timestamp}.json  ← snapshot completo
 *   dados/itens.csv                             ← CSV acumulado (append)
 *
 * Pasta criada automaticamente na primeira gravação.
 */

const fs   = require('fs');
const path = require('path');

const DADOS_DIR = path.join(__dirname, 'dados');

// ---------------------------------------------------------------------------
// Garantir que a pasta dados/ existe
// ---------------------------------------------------------------------------
function ensureDir() {
  if (!fs.existsSync(DADOS_DIR)) {
    fs.mkdirSync(DADOS_DIR, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Escapar campo CSV (RFC 4180)
// ---------------------------------------------------------------------------
function csvField(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ---------------------------------------------------------------------------
// Cabeçalho do CSV
// ---------------------------------------------------------------------------
const CSV_HEADER = [
  'cnpj',
  'ano',
  'sequencial',
  'numeroCompra',
  'raspadoEm',
  'numeroItem',
  'descricao',
  'quantidade',
  'unidadeMedida',
  'valorUnitarioEstimado',
  'valorTotal',
  'materialOuServico',
  'situacao',
  'criterioJulgamento',
  'tipoBeneficio',
  'marcaObrigatoria',
  'marcaPreferencia',
].join(',');

// ---------------------------------------------------------------------------
// Salvar uma raspagem
// Parâmetros:
//   meta   : { cnpj, ano, sequencial, numeroCompra }
//   itens  : array de itens (já enriquecidos com extrairMarcas)
// ---------------------------------------------------------------------------
function salvar(meta, itens) {
  ensureDir();

  const ts          = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const seq         = meta.sequencial || 'x';
  const baseName    = `${meta.cnpj}_${meta.ano}_${seq}_${ts}`;
  const raspadoEm   = new Date().toISOString();

  // --- 1. JSON completo ---
  const jsonPath = path.join(DADOS_DIR, baseName + '.json');
  const jsonPayload = {
    meta: { ...meta, raspadoEm },
    totalItens: itens.length,
    itens,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(jsonPayload, null, 2), 'utf8');

  // --- 2. CSV acumulado ---
  const csvPath   = path.join(DADOS_DIR, 'itens.csv');
  const csvExists = fs.existsSync(csvPath);

  const linhas = itens.map((item) => [
    meta.cnpj,
    meta.ano,
    seq,
    meta.numeroCompra || '',
    raspadoEm,
    item.numeroItem,
    item.descricao,
    item.quantidade,
    item.unidadeMedida,
    item.valorUnitarioEstimado,
    item.valorTotal,
    item.materialOuServico,
    item.situacao,
    item.criterioJulgamento,
    item.tipoBeneficio,
    item.marcaObrigatoria || '',
    item.marcaPreferencia || '',
  ].map(csvField).join(','));

  const csvContent = (csvExists ? '' : CSV_HEADER + '\n') + linhas.join('\n') + '\n';
  fs.appendFileSync(csvPath, csvContent, 'utf8');

  return {
    json: jsonPath,
    csv:  csvPath,
    totalItens: itens.length,
  };
}

// ---------------------------------------------------------------------------
// Listar raspagens salvas (metadados)
// ---------------------------------------------------------------------------
function listarRaspagens() {
  ensureDir();
  return fs.readdirSync(DADOS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const raw  = fs.readFileSync(path.join(DADOS_DIR, f), 'utf8');
        const data = JSON.parse(raw);
        return {
          arquivo:    f,
          cnpj:       data.meta?.cnpj,
          ano:        data.meta?.ano,
          sequencial: data.meta?.sequencial,
          raspadoEm:  data.meta?.raspadoEm,
          totalItens: data.totalItens,
        };
      } catch {
        return { arquivo: f, erro: 'parse error' };
      }
    })
    .sort((a, b) => (b.raspadoEm || '').localeCompare(a.raspadoEm || ''));
}

module.exports = { salvar, listarRaspagens, DADOS_DIR };
