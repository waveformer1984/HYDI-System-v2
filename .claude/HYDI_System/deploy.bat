@echo off
setlocal EnableDelayedExpansion
title HYDI System Deployment

echo.
echo ================================================
echo  HYDI System - Automated Deployment
echo ================================================
echo.

:: ---- Phase 1: Check Python ----
echo [Phase 1/5] Checking Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Install Python 3.10+ and add it to PATH.
    pause & exit /b 1
)
for /f "tokens=*" %%i in ('python --version') do echo   Found: %%i

:: ---- Phase 2: Install Python dependencies ----
echo.
echo [Phase 2/5] Installing Python dependencies...
pip install anthropic --quiet
if errorlevel 1 (
    echo ERROR: Failed to install anthropic. Check pip and internet connection.
    pause & exit /b 1
)
echo   anthropic SDK installed.

:: ---- Phase 3: Check ANTHROPIC_API_KEY ----
echo.
echo [Phase 3/5] Checking environment...
if "%ANTHROPIC_API_KEY%"=="" (
    echo WARNING: ANTHROPIC_API_KEY is not set in this session.
    echo   The cognitive loop will fail at runtime without it.
    echo   Set it with:  set ANTHROPIC_API_KEY=sk-ant-...
    echo   Or add it to your system environment variables.
) else (
    echo   ANTHROPIC_API_KEY is set.
)

:: ---- Phase 4: Run governance test suite ----
echo.
echo [Phase 4/5] Running governance test suite...
cd HYDI_Core
python test_governance.py
if errorlevel 1 (
    echo ERROR: Governance tests failed. See output above.
    cd ..
    pause & exit /b 1
)
cd ..
echo   All tests passed.

:: ---- Phase 5: Build TypeScript MCP server ----
echo.
echo [Phase 5/5] Building TypeScript MCP server...
cd mcp
where npm >nul 2>&1
if errorlevel 1 (
    echo SKIP: npm not found. Install Node.js to build the MCP server.
    echo   The Python cognitive loop still works without it.
    cd ..
    goto :done
)
call npm install --silent 2>nul
call npm run build
if errorlevel 1 (
    echo WARNING: TypeScript build failed. Check mcp/src for errors.
    cd ..
    goto :done
)
echo   MCP server built successfully.
cd ..

:done
echo.
echo ================================================
echo  Deployment complete.
echo ================================================
echo.
echo Quick test - run the cognitive loop directly:
echo   cd HYDI_Core
echo   set ANTHROPIC_API_KEY=sk-ant-...
echo   python HydiCognitiveLoop.py --goal "Summarize what the HYDI system does"
echo.
echo Start the MCP server (if built):
echo   cd mcp ^&^& npm start
echo   Then POST to http://localhost:7042/api/agent/run
echo.
pause
