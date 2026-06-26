@echo off
cd /d "C:\Users\Owner\HYDI-System-v2"
set LOG=cleanup.log
echo === create _diag subfolder === > "%LOG%"
if not exist "_diag" mkdir "_diag"
echo === move throwaways === >> "%LOG%"
for %%f in (check-heidi.bat check-ai.bat test-chat.bat test-ai.bat install-autostart.bat fix-autostart.bat restart-bridge.bat chat-payload.json ollama-payload.json chat-test.log ai-check.log heidi-check.log autostart-install.log bridge-restart.log) do (
  if exist "%%f" ( move /Y "%%f" "_diag\" >> "%LOG%" 2>&1 ) else ( echo skip %%f ^(absent^) >> "%LOG%" )
)
echo. >> "%LOG%"
echo === compress _diag to zip === >> "%LOG%"
powershell -NoProfile -Command "Compress-Archive -Path '_diag\*' -DestinationPath '_diag-archive-20260620.zip' -Force" >> "%LOG%" 2>&1
echo compress_exit=%ERRORLEVEL% >> "%LOG%"
echo. >> "%LOG%"
echo === main folder .bat/.json/.log now === >> "%LOG%"
dir /b *.bat *.json *.log 2>nul >> "%LOG%"
echo. >> "%LOG%"
echo === _diag contents === >> "%LOG%"
dir /b "_diag" >> "%LOG%" 2>&1
echo. >> "%LOG%"
echo === zip === >> "%LOG%"
dir /b "_diag-archive-20260620.zip" >> "%LOG%" 2>&1
echo DONE >> "%LOG%"
