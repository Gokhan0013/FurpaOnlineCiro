@echo off
chcp 65001 > nul
title FURPA Online - Canlı Ciro Platformu
echo ===================================================
echo   FURPA Online - Canlı Ciro Platformu Başlatılıyor
echo ===================================================
echo.
cd /d "%~dp0"
echo Tarayıcıda açılacak adres: http://localhost:5088
echo.
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:5088'"
dotnet run --no-build -c Release --urls http://localhost:5088
if %ERRORLEVEL% NEQ 0 (
    echo Derleniyor ve başlatılıyor...
    dotnet run -c Release --urls http://localhost:5088
)
pause

