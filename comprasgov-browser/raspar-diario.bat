@echo off
chcp 65001 >nul
title ComprasGov - Raspagem Diaria

echo ════════════════════════════════════════════════════════════════
echo   ComprasGov - Raspagem Diaria de Propostas
echo   Data: %DATE% %TIME%
echo ════════════════════════════════════════════════════════════════
echo.

:: --- Configuração ---
set CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
set PROFILE_DIR=%~dp0chrome-debug-profile
set SCRIPT_DIR=%~dp0

:: --- SEMPRE fechar Chrome antes de abrir com CDP ---
echo [1/5] Fechando processos do Chrome...
taskkill /F /IM chrome.exe >nul 2>&1
timeout /t 3 /nobreak >nul
echo   ✓ Processos do Chrome encerrados.

:: --- Abrir Chrome com CDP ---
echo [2/5] Abrindo Chrome com CDP na porta 9222...
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
echo   ACAO NECESSARIA:
echo.
echo   1. No Chrome que abriu, navegue ate a pagina do item 1:
echo      https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/
echo      public/compras/acompanhamento-compra/item/1?compra=SEU_ID
echo.
echo   2. Resolva o CAPTCHA se aparecer
echo   3. Espere a tabela de propostas carregar
echo   4. Volte aqui e pressione ENTER
echo ════════════════════════════════════════════════════════════════
echo.
pause

:: --- Perguntar parâmetros ---
echo.
set /p COMPRA_ID="ID da compra (ex: 16030405900012026): "
set /p TOTAL_ITENS="Total de itens a raspar: "
echo.

:: --- Perguntar se quer expandir marca/modelo ---
set /p EXPANDIR="Expandir cards para marca/modelo? (s/n): "
set FLAGS=
if /i "%EXPANDIR%"=="s" set FLAGS=--expandir

:: --- Rodar raspagem ---
echo.
echo [3/5] Iniciando raspagem...
echo ════════════════════════════════════════════════════════════════
cd /d "%SCRIPT_DIR%"
node raspar-propostas-cdp.js %COMPRA_ID% %TOTAL_ITENS% %FLAGS%

if %errorlevel% neq 0 (
    echo.
    echo ❌ Erro na raspagem. Verifique os logs acima.
    pause
    exit /b 1
)

:: --- Comparar com snapshot anterior ---
echo.
echo [4/5] Verificando snapshots anteriores...
echo ════════════════════════════════════════════════════════════════
node comparar-snapshots.js %COMPRA_ID% --listar

echo.
set /p COMPARAR="Comparar com snapshot anterior? (s/n): "
if /i "%COMPARAR%"=="s" (
    set /p DATA_ANT="Data anterior (YYYY-MM-DD, ou ENTER para ontem): "
    if "!DATA_ANT!"=="" (
        node comparar-snapshots.js %COMPRA_ID%
    ) else (
        node comparar-snapshots.js %COMPRA_ID% !DATA_ANT!
    )
)

:: --- Fim ---
echo.
echo [5/5] Concluido!
echo ════════════════════════════════════════════════════════════════
echo   Arquivos gerados em: %SCRIPT_DIR%dados\
echo.
echo   Para ver snapshots:    node comparar-snapshots.js %COMPRA_ID% --listar
echo   Para comparar datas:   node comparar-snapshots.js %COMPRA_ID% YYYY-MM-DD
echo ════════════════════════════════════════════════════════════════
echo.
pause
