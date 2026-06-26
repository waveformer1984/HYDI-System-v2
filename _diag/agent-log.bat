@echo off
set L=C:\Users\Owner\HYDI-System-v2\_diag\agent-log.log
echo === agent cycle log === > "%L%"
curl -sS -m 10 http://127.0.0.1:3006/api/agent/log >> "%L%" 2>&1
echo. >> "%L%"
echo === pending actions === >> "%L%"
curl -sS -m 10 http://127.0.0.1:3006/api/agent/pending >> "%L%" 2>&1
echo. >> "%L%"
echo DONE >> "%L%"
