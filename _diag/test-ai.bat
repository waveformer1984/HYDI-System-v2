@echo off
cd /d "%~dp0"
echo === 1. Ollama direct generate (warm-up + proof) === > chat-test.log
curl -sS -m 150 http://127.0.0.1:11434/api/generate --data-binary "@%~dp0ollama-payload.json" >> chat-test.log 2>&1
echo. >> chat-test.log
echo === 2. HEIDI /api/chat (full stack) === >> chat-test.log
curl -sS -N -m 150 -X POST http://127.0.0.1:3006/api/chat -H "Content-Type: application/json" --data-binary "@%~dp0chat-payload.json" >> chat-test.log 2>&1
echo. >> chat-test.log
echo === DONE === >> chat-test.log
