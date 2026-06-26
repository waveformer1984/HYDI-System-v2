@echo off
cd /d "%~dp0"
echo === Ollama direct probe (127.0.0.1:11434) === > ai-check.log
curl -sS -m 6 http://127.0.0.1:11434/api/tags >> ai-check.log 2>&1
echo. >> ai-check.log
echo === ollama processes === >> ai-check.log
tasklist /FI "IMAGENAME eq ollama.exe" 2>nul | findstr /i ollama >> ai-check.log
tasklist /FI "IMAGENAME eq ollama app.exe" 2>nul | findstr /i ollama >> ai-check.log
echo. >> ai-check.log
echo === HEIDI server health (127.0.0.1:3006) === >> ai-check.log
curl -sS -m 8 http://127.0.0.1:3006/api/health >> ai-check.log 2>&1
echo. >> ai-check.log
echo === node processes === >> ai-check.log
tasklist /FI "IMAGENAME eq node.exe" 2>nul | findstr /i node >> ai-check.log
echo DONE >> ai-check.log
