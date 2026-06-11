@echo off
:: ============================================================
:: Heidi Bridge — Windows launcher
:: Run this on your Windows machine (C:\ProtoForge_Ecosystem\)
:: ============================================================

title Heidi Bridge

:: Default port — change here or set BRIDGE_PORT env var
set BRIDGE_PORT=5050

:: Point at your ursula_server.py
set URSULA_URL=http://localhost:5000

:: Point at your protohub
set PROTOHUB_URL=http://localhost:4000

:: Root of C:\ProtoForge_Ecosystem
set PROTOFORGE_DIR=%~dp0

echo.
echo  Starting Heidi Bridge on port %BRIDGE_PORT%
echo  ProtoForge dir: %PROTOFORGE_DIR%
echo.

:: Install deps if not already done
pip show flask >nul 2>&1 || pip install flask requests

python "%~dp0heidi-bridge.py"

pause
