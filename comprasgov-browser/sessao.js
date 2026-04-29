'use strict';

/**
 * sessao.js
 * Gerencia sessão autenticada no ComprasNet legado (comprasnet.gov.br).
 * Login é SEMPRE manual — o Rafael faz o login na janela aberta pelo Playwright.
 * Após o login, salvamos storageState em sessions/session.json para reutilizar.
 */

const path = require('path');
const fs   = require('fs');

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------
const LOGIN_URL  = 'https://www.comprasnet.gov.br/seguro/loginPortal.asp';
const SESSION_FILE = path.join(__dirname, 'sessions', 'session.json');

/** URL ou fragmento que aparece SOMENTE após login bem-sucedido */
const POS_LOGIN_MARKER = 'acesso.asp';

/** Timeout máximo esperando o usuário logar (5 minutos) */
const AGUARDAR_TIMEOUT_MS = 5 * 60 * 1_000;
/** Intervalo de polling para checar se login aconteceu */
const POLL_INTERVAL_MS   = 2_000;

// ---------------------------------------------------------------------------
// Utilitários de arquivo de sessão
// ---------------------------------------------------------------------------
function sessionExists() {
  return fs.existsSync(SESSION_FILE);
}

function ensureSessionDir() {
  const dir = path.dirname(SESSION_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function apagarSessao() {
  if (sessionExists()) fs.unlinkSync(SESSION_FILE);
}

// ---------------------------------------------------------------------------
// Abrir login: navega o page (já existente) para a tela de login
// ---------------------------------------------------------------------------
async function abrirLogin(page) {
  console.log('[sessao] Navegando para tela de login:', LOGIN_URL);
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  return { aguardando: true, loginUrl: LOGIN_URL };
}

// ---------------------------------------------------------------------------
// Checar se o login foi concluído (polling externo, chamado pelo endpoint)
// Retorna: true se logado, false se ainda na tela de login / desconhecido
// ---------------------------------------------------------------------------
async function verificarLoginConcluido(page) {
  try {
    const url = page.url();
    return url.includes(POS_LOGIN_MARKER) || !url.includes('login');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Salvar sessão atual em disco
// ---------------------------------------------------------------------------
async function salvarSessao(context) {
  ensureSessionDir();
  await context.storageState({ path: SESSION_FILE });
  console.log('[sessao] Sessão salva em:', SESSION_FILE);
  return SESSION_FILE;
}

// ---------------------------------------------------------------------------
// Carregar storageState salvo ao criar um novo contexto de browser
// Retorna as opções de contexto (para passar ao browser.newContext)
// ---------------------------------------------------------------------------
function opcoesContextoComSessao() {
  if (sessionExists()) {
    console.log('[sessao] Carregando sessão salva:', SESSION_FILE);
    return { storageState: SESSION_FILE, viewport: null };
  }
  console.log('[sessao] Sem sessão salva — contexto limpo.');
  return { viewport: null };
}

// ---------------------------------------------------------------------------
// Detectar se a sessão atual ainda é válida (página protegida acessível)
// Navega para uma URL que só existe quando logado e verifica
// ---------------------------------------------------------------------------
async function detectarSessaoAtiva(page) {
  try {
    const url = page.url();
    // Se já estamos em área logada, sessão ativa
    if (url.includes('acesso.asp') || url.includes('comprasnet.gov.br/livre')) {
      return true;
    }
    // Tentar navegar para área protegida
    await page.goto('https://www.comprasnet.gov.br/acesso.asp', {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });
    const urlFinal = page.url();
    // Se redirecionou para login, sessão expirou
    if (urlFinal.includes('login')) return false;
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  abrirLogin,
  verificarLoginConcluido,
  salvarSessao,
  opcoesContextoComSessao,
  detectarSessaoAtiva,
  apagarSessao,
  sessionExists,
  SESSION_FILE,
  LOGIN_URL,
};
