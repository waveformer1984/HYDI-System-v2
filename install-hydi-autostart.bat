@echo off
REM [DEPRECATED] This installer has been superseded by the boot-agent scheduled task.
REM
REM To install HYDI as a logon auto-start task (per-user, no admin needed):
REM   powershell -ExecutionPolicy Bypass -File scripts\install-boot-service.ps1
REM
REM To start the system manually:
REM   npm run boot
REM
REM See BOOT_AGENT.md for full details.
echo.
echo [DEPRECATED] Use: scripts\install-boot-service.ps1  (or)  npm run boot
echo See BOOT_AGENT.md for details.
echo.
