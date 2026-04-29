'use strict';

/**
 * dadosabertos-api.js
 * Acesso à API pública do dadosabertos.compras.gov.br (ComprasNet/SIASG legado).
 * Sem login — endpoints públicos com JWT opcional (não obrigatório na maioria).
 *
 * Base: https://dadosabertos.compras.gov.br
 * Spec: GET /v3/api-docs
 *
 * Cobertura:
 *   modulo-legado    → pregões e itens de pregão (legado SIASG)
 *   modulo-contratos → contratos e itens de contrato
 *   modulo-uasg      → info de UASG / órgãos
 *   modulo-pesquisa-preco → preços praticados por item de catálogo
 *   modulo-contratacoes  → contratações PNCP (14.133/2021)
 */

const https = require('https');

const BASE = 'https://dadosabertos.compras.gov.br';
const TIMEOUT_MS = 40_000; // servidor gov pode ser lento

// ---------------------------------------------------------------------------
// Utilidade interna: GET com timeout, retorna JSON
// ---------------------------------------------------------------------------
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'comprasgov-browser/1.0 (dadosabertos-api.js)',
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(raw)); }
          catch (e) { reject(new Error(`JSON parse error ${res.statusCode}: ${raw.slice(0, 200)}`)); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); reject(new Error(`Timeout ${TIMEOUT_MS}ms: ${url.slice(0, 100)}`)); });
  });
}

