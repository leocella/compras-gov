'use strict';

/**
 * lote-estado.js
 * Persistência do estado de um lote de raspagem em andamento.
 * Permite pausar quando a sessão expira e retomar via /retomar no Telegram.
 *
 * Arquivo único: dados/lote-estado.json (último lote sobrescreve).
 *
 * Schema:
 *   {
 *     "iniciado_em": "ISO datetime",
 *     "compras_pendentes": ["compraId1", ...],
 *     "compras_concluidas": ["..."],
 *     "compras_falhas":    [{ compraId, motivo, tentativas }],
 *     "status":            "rodando" | "pausado_sessao_expirada" | "concluido"
 *   }
 */

const fs   = require('fs');
const path = require('path');

const DADOS_DIR   = path.join(__dirname, 'dados');
const ESTADO_PATH = path.join(DADOS_DIR, 'lote-estado.json');

const STATUS = Object.freeze({
  RODANDO:           'rodando',
  PAUSADO:           'pausado_sessao_expirada',
  CONCLUIDO:         'concluido',
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function _ensureDir() {
  if (!fs.existsSync(DADOS_DIR)) fs.mkdirSync(DADOS_DIR, { recursive: true });
}

function _writeAtomic(obj) {
  _ensureDir();
  const conteudo = JSON.stringify(obj, null, 2);
  const tmp = ESTADO_PATH + '.tmp';
  fs.writeFileSync(tmp, conteudo, 'utf8');
  try {
    fs.renameSync(tmp, ESTADO_PATH);
  } catch (e) {
    // OneDrive/antivírus pode bloquear rename — fallback para write direto
    try { fs.unlinkSync(tmp); } catch { /* ignora */ }
    fs.writeFileSync(ESTADO_PATH, conteudo, 'utf8');
  }
}

function _ler() {
  if (!fs.existsSync(ESTADO_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(ESTADO_PATH, 'utf8'));
  } catch (err) {
    // arquivo corrompido — devolve null e quem chamou decide reiniciar
    console.error('[lote-estado] JSON corrompido:', err.message);
    return null;
  }
}

// ─── API pública ────────────────────────────────────────────────────────────

/** Cria/sobrescreve o estado com a lista de compras a processar. */
function iniciarLote(compraIds) {
  if (!Array.isArray(compraIds)) throw new Error('iniciarLote: compraIds deve ser array');
  const estado = {
    iniciado_em:       new Date().toISOString(),
    compras_pendentes: compraIds.map(String),
    compras_concluidas: [],
    compras_falhas:    [],
    status:            STATUS.RODANDO,
  };
  _writeAtomic(estado);
  return estado;
}

/** Move uma compra de pendentes para concluídas. Idempotente. */
function marcarConcluida(compraId) {
  const e = _ler();
  if (!e) return null;
  const id = String(compraId);
  e.compras_pendentes = e.compras_pendentes.filter(c => c !== id);
  if (!e.compras_concluidas.includes(id)) e.compras_concluidas.push(id);
  // também remove de falhas (caso seja retry bem-sucedido)
  e.compras_falhas = e.compras_falhas.filter(f => f.compraId !== id);
  _writeAtomic(e);
  return e;
}

/**
 * Registra falha. Se já houver uma falha para o mesmo compraId, incrementa
 * tentativas; senão, cria nova entrada. Compra permanece em pendentes
 * (pode ser retentada manualmente).
 */
function marcarFalha(compraId, motivo) {
  const e = _ler();
  if (!e) return null;
  const id = String(compraId);
  const existente = e.compras_falhas.find(f => f.compraId === id);
  if (existente) {
    existente.tentativas = (existente.tentativas || 1) + 1;
    existente.motivo     = motivo;
  } else {
    e.compras_falhas.push({ compraId: id, motivo, tentativas: 1 });
  }
  _writeAtomic(e);
  return e;
}

/** Marca o lote como pausado (sessão expirada). Não altera pendentes/concluídas. */
function marcarPausa(motivo) {
  const e = _ler();
  if (!e) return null;
  e.status         = STATUS.PAUSADO;
  e.pausado_em     = new Date().toISOString();
  e.motivo_pausa   = motivo || 'sessão expirada';
  _writeAtomic(e);
  return e;
}

/** Marca o lote como rodando (usado em retomada). Preserva pendentes/concluídas/falhas. */
function marcarRodando() {
  const e = _ler();
  if (!e) return null;
  e.status = STATUS.RODANDO;
  delete e.pausado_em;
  delete e.motivo_pausa;
  _writeAtomic(e);
  return e;
}

/** Marca como concluído (fim normal do lote). */
function marcarConcluido() {
  const e = _ler();
  if (!e) return null;
  e.status        = STATUS.CONCLUIDO;
  e.concluido_em  = new Date().toISOString();
  _writeAtomic(e);
  return e;
}

/** Lê e retorna o estado atual (ou null se não houver lote). */
function obterEstado() {
  return _ler();
}

/** Apaga o arquivo de estado (reset completo). */
function limpar() {
  if (fs.existsSync(ESTADO_PATH)) fs.unlinkSync(ESTADO_PATH);
}

module.exports = {
  STATUS,
  ESTADO_PATH,
  iniciarLote,
  marcarConcluida,
  marcarFalha,
  marcarPausa,
  marcarRodando,
  marcarConcluido,
  obterEstado,
  limpar,
};
