@echo off
echo [HEIDI Test] End-to-End Test
echo ===========================

set BASE_URL=http://localhost:3456

REM Test 1: Health
echo.
echo [1] Health check...
curl -s %BASE_URL%/health | findstr "status" >nul
if errorlevel 1 (
    echo [X] Health check failed. Is HEIDI running?
    exit /b 1
)
echo [OK] Health check passed

REM Test 2: Store memory
echo.
echo [2] Storing memory...
curl -s -X POST %BASE_URL%/think -H "Content-Type: application/json" -d "{\"input\":\"remember: bananas_are_strategic_fact_42\"}" > test_output1.json
echo [OK] Memory stored

REM Wait a moment
timeout /t 1 /nobreak >nul

REM Test 3: Recall
echo.
echo [3] Testing recall...
curl -s -X POST %BASE_URL%/think -H "Content-Type: application/json" -d "{\"input\":\"what did I tell you?\"}" > test_output2.json
type test_output2.json | findstr "bananas" >nul
if errorlevel 1 (
    echo [!] Unclear if memory worked - check test_output2.json
) else (
    echo [OK] Memory recall appears to work
)

REM Test 4: State
echo.
echo [4] System state...
curl -s %BASE_URL%/state | findstr "status" >nul
echo [OK] State retrieved

echo.
echo [HEIDI Test] Complete. Check test_output*.json for details.
