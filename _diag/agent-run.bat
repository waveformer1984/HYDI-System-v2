@echo off
set L=C:\Users\Owner\HYDI-System-v2\_diag\agent-out.log
echo === 1. agent status === > "%L%"
curl -sS -m 10 http://127.0.0.1:3006/api/agent/status >> "%L%" 2>&1
echo. >> "%L%"
echo === 2. trigger a cycle now (observe/reason/act) === >> "%L%"
curl -sS -m 90 -X POST http://127.0.0.1:3006/api/agent/run >> "%L%" 2>&1
echo. >> "%L%"
echo === 3. recent cycle log === >> "%L%"
curl -sS -m 10 http://127.0.0.1:3006/api/agent/log >> "%L%" 2>&1
echo. >> "%L%"
echo === 4. pending actions (awaiting your approval) === >> "%L%"
curl -sS -m 10 http://127.0.0.1:3006/api/agent/pending >> "%L%" 2>&1
echo. >> "%L%"
echo DONE >> "%L%"
