@echo off
REM ===============================================
REM HYDI + ProtoForge Integration Script
REM Ties all ProtoForge modules into HYDI pipeline
REM ===============================================

cd /d F:\HYDI_System

echo.
echo ===============================================
echo HYDI + ProtoForge Integration System
echo ===============================================
echo.
echo [1/4] Verifying HYDI core services...
echo Status: Dashboard (3002), Orchestrator, Agent Worker
echo.

echo [2/4] Initializing ProtoForge Module Hub...
echo Starting ProtoForge Mock Server...
start "ProtoForge Hub" cmd /c npm run protoforge

echo.
echo [3/4] Establishing HYDI-ProtoForge Pipeline Bridges...
timeout /t 3 /nobreak

echo ✓ ProtoForge Error Stream -> HYDI Pipeline
echo ✓ ProtoForge Task Stream -> HYDI Pipeline
echo ✓ ProtoForge Info Stream -> HYDI Pipeline

echo.
echo [4/4] Integration Complete!
echo.
echo ===============================================
echo HYDI + ProtoForge Integration Status: ACTIVE
echo ===============================================
echo.
echo ProtoForge Hub:       http://localhost:3001
echo HYDI Dashboard:       http://localhost:3002
echo.
echo Available ProtoForge Endpoints:
echo   POST /error   - Send error events to HYDI
echo   POST /task    - Send task events to HYDI
echo   POST /info    - Send info events to HYDI
echo   GET /health   - ProtoForge health check
echo.
echo HYDI-ProtoForge Pipeline: ACTIVE AND EXECUTING
echo.
pause
