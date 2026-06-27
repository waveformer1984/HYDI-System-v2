@echo off
REM Auto-start local AI + HEIDI server at login (minimized; logs to heidi-server.log)
REM 1) Ensure Ollama's API server is running (harmless if it's already up)
start "" /min cmd /c "ollama serve"
REM 2) Give Ollama a few seconds to bind port 11434
timeout /t 4 >nul
REM 3) Launch HEIDI
cd /d "C:\Users\Owner\HYDI-System-v2"
start "HEIDI Server" /min cmd /c "node launch-heidi-mobile.js > heidi-server.log 2>&1"
