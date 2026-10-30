@echo off
REM ============================================================================
REM  Disable stale HYDI/Heidi Scheduled Tasks
REM ============================================================================
REM  Run this from an ELEVATED (Administrator) command prompt.
REM
REM  These tasks all point at stale scripts/paths that have been superseded by
REM  `npm run boot` (scripts/boot-agent.js). They are currently "Ready" and
REM  will interfere with the clean boot path if left enabled.
REM
REM  Right-click Command Prompt -> "Run as administrator", then run this script.
REM ============================================================================

echo.
echo Disabling stale HYDI/Heidi Scheduled Tasks...
echo.

schtasks /Change /TN "\HEIDI Autostart" /DISABLE
schtasks /Change /TN "\HeidiEmbedBackfill" /DISABLE
schtasks /Change /TN "\HeidiHub" /DISABLE
schtasks /Change /TN "\HYDI Guardian - Daily Sweep" /DISABLE
schtasks /Change /TN "\HYDI Guardian - Enforce Startup Blocks" /DISABLE
schtasks /Change /TN "\HYDI_Startup" /DISABLE

REM HYDI-Watchdog opened a terminal window every 2 minutes and duplicated
REM PM2's hydi-watchdog (see docs\FRANK_CONSOLE_POPUPS.md). Removed, not just
REM disabled. It is a per-user task, so this line needs no admin rights.
schtasks /Delete /TN "HYDI-Watchdog" /F

echo.
echo Done. The following tasks were already disabled (no action needed):
echo   HeidiAutopilot, HeidiEvolution, HeidiSystem, HYDI AutoStart,
echo   HYDI Boot Agent, HYDI Code Format, HYDI Dashboard Poller,
echo   HYDI Health Monitor, HYDI Status Collector, HYDI System Scanner,
echo   HYDI Workspace Cleanup, HydiSelfEvolveCycle, HydiSunrise,
echo   HYDI_Autorun_Backup
echo.
echo No HYDI scheduled task is needed going forward: PM2 runs the
echo watchdog (hydi-watchdog) and everything else. See ecosystem.config.js.
echo.
pause
