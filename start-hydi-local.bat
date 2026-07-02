@echo off
title HYDI - Heidi Core (LOCAL-ONLY)
cd /d "%~dp0heidi-core"

REM ================================================
REM   HYDI local-only launcher
REM   No Supabase, no Stripe, no cloud AI APIs.
REM   Brain: Ollama (llama3.2) at localhost:11434
REM ================================================

REM -- Explicitly blank all external-service vars for this process --
set "SUPABASE_URL="
set "SUPABASE_SERVICE_ROLE_KEY="
set "SUPABASE_ANON_KEY="
set "NEXT_PUBLIC_SUPABASE_URL="
set "NEXT_PUBLIC_SUPABASE_ANON_KEY="
set "STRIPE_SECRET_KEY="
set "ANTHROPIC_API_KEY="
set "OPENAI_API_KEY="

REM -- Local model settings --
set "OLLAMA_URL=http://localhost:11434"
set "OLLAMA_MODEL=llama3.2"
set "OLLAMA_EMBEDDING_MODEL=nomic-embed-text"
set "OLLAMA_TIMEOUT_MS=90000"
set "FAST_MODEL=qwen2.5-coder:1.5b"
set "HEIDI_PORT=3456"

REM -- Per-session secret for the side-effectful /act endpoint. Generated
REM    fresh each launch; both servers inherit it so local UIs work, but a
REM    drive-by web page cannot guess it. Autonomous action execution stays
REM    OFF unless you also set HEIDI_AUTONOMOUS_ACTIONS=true.
for /f %%i in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString(\"N\")"') do set "HEIDI_SECRET=%%i"

echo ================================================
echo   HYDI - Heidi Core   [LOCAL-ONLY MODE]
echo   Brain:  Ollama / %OLLAMA_MODEL%
echo   URL:    http://localhost:%HEIDI_PORT%
echo   Health: http://localhost:%HEIDI_PORT%/health
echo ================================================
echo.

REM -- Make sure Ollama is running (start it if not) --
curl -s -o nul -m 2 http://localhost:11434/api/tags
if errorlevel 1 (
    echo Ollama not responding - starting it...
    start "" /min ollama serve
    timeout /t 5 /nobreak >nul
)

REM -- Start the chat/panel server (port 3006) in its own window --
REM    It routes chat through Heidi Core (3456) automatically.
start "HYDI Panel Server (3006)" cmd /c "cd /d %~dp0 && set HEIDI_PORT=3006&& node launch-heidi-mobile.js & pause"

node server.js

echo.
echo Heidi Core stopped. Press any key to close.
pause >nul
