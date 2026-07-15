@echo off
set OL=C:\Users\Owner\HYDI-System-v2\_diag\restart-heidi.log
echo === kill :3006 listener === > "%OL%"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3006 ^| findstr LISTENING') do (
  echo killing PID %%a >> "%OL%"
  taskkill /F /PID %%a >> "%OL%" 2>&1
)
echo. >> "%OL%"
echo === relaunch HEIDI (edited copy, logging) === >> "%OL%"
start "HEIDI Server" cmd /k "cd /d C:\Users\Owner\HYDI-System-v2 && node launch-heidi-mobile.js > _diag\heidi-live.log 2>&1"
echo waiting 10s for startup... >> "%OL%"
timeout /t 10 /nobreak >nul
echo === health (should be up) === >> "%OL%"
curl -sS -m 10 http://127.0.0.1:3006/api/health >> "%OL%" 2>&1
echo. >> "%OL%"
echo === trigger agent cycle === >> "%OL%"
curl -sS -m 90 -X POST http://127.0.0.1:3006/api/agent/run >> "%OL%" 2>&1
echo. >> "%OL%"
echo === agent status after (cycle_count should be ^>0) === >> "%OL%"
curl -sS -m 10 http://127.0.0.1:3006/api/agent/status >> "%OL%" 2>&1
echo. >> "%OL%"
echo === health AFTER cycle (proves server survived) === >> "%OL%"
curl -sS -m 10 http://127.0.0.1:3006/api/health >> "%OL%" 2>&1
echo. >> "%OL%"
echo DONE >> "%OL%"
