@echo off
chcp 65001 >nul
title ComprasGov - Instalador
echo ════════════════════════════════════════════════════════════════
echo   Instalador de Dependencias - ComprasGov
echo ════════════════════════════════════════════════════════════════
echo.

echo Verificando se o Node.js esta instalado...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] Node.js nao encontrado!
    echo Por favor, instale o Node.js de: https://nodejs.org/
    echo Baixe a versao "LTS", instale e rode este arquivo novamente.
    pause
    exit /b 1
)

echo Node.js encontrado. Instalando bibliotecas necessarias...
call npm install
echo.
echo Instalando navegadores do Playwright...
call npx playwright install chromium
echo.
echo ════════════════════════════════════════════════════════════════
echo   Tudo pronto! Voce ja pode rodar o "raspar-diario.bat".
echo ════════════════════════════════════════════════════════════════
pause
