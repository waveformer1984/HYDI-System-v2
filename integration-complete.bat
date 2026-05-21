@echo off
REM ===============================================
REM HYDI Complete Integration & Startup Script
REM ===============================================
REM This script performs full system verification,
REM integration testing, and launches the complete
REM HYDI system with enhanced dashboard

cd /d F:\HYDI_System

echo.
echo ===============================================
echo HYDI COMPLETE INTEGRATION SUITE
echo ===============================================
echo.

REM Phase 1: System Verification
echo [PHASE 1/3] SYSTEM INTEGRATION VERIFICATION
echo ============================================
echo.
node system-integration-verify.js
echo.

REM Phase 2: System Startup
echo [PHASE 2/3] LAUNCHING HYDI SYSTEM SERVICES
echo ============================================
echo.
echo Starting all services...
echo.

start "HYDI Dashboard Enhanced" cmd /c npm run ursula
timeout /t 2 /nobreak

start "HYDI Orchestrator" cmd /c npm run process
timeout /t 2 /nobreak

start "HYDI Worker Agent" cmd /c npm run agent
timeout /t 2 /nobreak

start "ProtoForge Hub" cmd /c npm run protoforge
timeout /t 2 /nobreak

echo.
echo ===============================================
echo PHASE 3: SYSTEM READY FOR TESTING
echo ===============================================
echo.
echo All services have been initialized!
echo.
echo ACCESS POINTS:
echo   Dashboard:  http://localhost:3002
echo   ProtoForge: http://localhost:3001
echo.
echo NEXT STEPS:
echo 1. Open http://localhost:3002 in your browser
echo 2. Send test events to ProtoForge endpoints
echo 3. Monitor real-time updates in dashboard
echo.
echo Ready for integration testing.
echo Press any key to continue...
pause
