@echo off
set LOG=C:\Users\Owner\HYDI-System-v2\bridge-restart.log
echo === 1. BACKUP fixed file === > "%LOG%"
copy /Y "C:\ProtoForge_Ecosystem\heidi-bridge.py" "C:\Users\Owner\HYDI-System-v2\heidi-bridge.FIXED-backup-20260620.py" >> "%LOG%" 2>&1
echo backup_exit=%ERRORLEVEL% >> "%LOG%"
echo. >> "%LOG%"
echo === 2. KILL process on :5050 === >> "%LOG%"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5050 ^| findstr LISTENING') do (
  echo killing PID %%a >> "%LOG%"
  taskkill /F /PID %%a >> "%LOG%" 2>&1
)
echo. >> "%LOG%"
echo === 3. RELAUNCH (detached, persistent window) === >> "%LOG%"
start "HEIDI Bridge" cmd /k "cd /d C:\ProtoForge_Ecosystem && python heidi-bridge.py"
echo relaunched; waiting 12s for startup... >> "%LOG%"
timeout /t 12 /nobreak >nul
echo. >> "%LOG%"
echo === 4. VERIFY /health === >> "%LOG%"
curl -sS -m 10 http://127.0.0.1:5050/health >> "%LOG%" 2>&1
echo. >> "%LOG%"
echo DONE >> "%LOG%"
