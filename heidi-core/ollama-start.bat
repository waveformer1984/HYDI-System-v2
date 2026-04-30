@echo off
echo Starting Ollama server in background...
start /B ollama serve
timeout /t 2 >nul
echo Ollama should be running on localhost:11434
