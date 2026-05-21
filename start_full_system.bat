@echo off
REM ===============================================
REM HYDI Complete System Start - With Enhanced Worker
REM ===============================================

cd /d F:\HYDI_System

echo.
echo ===============================================
echo HYDI Complete System Startup
echo ===============================================
echo.

echo [1/5] Starting Ursula Dashboard Enhanced (port 3002)...
start "HYDI Dashboard" cmd /c node ursula-dashboard-enhanced.js

echo.
echo [2/5] Starting Production Orchestrator...
start "HYDI Orchestrator" cmd /c npm run process

echo.
echo [3/5] Starting Enhanced Agent Worker...
start "HYDI Worker Agent" cmd /c npm run agent

echo.
echo [4/5] Initializing ProtoForge Mock Server (port 3001)...
timeout /t 2 /nobreak
start "ProtoForge Hub" cmd /c npm run protoforge

echo.
echo [5/5] System initialization complete!
echo.
echo ===============================================
echo HYDI System - All Services Starting
echo ===============================================
echo.
echo Services:
echo   Ursula Dashboard:      http://localhost:3002
echo   ProtoForge Hub:        http://localhost:3001
echo   Worker Agent:          Running and polling tasks
echo   Orchestrator:          Running and routing events
echo.
echo ProtoForge Endpoints:
echo   POST /error   - Send error events to HYDI
echo   POST /task    - Send task events to HYDI
echo   POST /info    - Send info events to HYDI
echo   GET /health   - ProtoForge health check
echo.
echo ===============================================
echo HYDI System: FULLY OPERATIONAL
echo ===============================================
echo.
pause