// ---------------------------------------------------------------------------
// Montar query string a partir de objeto (ignora undefined/null/vazio)
// ---------------------------------------------------------------------------
function qs(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

// ---------------------------------------------------------------------------
// Defaults de paginação
// ---------------------------------------------------------------------------
const DEF_PAG  = 1;
const DEF_TAM  = 20;   // mínimo aceito pelo servidor é 10
const MIN_TAM  = 10;

function tamPag(v) { return Math.max(MIN_TAM, Number(v) || DEF_TAM); }
function pag(v)    { return Number(v) || DEF_PAG; }

// ===========================================================================
// 1. MÓDULO LEGADO — Pregões
// ===========================================================================

/**
 * Listar pregões por UASG e intervalo de data do edital.
 * Params obrigatórios: dt_data_edital_inicial, dt_data_edital_final (YYYY-MM-DD)
 */
async function listarPregoes({
  co_uasg, co_orgao, numero, ds_tipo_pregao_compra,
  dt_data_edital_inicial, dt_data_edital_final,
  pertence14133, pagina, tamanhoPagina,
} = {}) {
  if (!dt_data_edital_inicial || !dt_data_edital_final) {
    throw new Error('dt_data_edital_inicial e dt_data_edital_final são obrigatórios (YYYY-MM-DD)');
  }
  const url = `${BASE}/modulo-legado/3_consultarPregoes?${qs({
    co_uasg, co_orgao, numero, ds_tipo_pregao_compra,
    dt_data_edital_inicial, dt_data_edital_final,
    pertence14133,
    pagina: pag(pagina),
    tamanhoPagina: tamPag(tamanhoPagina),
  })}`;
  return httpGet(url);
}

/**
 * Buscar pregão específico por id_compra (ID interno SIASG).
 */
async function buscarPregaoPorId({ id_compra, dt_alteracao } = {}) {
  if (!id_compra) throw new Error('id_compra é obrigatório');
  const url = `${BASE}/modulo-legado/3.1_consultarPregoes_Id?${qs({ id_compra, dt_alteracao })}`;
  return httpGet(url);
}

// ===========================================================================
// 2. MÓDULO LEGADO — Itens de Pregão (com vencedor / resultado)
// ===========================================================================

/**
 * Listar itens de pregão por UASG e intervalo de homologação.
 * Params obrigatórios: dt_hom_inicial, dt_hom_final (YYYY-MM-DD)
 * Opcional: fornecedor_vencedor (CNPJ/CPF), decreto_7174 (S/N)
 */
async function listarItensPregao({
  co_uasg, decreto_7174, fornecedor_vencedor,
  dt_hom_inicial, dt_hom_final,
  pagina, tamanhoPagina,
} = {}) {
  if (!dt_hom_inicial || !dt_hom_final) {
    throw new Error('dt_hom_inicial e dt_hom_final são obrigatórios (YYYY-MM-DD)');
  }
  const url = `${BASE}/modulo-legado/4_consultarItensPregoes?${qs({
    co_uasg, decreto_7174, fornecedor_vencedor,
    dt_hom_inicial, dt_hom_final,
    pagina: pag(pagina),
    tamanhoPagina: tamPag(tamanhoPagina),
  })}`;
  return httpGet(url);
}

/**
 * Buscar item específico de pregão por id_compra.
 */
async function buscarItemPregaoPorId({ id_compra, id_compra_item, dt_alteracao } = {}) {
  if (!id_compra) throw new Error('id_compra é obrigatório');
  const url = `${BASE}/modulo-legado/4.1_consultarItensPregoes_Id?${qs({ id_compra, id_compra_item, dt_alteracao })}`;
  return httpGet(url);
}

// ===========================================================================
// 3. MÓDULO CONTRATOS
// ===========================================================================

/**
 * Listar contratos por UASG e vigência.
 * Params obrigatórios: dataVigenciaInicialMin, dataVigenciaInicialMax (YYYY-MM-DD)
 */
async function listarContratos({
  codigoOrgao, codigoUnidadeGestora, codigoUnidadeRealizadoraCompra,
  numeroContrato, codigoModalidadeCompra, codigoTipo, codigoCategoria,
  niFornecedor, dataVigenciaInicialMin, dataVigenciaInicialMax,
  pagina, tamanhoPagina,
} = {}) {
  if (!dataVigenciaInicialMin || !dataVigenciaInicialMax) {
    throw new Error('dataVigenciaInicialMin e dataVigenciaInicialMax são obrigatórios (YYYY-MM-DD)');
  }
  const url = `${BASE}/modulo-contratos/1_consultarContratos?${qs({
    codigoOrgao, codigoUnidadeGestora, codigoUnidadeRealizadoraCompra,
    numeroContrato, codigoModalidadeCompra, codigoTipo, codigoCategoria,
    niFornecedor, dataVigenciaInicialMin, dataVigenciaInicialMax,
    pagina: pag(pagina),
    tamanhoPagina: tamPag(tamanhoPagina),
  })}`;
  return httpGet(url);
}

/**
 * Buscar contrato por código.
 */
async function buscarContratoPorId({ codigo, tipo } = {}) {
  if (!codigo || !tipo) throw new Error('codigo e tipo são obrigatórios');
  const url = `${BASE}/modulo-contratos/1.1_consultarContratos_Id?${qs({ codigo, tipo })}`;
  return httpGet(url);
}

/**
 * Listar itens de contratos.
 */
async function listarItensContratos({
  codigoOrgao, codigoUnidadeGestora, numeroContrato,
  codigoModalidadeCompra, tipoItem, codigoItem, niFornecedor,
  dataVigenciaInicialMin, dataVigenciaInicialMax,
  pagina, tamanhoPagina,
} = {}) {
  if (!dataVigenciaInicialMin || !dataVigenciaInicialMax) {
    throw new Error('dataVigenciaInicialMin e dataVigenciaInicialMax são obrigatórios (YYYY-MM-DD)');
  }
  const url = `${BASE}/modulo-contratos/2_consultarContratosItem?${qs({
    codigoOrgao, codigoUnidadeGestora, numeroContrato,
    codigoModalidadeCompra, tipoItem, codigoItem, niFornecedor,
    dataVigenciaInicialMin, dataVigenciaInicialMax,
    pagina: pag(pagina),
    tamanhoPagina: tamPag(tamanhoPagina),
  })}`;
  return httpGet(url);
}

// ===========================================================================
// 4. MÓDULO UASG
// ===========================================================================

/**
 * Listar UASGs.
 * Param obrigatório: statusUasg (ex: "Ativa")
 */
async function listarUasg({
  codigoUasg, usoSisg, cnpjCpfOrgao, siglaUf, statusUasg = 'Ativa', pagina,
} = {}) {
  const url = `${BASE}/modulo-uasg/1_consultarUasg?${qs({
    codigoUasg, usoSisg, cnpjCpfOrgao, siglaUf, statusUasg,
    pagina: pag(pagina),
  })}`;
  return httpGet(url);
}

/**
 * Listar órgãos.
 * Param obrigatório: statusOrgao (ex: "Ativo")
 */
async function listarOrgaos({
  cnpjCpfOrgao, codigoOrgao, statusOrgao = 'Ativo', usoSisg, pagina,
} = {}) {
  const url = `${BASE}/modulo-uasg/2_consultarOrgao?${qs({
    cnpjCpfOrgao, codigoOrgao, statusOrgao, usoSisg,
    pagina: pag(pagina),
  })}`;
  return httpGet(url);
}

// ===========================================================================
// 5. MÓDULO PESQUISA DE PREÇOS
// ===========================================================================

/**
 * Pesquisa de preços de material por código de item de catálogo.
 * Param obrigatório: codigoItemCatalogo (código CATMAT)
 */
async function pesquisarPrecoMaterial({
  codigoItemCatalogo, codigoUasg, estado, codigoMunicipio,
  dataResultado, codigoClasse, poder, esfera,
  dataCompraInicio, dataCompraFim,
  pagina, tamanhoPagina,
} = {}) {
  if (!codigoItemCatalogo) throw new Error('codigoItemCatalogo é obrigatório (código CATMAT)');
  const url = `${BASE}/modulo-pesquisa-preco/1_consultarMaterial?${qs({
    codigoItemCatalogo, codigoUasg, estado, codigoMunicipio,
    dataResultado, codigoClasse, poder, esfera,
    dataCompraInicio, dataCompraFim,
    pagina: pag(pagina),
    tamanhoPagina: tamPag(tamanhoPagina),
  })}`;
  return httpGet(url);
}

/**
 * Pesquisa de preços de material — detalhe (histórico de compras do item).
 */
async function pesquisarPrecoMaterialDetalhe({
  codigoItemCatalogo, dataCompraInicio, dataCompraFim,
  pagina, tamanhoPagina,
} = {}) {
  if (!codigoItemCatalogo) throw new Error('codigoItemCatalogo é obrigatório');
  const url = `${BASE}/modulo-pesquisa-preco/2_consultarMaterialDetalhe?${qs({
    codigoItemCatalogo, dataCompraInicio, dataCompraFim,
    pagina: pag(pagina),
    tamanhoPagina: tamPag(tamanhoPagina),
  })}`;
  return httpGet(url);
}

// ===========================================================================
// 6. MÓDULO CONTRATAÇÕES PNCP (14.133/2021)
// ===========================================================================

/**
 * Listar contratações PNCP (complementar ao pncp.gov.br/api/consulta).
 * Params obrigatórios: dataPublicacaoPncpInicial, dataPublicacaoPncpFinal (YYYY-MM-DD), codigoModalidade
 */
async function listarContratacoesPNCP({
  orgaoEntidadeCnpj, codigoOrgao, unidadeOrgaoCodigoUnidade,
  dataPublicacaoPncpInicial, dataPublicacaoPncpFinal,
  codigoModalidade = 6,
  pagina, tamanhoPagina,
} = {}) {
  if (!dataPublicacaoPncpInicial || !dataPublicacaoPncpFinal) {
    throw new Error('dataPublicacaoPncpInicial e dataPublicacaoPncpFinal são obrigatórios (YYYY-MM-DD)');
  }
  const url = `${BASE}/modulo-contratacoes/1_consultarContratacoes_PNCP_14133?${qs({
    orgaoEntidadeCnpj, codigoOrgao, unidadeOrgaoCodigoUnidade,
    dataPublicacaoPncpInicial, dataPublicacaoPncpFinal,
    codigoModalidade,
    pagina: pag(pagina),
    tamanhoPagina: tamPag(tamanhoPagina),
  })}`;
  return httpGet(url);
}

/**
 * Listar itens de contratações PNCP com resultado/vencedor.
 * Params obrigatórios: dataInclusaoPncpInicial, dataInclusaoPncpFinal (YYYY-MM-DD)
 */
async function listarItensContratacoesPNCP({
  orgaoEntidadeCnpj, unidadeOrgaoCodigoUnidade,
  situacaoCompraItem, materialOuServico, codigoClasse, codigoGrupo,
  codItemCatalogo, temResultado, codFornecedor,
  dataInclusaoPncpInicial, dataInclusaoPncpFinal,
  pagina, tamanhoPagina,
} = {}) {
  if (!dataInclusaoPncpInicial || !dataInclusaoPncpFinal) {
    throw new Error('dataInclusaoPncpInicial e dataInclusaoPncpFinal são obrigatórios (YYYY-MM-DD)');
  }
  const url = `${BASE}/modulo-contratacoes/2_consultarItensContratacoes_PNCP_14133?${qs({
    orgaoEntidadeCnpj, unidadeOrgaoCodigoUnidade,
    situacaoCompraItem, materialOuServico, codigoClasse, codigoGrupo,
    codItemCatalogo, temResultado, codFornecedor,
    dataInclusaoPncpInicial, dataInclusaoPncpFinal,
    pagina: pag(pagina),
    tamanhoPagina: tamPag(tamanhoPagina),
  })}`;
  return httpGet(url);
}

module.exports = {
  // Legado — Pregões
  listarPregoes,
  buscarPregaoPorId,
  // Legado — Itens de Pregão (com vencedor)
  listarItensPregao,
  buscarItemPregaoPorId,
  // Contratos
  listarContratos,
  buscarContratoPorId,
  listarItensContratos,
  // UASG
  listarUasg,
  listarOrgaos,
  // Pesquisa de Preços
  pesquisarPrecoMaterial,
  pesquisarPrecoMaterialDetalhe,
  // Contratações PNCP
  listarContratacoesPNCP,
  listarItensContratacoesPNCP,
};
