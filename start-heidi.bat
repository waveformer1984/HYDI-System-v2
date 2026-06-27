@echo off
title HEIDI Server
cd /d "%~dp0"
echo ============================================
echo   Starting HEIDI server...
echo   Desktop/Phone UI: http://localhost:3006
echo ============================================
echo.
node launch-heidi-mobile.js > "%~dp0heidi-server.log" 2>&1
echo.
echo HEIDI server stopped. Press any key to close.
pause >nul
