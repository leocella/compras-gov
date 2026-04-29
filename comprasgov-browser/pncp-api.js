'use strict';

/**
 * pncp-api.js
 * Acesso à API REST pública do PNCP (Portal Nacional de Contratações Públicas).
 * 100% sem login, sem Playwright — chamadas HTTP simples.
 *
 * Base URLs:
 *   https://pncp.gov.br/api/pncp/v1       ← dados de compra/itens
 *   https://pncp.gov.br/api/consulta/v1   ← busca/listagem
 */

const https = require('https');

const BASE_PNCP    = 'https://pncp.gov.br/api/pncp/v1';
const BASE_CONSULTA = 'https://pncp.gov.br/api/consulta/v1';
const TIMEOUT_MS   = 30_000;

// ---------------------------------------------------------------------------
// Utilidade interna: GET HTTPS com timeout e parsing JSON
// ---------------------------------------------------------------------------
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'comprasgov-browser/1.0 (pncp-api.js)',
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          } catch (e) {
            reject(new Error(`JSON parse error (${res.statusCode}): ${raw.slice(0, 200)}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error(`Timeout após ${TIMEOUT_MS}ms: ${url}`));
    });
  });
}

// ---------------------------------------------------------------------------
// 1. Buscar contratações por CNPJ do órgão e ano (retorna lista com paginação)
//    Necessário para converter (cnpj, ano, numeroCompra) → sequencialCompra
// ---------------------------------------------------------------------------
async function buscarContratacoesPorOrgao(cnpj, ano, pagina = 1, tamanhoPagina = 20) {
  // Endpoint: GET /consulta/v1/contratacoes/publicacao?...
  // Filtramos por codigoModalidadeContratacao=6 (Pregão) e período amplo
  const dataInicial = `${ano}0101`;
  const dataFinal   = `${ano}1231`;
  const url = `${BASE_CONSULTA}/contratacoes/publicacao` +
    `?dataInicial=${dataInicial}` +
    `&dataFinal=${dataFinal}` +
    `&codigoModalidadeContratacao=6` +
    `&cnpj=${cnpj}` +
    `&pagina=${pagina}` +
    `&tamanhoPagina=${tamanhoPagina}`;

  const { body } = await httpGet(url);
  return body; // { totalRegistros, data: [...] }
}

// ---------------------------------------------------------------------------
// 2. Buscar itens de uma compra específica (cnpj + ano + sequencial)
//    GET /pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens
// ---------------------------------------------------------------------------
async function buscarItensPorSequencial(cnpj, ano, sequencial, pagina = 1, tamanhoPagina = 500) {
  const url = `${BASE_PNCP}/orgaos/${cnpj}/compras/${ano}/${sequencial}/itens` +
    `?pagina=${pagina}&tamanhoPagina=${tamanhoPagina}`;

  const { body } = await httpGet(url);
  // Resposta é array direto ou { data: [...], totalRegistros }
  return Array.isArray(body) ? body : (body.data || []);
}

// ---------------------------------------------------------------------------
// 3. Resolver: dado (cnpj, ano, numeroCompra) → sequencialCompra
//    Necessário porque o ComprasGov usa número de pregão (ex: "0054")
//    mas a API PNCP usa sequencial interno.
// ---------------------------------------------------------------------------
async function resolverSequencial(cnpj, ano, numeroCompra) {
  // Busca todas as compras daquele CNPJ no ano e acha a que bate o numeroCompra
  let pagina = 1;
  const tamanhoPagina = 50;

  while (true) {
    const resp = await buscarContratacoesPorOrgao(cnpj, ano, pagina, tamanhoPagina);
    const items = resp.data || [];

    for (const item of items) {
      // numeroCompra geralmente é string zero-padded
      if (String(item.numeroCompra).trim() === String(numeroCompra).trim()) {
        return item.sequencialCompra;
      }
    }

    const totalPaginas = Math.ceil((resp.totalRegistros || 0) / tamanhoPagina);
    if (pagina >= totalPaginas || items.length === 0) break;
    pagina++;
  }

  throw new Error(`Compra não encontrada: CNPJ ${cnpj}, ano ${ano}, número ${numeroCompra}`);
}

// ---------------------------------------------------------------------------
// 4. Função principal: busca todos os itens de um pregão
//    Recebe: { cnpj, ano, sequencial } OU { cnpj, ano, numeroCompra }
//    Retorna: array de itens enriquecidos com extrairMarcas
// ---------------------------------------------------------------------------
const { extrairMarcas } = require('./comprasgov');

async function buscarItensPregaoApi({ cnpj, ano, sequencial, numeroCompra }) {
  // Normalizar cnpj (remover máscara)
  const cnpjLimpo = String(cnpj).replace(/\D/g, '');
  const anoStr    = String(ano);

  let seq = sequencial;

  if (!seq && numeroCompra) {
    seq = await resolverSequencial(cnpjLimpo, anoStr, numeroCompra);
  }

  if (!seq) {
    throw new Error('Informe "sequencial" ou "numeroCompra" para buscar os itens.');
  }

  const itens = await buscarItensPorSequencial(cnpjLimpo, anoStr, String(seq));

  // Enriquecer com extrairMarcas na descricao
  return itens.map((item) => ({
    numeroItem:            item.numeroItem,
    descricao:             item.descricao,
    quantidade:            item.quantidade,
    unidadeMedida:         item.unidadeMedida,
    valorUnitarioEstimado: item.valorUnitarioEstimado,
    valorTotal:            item.valorTotal,
    materialOuServico:     item.materialOuServicoNome,
    situacao:              item.situacaoCompraItemNome,
    criterioJulgamento:    item.criterioJulgamentoNome,
    tipoBeneficio:         item.tipoBeneficioNome,
    ...extrairMarcas(item.descricao),
  }));
}

// ---------------------------------------------------------------------------
// 5. Buscar listagem de contratações recentes (para monitoramento)
//    Retorna pregões publicados num intervalo de datas
// ---------------------------------------------------------------------------
async function listarContratacoesRecentes({ dataInicial, dataFinal, modalidade = 6, pagina = 1, tamanhoPagina = 20 } = {}) {
  const hoje = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

  const di = dataInicial || fmt(new Date(hoje - 7 * 86400e3));
  const df = dataFinal   || fmt(hoje);

  const url = `${BASE_CONSULTA}/contratacoes/publicacao` +
    `?dataInicial=${di}` +
    `&dataFinal=${df}` +
    `&codigoModalidadeContratacao=${modalidade}` +
    `&pagina=${pagina}` +
    `&tamanhoPagina=${tamanhoPagina}`;

  const { body } = await httpGet(url);
  return body; // { totalRegistros, data: [...] }
}

module.exports = {
  buscarItensPregaoApi,
  buscarItensPorSequencial,
  buscarContratacoesPorOrgao,
  listarContratacoesRecentes,
  resolverSequencial,
};
