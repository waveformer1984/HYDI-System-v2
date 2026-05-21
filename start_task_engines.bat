@echo off
REM Start HYDI Task Execution Engines
echo ===============================================
echo HYDI System - Initiating Task Execution Engines
echo ===============================================
cd /d F:\HYDI_System

echo.
echo [1/3] Starting Production Orchestrator (Main Task Engine)...
start "HYDI Task Engine" cmd /c npm run process

echo.
echo [2/3] Starting Agent System Worker...
start "HYDI Agent Worker" cmd /c npm run agent

echo.
echo [3/3] Task engines initiated. Monitoring active...
echo.
echo Dashboard: http://localhost:3002
echo SSE Stream: http://localhost:3002/events/stream
echo.
echo Task engines are now executing. Press Ctrl+C to stop individual windows.
pause
