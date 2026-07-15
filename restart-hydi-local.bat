@echo off
title HYDI - Verify + Restart (local)
cd /d "%~dp0"

echo ================================================
echo   HYDI - verify code, restart stack, seed facts
echo ================================================
echo.

echo [1/4] Syntax check...
node --check heidi-core\server.js || goto :fail
node --check heidi-core\brain\ollama-client.js || goto :fail
node --check heidi-core\memory\sqlite-store.js || goto :fail
node --check launch-heidi-mobile.js || goto :fail
node --check heidi-core\seed-local-facts.js || goto :fail
echo        All files OK.

echo [2/4] Stopping old HYDI servers (ports 3456, 3006)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3456" ^| findstr "LISTENING"') do taskkill /f /pid %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3006" ^| findstr "LISTENING"') do taskkill /f /pid %%a >nul 2>&1
timeout /t 2 /nobreak >nul

echo [3/4] Seeding verified HYDI facts into memory...
node heidi-core\seed-local-facts.js

echo [4/4] Starting the stack...
start "" "%~dp0start-hydi-local.bat"

echo.
echo Done. Heidi Core: http://localhost:3456/health  ^|  Panel: http://localhost:3006
pause
goto :eof

:fail
echo.
echo *** SYNTAX CHECK FAILED — stack NOT restarted. ***
pause
