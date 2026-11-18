@echo off
chcp 65001 > nul
title FURPA Online - Taşınabilir Paket Oluşturucu
cd /d "%~dp0"

set "OUT=%~dp0publish\FurpaOnline"

echo =========================================================
echo   FURPA Online - Taşınabilir (Kurulumsuz) Paket Hazırlanıyor
echo =========================================================
echo.

dotnet publish FurpaOnline.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o "%OUT%"
if %ERRORLEVEL% NEQ 0 (
    echo HATA: Paketleme başarısız oldu!
    pause
    exit /b 1
)

if exist "appsettings.Local.json" (
    copy /Y "appsettings.Local.json" "%OUT%\appsettings.Local.json" > nul
)
if exist "regions.json" (
    copy /Y "regions.json" "%OUT%\regions.json" > nul
)

(
echo @echo off
echo chcp 65001 ^> nul
echo title FURPA Online - Canlı Ciro Platformu
echo cd /d "%%~dp0"
echo echo FURPA Online başlatılıyor ^(http://localhost:5088^)...
echo echo Bu pencere açık kaldığı sürece ekran canlı çalışır.
echo start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:5088'"
echo FurpaOnline.exe --urls http://localhost:5088
echo pause
) > "%OUT%\Calistir.bat"

(
echo @echo off
echo chcp 65001 ^> nul
echo title FURPA Online - TV Komuta Merkezi
echo cd /d "%%~dp0"
echo echo FURPA Online TV Komuta Merkezi başlatılıyor ^(http://localhost:5088/#tv^)...
echo start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:5088/#tv'"
echo FurpaOnline.exe --urls http://localhost:5088
echo pause
) > "%OUT%\TV_Komuta_Merkezi.bat"

echo.
echo =========================================================
echo   HAZIR! Kopyalanacak klasör:
echo   %OUT%
echo =========================================================
pause

