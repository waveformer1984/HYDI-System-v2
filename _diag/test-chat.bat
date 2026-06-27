@echo off
cd /d "%~dp0"
echo === POST /api/chat (basic AI response) === > chat-test.log
curl -sS -N -m 150 -X POST http://127.0.0.1:3006/api/chat -H "Content-Type: application/json" --data-binary "@%~dp0chat-payload.json" >> chat-test.log 2>&1
echo. >> chat-test.log
echo === DONE === >> chat-test.log
