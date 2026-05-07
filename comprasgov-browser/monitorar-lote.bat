@echo off
chcp 65001 >nul
title ComprasGov - Raspagem em Lote

echo ════════════════════════════════════════════════════════════════
echo   ComprasGov - Monitoramento em Lote de Varias Compras
echo   Data: %DATE% %TIME%
echo ════════════════════════════════════════════════════════════════
echo.

:: --- Configuração ---
set CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
set PROFILE_DIR=%~dp0chrome-debug-profile
set SCRIPT_DIR=%~dp0

:: --- SEMPRE fechar Chrome antes de abrir com CDP ---
echo [1/4] Fechando processos do Chrome...
taskkill /F /IM chrome.exe >nul 2>&1
timeout /t 3 /nobreak >nul
echo   ✓ Processos do Chrome encerrados.

:: --- Abrir Chrome com CDP ---
echo [2/4] Abrindo Chrome com CDP na porta 9222...
start "" %CHROME_PATH% --remote-debugging-port=9222 --user-data-dir="%PROFILE_DIR%"
timeout /t 3 /nobreak >nul

:: Verificar se CDP está ativo
curl -s http://127.0.0.1:9222/json >nul 2>&1
if %errorlevel% neq 0 (
    echo   ⚠ CDP ainda nao respondeu. Aguardando mais 5 segundos...
    timeout /t 5 /nobreak >nul
)
echo   ✓ Chrome CDP ativo!
echo.

echo ════════════════════════════════════════════════════════════════
echo   ACAO NECESSARIA ANTES DE CONTINUAR:
echo.
echo   1. No Chrome que abriu, acesse qualquer licitacao logado no 
echo      ComprasGov (ex: item 1 de qualquer pregao)
echo   2. Resolva o CAPTCHA se aparecer
echo   3. Quando a tabela de propostas estiver visivel, volte aqui.
echo ════════════════════════════════════════════════════════════════
echo.
pause

:: --- Rodar raspagem em lote ---
echo.
echo [3/4] Iniciando raspagem em lote...
echo       Lendo "compras-alvo.json"...
echo ════════════════════════════════════════════════════════════════
cd /d "%SCRIPT_DIR%"
node raspar-lote.js

if %errorlevel% neq 0 (
    echo.
    echo ❌ Erro na raspagem em lote. Verifique os logs acima.
    pause
    exit /b 1
)

:: --- Fim ---
echo.
echo [4/4] Concluido!
echo ════════════════════════════════════════════════════════════════
echo   Arquivos Excel gerados em: %SCRIPT_DIR%dados\
echo ════════════════════════════════════════════════════════════════
echo.
pause
