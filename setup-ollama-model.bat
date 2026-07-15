@echo off
title HEIDI - Ollama model setup
echo ============================================
echo   Preparing HEIDI's local AI brain (Ollama)
echo ============================================
echo.
echo Current models installed:
ollama list
echo.
echo Pulling llama3.2 (HEIDI's default model). This may take several
echo minutes and downloads ~2 GB the first time...
echo.
ollama pull llama3.2
echo.
echo Done. Models now available:
ollama list
echo.
echo You can close this window. Press any key to exit.
pause >nul
