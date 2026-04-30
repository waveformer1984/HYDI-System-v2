@echo off
cd /d "%~dp0"
echo [HEIDI] Starting up...

REM Check if Ollama is running
curl -s http://localhost:11434/api/tags >nul 2>&1
if errorlevel 1 (
    echo [HEIDI] Starting Ollama server...
    start /B ollama serve
    timeout /t 3 /nobreak >nul
    echo [HEIDI] Ollama should be ready
) else (
    echo [HEIDI] Ollama already running
)

REM Start HEIDI
echo [HEIDI] Starting server...
set NODE_PATH=..\node_modules
node server.js
