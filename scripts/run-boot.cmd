@echo off
REM ---------------------------------------------------------------------------
REM run-boot.cmd -- wrapper invoked by the "HYDI Boot Agent" scheduled task.
REM cd's to the repo root, ensures a logs dir, and runs the boot agent with
REM all output appended to logs\boot-agent.log. Any args (e.g. --prod) pass
REM straight through to the boot agent.
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0.."
if not exist logs mkdir logs
echo.>> logs\boot-agent.log
echo [%date% %time%] === boot-agent starting (args: %*) ===>> logs\boot-agent.log
node scripts\boot-agent.js %*>> logs\boot-agent.log 2>&1
echo [%date% %time%] === boot-agent exited (code %errorlevel%) ===>> logs\boot-agent.log
endlocal
