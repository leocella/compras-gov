@echo off
chcp 65001 >nul
title ComprasGov - Raspagem Diaria

echo ═══════════════════════════════════════════════════════════════
echo   ComprasGov - Raspagem Diaria de Propostas
echo   Data: %DATE% %TIME%
echo ═══════════════════════════════════════════════════════════════
echo.

:: --- Configuração ---
set CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
set PROFILE_DIR=%~dp0chrome-debug-profile
set SCRIPT_DIR=%~dp0

:: --- Verificar se Chrome já está com CDP ativo ---
echo [1/4] Verificando Chrome CDP...
curl -s http://127.0.0.1:9222/json >nul 2>&1
if %errorlevel% equ 0 (
    echo   ✓ Chrome CDP já está ativo!
    goto :CHROME_OK
)

:: --- Fechar Chrome existente e abrir com CDP ---
echo   Chrome CDP não está ativo. Abrindo...
taskkill /F /IM chrome.exe >nul 2>&1
timeout /t 3 /nobreak >nul

start "" %CHROME_PATH% --remote-debugging-port=9222 --user-data-dir="%PROFILE_DIR%"
echo   ✓ Chrome aberto com CDP na porta 9222.
echo.

:CHROME_OK
echo ═══════════════════════════════════════════════════════════════
echo   AÇÃO NECESSÁRIA:
echo.
echo   1. No Chrome que abriu, navegue até a pagina do item 1:
echo      https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/
echo      public/compras/acompanhamento-compra/item/1?compra=SEU_ID
echo.
echo   2. Resolva o CAPTCHA se aparecer
echo   3. Espere a tabela de propostas carregar
echo   4. Volte aqui e pressione ENTER
echo ═══════════════════════════════════════════════════════════════
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
echo [2/4] Iniciando raspagem...
echo ═══════════════════════════════════════════════════════════════
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
echo [3/4] Verificando snapshots anteriores...
echo ═══════════════════════════════════════════════════════════════
node comparar-snapshots.js %COMPRA_ID% --listar

echo.
set /p COMPARAR="Comparar com snapshot anterior? (s/n): "
if /i "%COMPARAR%"=="s" (
    set /p DATA_ANT="Data anterior (YYYY-MM-DD, ou ENTER para ontem): "
    if "%DATA_ANT%"=="" (
        node comparar-snapshots.js %COMPRA_ID%
    ) else (
        node comparar-snapshots.js %COMPRA_ID% %DATA_ANT%
    )
)

:: --- Fim ---
echo.
echo [4/4] Concluído!
echo ═══════════════════════════════════════════════════════════════
echo   Arquivos gerados em: %SCRIPT_DIR%dados\
echo.
echo   Para ver snapshots:    node comparar-snapshots.js %COMPRA_ID% --listar
echo   Para comparar datas:   node comparar-snapshots.js %COMPRA_ID% YYYY-MM-DD
echo ═══════════════════════════════════════════════════════════════
echo.
pause
