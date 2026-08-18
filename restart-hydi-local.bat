@echo off
REM [DEPRECATED] This launcher has been superseded by `npm run boot`.
REM
REM `npm run boot` starts the full stack (protoforge-core, heidi-web, mobile
REM chat, orchestrator) with health gating and dependency ordering. There is
REM no need to manually verify syntax, kill old ports, or seed facts before
REM starting — boot-agent handles all of that.
REM
REM To start the system:
REM   npm run boot
REM
REM See BOOT_AGENT.md for full details.
echo.
echo [DEPRECATED] Use: npm run boot
echo See BOOT_AGENT.md for details.
echo.
